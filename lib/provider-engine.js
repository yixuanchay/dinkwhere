const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_TIMEZONE = "Asia/Singapore";
const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validTime(value) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function todayInTimezone(timezone = DEFAULT_TIMEZONE) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function readProviderConfig(root, env = process.env) {
  if (env.PROVIDERS_CONFIG_JSON) {
    return parseProviderConfig(JSON.parse(env.PROVIDERS_CONFIG_JSON));
  }

  const configuredPath = env.PROVIDERS_CONFIG_PATH;
  if (configuredPath) {
    const filePath = path.resolve(root, configuredPath);
    return parseProviderConfig(JSON.parse(fs.readFileSync(filePath, "utf8")));
  }

  return legacyProviders(env);
}

function parseProviderConfig(value) {
  const entries = Array.isArray(value) ? value : value?.providers;
  if (!Array.isArray(entries)) throw new Error("Provider config must contain a providers array");
  return entries.map(validateProvider);
}

function validateProvider(provider) {
  if (!provider || !PROVIDER_ID_PATTERN.test(provider.id || "")) {
    throw new Error("Each provider requires a lowercase id");
  }
  if (!provider.url || typeof provider.url !== "string") {
    throw new Error(`Provider ${provider.id} requires a URL`);
  }
  if (provider.adapter && provider.adapter !== "normalized-json") {
    throw new Error(`Unsupported adapter for ${provider.id}: ${provider.adapter}`);
  }

  return {
    adapter: "normalized-json",
    platform: provider.platform || provider.id,
    timezone: provider.timezone || DEFAULT_TIMEZONE,
    ...provider,
    enabled: provider.enabled !== false,
  };
}

function legacyProviders(env) {
  return [
    legacyProvider("courtreserve", env.COURTRESERVE_FEED_URL, {
      type: "basic",
      username: env.COURTRESERVE_FEED_USERNAME,
      password: env.COURTRESERVE_FEED_PASSWORD,
    }),
    legacyProvider("activesg", env.ACTIVESG_FEED_URL, {
      type: "bearer",
      token: env.ACTIVESG_FEED_TOKEN,
    }),
    legacyProvider("playtomic", env.PLAYTOMIC_FEED_URL, {
      type: "bearer",
      token: env.PLAYTOMIC_FEED_TOKEN,
    }),
    legacyProvider("reclub", env.RECLUB_FEED_URL, {
      type: "bearer",
      token: env.RECLUB_FEED_TOKEN,
    }),
  ];
}

function legacyProvider(id, url, auth) {
  return {
    id,
    platform: id,
    adapter: "normalized-json",
    url,
    auth,
    timezone: DEFAULT_TIMEZONE,
    enabled: Boolean(url),
  };
}

function resolveSecret(value, env = process.env) {
  if (!value || typeof value !== "string") return value;
  if (!value.startsWith("env:")) return value;
  return env[value.slice(4)];
}

function authorizationHeaders(provider, env = process.env) {
  const auth = provider.auth || {};
  if (auth.type === "basic") {
    const username = resolveSecret(auth.username, env);
    const password = resolveSecret(auth.password, env);
    if (!username || !password) throw new Error("Basic auth credentials are incomplete");
    return {
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
    };
  }
  if (auth.type === "bearer") {
    const token = resolveSecret(auth.token, env);
    if (!token) throw new Error("Bearer token is missing");
    return { Authorization: `Bearer ${token}` };
  }
  if (auth.type === "header") {
    const value = resolveSecret(auth.value, env);
    if (!auth.name || !value) throw new Error("Header auth credentials are incomplete");
    return { [auth.name]: value };
  }
  return {};
}

function providerUrl(provider, date) {
  const encodedDate = encodeURIComponent(date);
  if (provider.url.includes("{date}")) return provider.url.replaceAll("{date}", encodedDate);
  const url = new URL(provider.url);
  if (provider.dateQueryParam) url.searchParams.set(provider.dateQueryParam, date);
  return url.toString();
}

