const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_TIMEZONE = "Asia/Singapore";
const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const ADAPTERS = new Set(["normalized-json", "playtomic"]);
const PLAYTOMIC_AVAILABILITY_URL = "https://api.playtomic.io/v1/availability";

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

  const defaultPath = path.join(root, "data", "providers.json");
  if (fs.existsSync(defaultPath)) {
    return parseProviderConfig(JSON.parse(fs.readFileSync(defaultPath, "utf8")));
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
  if (provider.adapter && !ADAPTERS.has(provider.adapter)) {
    throw new Error(`Unsupported adapter for ${provider.id}: ${provider.adapter}`);
  }

  if (provider.adapter === "playtomic") {
    const tenants = provider.tenants && typeof provider.tenants === "object" ? provider.tenants : {};
    for (const [tenantId, tenant] of Object.entries(tenants)) {
      if (!tenant?.courtId) throw new Error(`Playtomic tenant ${tenantId} requires a courtId`);
    }
    return {
      platform: "playtomic",
      timezone: DEFAULT_TIMEZONE,
      sportId: "PICKLEBALL",
      ...provider,
      url: provider.url || PLAYTOMIC_AVAILABILITY_URL,
      tenants,
      enabled: provider.enabled !== false && Object.keys(tenants).length > 0,
    };
  }

  if (!provider.url || typeof provider.url !== "string") {
    throw new Error(`Provider ${provider.id} requires a URL`);
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

function playtomicUrl(provider, tenantId, date) {
  const url = new URL(provider.url || PLAYTOMIC_AVAILABILITY_URL);
  url.searchParams.set("tenant_id", tenantId);
  url.searchParams.set("sport_id", provider.sportId || "PICKLEBALL");
  url.searchParams.set("local_start_min", `${date}T00:00:00`);
  url.searchParams.set("local_start_max", `${date}T23:59:59`);
  return url.toString();
}

// Playtomic returns the open slots of each court (resource). Collapse them into
// the aggregate contract: for every hour, how many courts have an opening that
// starts within it. Resource IDs and prices are not passed on.
function normalizePlaytomic(provider, tenantId, payload, requestedDate) {
  if (!Array.isArray(payload)) throw new Error("Playtomic availability must be an array");
  const tenant = provider.tenants[tenantId];
  const minimumMinutes = Number(tenant.minimumMinutes || 60);
  const resourcesByHour = new Map();
  const resources = new Set();

  for (const resource of payload) {
    if (!resource?.resource_id || !Array.isArray(resource.slots)) continue;
    if (resource.start_date && !String(resource.start_date).startsWith(requestedDate)) continue;
    resources.add(resource.resource_id);
    for (const slot of resource.slots) {
      const match = /^([01]\d|2[0-3]):[0-5]\d/.exec(slot?.start_time || "");
      if (!match || Number(slot.duration) < minimumMinutes) continue;
      const hour = `${match[1]}:00`;
      if (!resourcesByHour.has(hour)) resourcesByHour.set(hour, new Set());
      resourcesByHour.get(hour).add(resource.resource_id);
    }
  }

  const totalCourts = Math.max(Number(tenant.totalCourts) || 0, resources.size, 1);
  const slots = [...resourcesByHour.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([start, open]) => ({ start, availableCourts: Math.min(open.size, totalCourts) }));

  return {
    courtId: tenant.courtId,
    provider: provider.id,
    platform: "playtomic",
    status: "live",
    date: requestedDate,
    timezone: provider.timezone,
    totalCourts,
    capturedAt: new Date().toISOString(),
    sourceUrl: tenant.sourceUrl,
    slots,
  };
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
      const courts = await this.fetchCourts(provider, date);
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

  async fetchJson(provider, url) {
    const response = await this.fetchImpl(url, {
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
    return response.json();
  }

  async fetchCourts(provider, date) {
    if (provider.adapter === "playtomic") {
      // One request per club keeps each response attributable to its tenant.
      return Promise.all(
        Object.keys(provider.tenants).map(async (tenantId) =>
          normalizePlaytomic(
            provider,
            tenantId,
            await this.fetchJson(provider, playtomicUrl(provider, tenantId, date)),
            date,
          ),
        ),
      );
    }
    return normalizeFeed(provider, await this.fetchJson(provider, providerUrl(provider, date)), date);
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
  normalizePlaytomic,
  parseProviderConfig,
  playtomicUrl,
  providerUrl,
  readProviderConfig,
  todayInTimezone,
  validDate,
};