function normalizeFeed(provider, payload, requestedDate) {
  if (!payload || !Array.isArray(payload.courts)) {
    throw new Error("Feed must contain a courts array");
  }

  return payload.courts.map((court) => {
    const courtId = provider.courtIds?.[court.courtId] || court.courtId;
    if (!courtId || !Array.isArray(court.slots)) {
      throw new Error("Each court requires courtId and slots");
    }

    const date = court.date || requestedDate;
    const totalCourts = Number(court.totalCourts);
    if (!validDate(date)) throw new Error(`Invalid date for ${courtId}`);
    if (!Number.isInteger(totalCourts) || totalCourts < 1) {
      throw new Error(`Invalid totalCourts for ${courtId}`);
    }

    const slots = court.slots.map((slot) => {
      const availableCourts = Number(slot.availableCourts);
      if (
        !validTime(slot.start) ||
        !Number.isInteger(availableCourts) ||
        availableCourts < 0 ||
        availableCourts > totalCourts
      ) {
        throw new Error(`Invalid slot for ${courtId}`);
      }
      return { start: slot.start, availableCourts };
    });

    return {
      courtId,
      provider: provider.id,
      platform: provider.platform,
      status: "live",
      date,
      timezone: payload.timezone || provider.timezone,
      totalCourts,
      capturedAt: payload.generatedAt || new Date().toISOString(),
      sourceUrl: court.sourceUrl,
      slots,
    };
  });
}

class ProviderEngine {
  constructor({ providers, refreshMs, fetchImpl = fetch, env = process.env }) {
    this.providers = providers;
    this.refreshMs = refreshMs;
    this.fetchImpl = fetchImpl;
    this.env = env;
    this.cache = new Map();
    this.inFlight = new Map();
  }

  cacheKey(providerId, date) {
    return `${providerId}:${date}`;
  }

  async refreshProvider(provider, date) {
    if (!provider.enabled) return null;
    const key = this.cacheKey(provider.id, date);
    if (this.inFlight.has(key)) return this.inFlight.get(key);

    const refresh = this.fetchProvider(provider, date).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, refresh);
    return refresh;
  }

  async fetchProvider(provider, date) {
    const key = this.cacheKey(provider.id, date);
    const existing = this.cache.get(key);

    try {
      const response = await this.fetchImpl(providerUrl(provider, date), {
        headers: {
          Accept: "application/json",
          ...authorizationHeaders(provider, this.env),
          ...(provider.headers || {}),
        },
        signal: AbortSignal.timeout(Number(provider.timeoutMs || 15000)),
      });
      if (!response.ok) {
        const retryAfter = response.headers?.get?.("retry-after");
        throw new Error(
          `Feed returned HTTP ${response.status}${retryAfter ? `; retry after ${retryAfter}s` : ""}`,
        );
      }
      const courts = normalizeFeed(provider, await response.json(), date);
      const entry = { status: "live", fetchedAt: new Date().toISOString(), courts };
      this.cache.set(key, entry);
      return entry;
    } catch (error) {
      const entry = {
        status: existing?.courts?.length ? "cached" : "unavailable",
        fetchedAt: existing?.fetchedAt || null,
        courts: existing?.courts || [],
        error: error.message,
      };
      this.cache.set(key, entry);
      return entry;
    }
  }

  async refreshDate(date, { force = false } = {}) {
    if (!validDate(date)) throw new Error("Date must use YYYY-MM-DD");
    const now = Date.now();
    await Promise.all(
      this.providers.map((provider) => {
        if (!provider.enabled) return null;
        const entry = this.cache.get(this.cacheKey(provider.id, date));
        const age = entry?.fetchedAt ? now - Date.parse(entry.fetchedAt) : Number.POSITIVE_INFINITY;
        return force || age >= this.refreshMs ? this.refreshProvider(provider, date) : entry;
      }),
    );
  }

  payload(date, snapshots = {}) {
    const liveCourts = [];
    const providerStatuses = this.providers.map((provider) => {
      const entry = this.cache.get(this.cacheKey(provider.id, date));
      if (entry?.courts) {
        liveCourts.push(...entry.courts.map((court) => ({ ...court, status: entry.status })));
      }
      return {
        id: provider.id,
        platform: provider.platform,
        configured: provider.enabled,
        status: provider.enabled ? entry?.status || "connecting" : "needs_authorization",
        fetchedAt: entry?.fetchedAt || null,
        error: entry?.error || undefined,
      };
    });

    const liveIds = new Set(liveCourts.map((court) => court.courtId));
    const fallbackCourts = Object.values(snapshots).filter(
      (court) => court.date === date && !liveIds.has(court.courtId),
    );

    return {
      date,
      generatedAt: new Date().toISOString(),
      privacy: "Aggregate court availability only. No customer identity data.",
      providers: providerStatuses,
      courts: [...liveCourts, ...fallbackCourts],
    };
  }
}

module.exports = {
  ProviderEngine,
  authorizationHeaders,
  normalizeFeed,
  parseProviderConfig,
  providerUrl,
  readProviderConfig,
  todayInTimezone,
  validDate,
};
