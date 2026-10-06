const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_TIMEZONE = "Asia/Singapore";
const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const ADAPTERS = new Set(["normalized-json", "playtomic", "playbypoint"]);
const PLAYBYPOINT_API_URL = "https://api.playbypoint.com/v1";
const MAX_RANGE_DAYS = 14;
const PLAYTOMIC_AVAILABILITY_URL = "https://api.playtomic.io/v1/availability";
const PLAYTOMIC_TENANTS_URL = "https://api.playtomic.io/v1/tenants";
const SINGAPORE_COORDINATE = "1.3521,103.8198";
const TENANT_RETRY_MS = 30 * 60 * 1000;
const USER_AGENT = "DinkWhere/0.1 (Singapore court availability directory)";

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

  if (provider.adapter === "playbypoint") {
    const facilities = provider.facilities && typeof provider.facilities === "object" ? provider.facilities : {};
    for (const [facilityId, facility] of Object.entries(facilities)) {
      if (!facility?.courtId) throw new Error(`PlayByPoint facility ${facilityId} requires a courtId`);
    }
    return {
      platform: "playbypoint",
      timezone: DEFAULT_TIMEZONE,
      ...provider,
      url: provider.url || PLAYBYPOINT_API_URL,
      facilities,
      enabled: provider.enabled !== false && Object.keys(facilities).length > 0,
    };
  }

  if (provider.adapter === "playtomic") {
    const tenants = provider.tenants && typeof provider.tenants === "object" ? provider.tenants : {};
    for (const [tenantId, tenant] of Object.entries(tenants)) {
      if (!tenant?.courtId) throw new Error(`Playtomic tenant ${tenantId} requires a courtId`);
    }
    // `discover` lists venues whose tenant ID is looked up by club name on first use.
    const discover = Array.isArray(provider.discover) ? provider.discover : [];
    for (const venue of discover) {
      if (!venue?.courtId || !venue?.name) throw new Error("Playtomic discovery entries need courtId and name");
    }
    return {
      platform: "playtomic",
      timezone: DEFAULT_TIMEZONE,
      sportId: "PICKLEBALL",
      ...provider,
      url: provider.url || PLAYTOMIC_AVAILABILITY_URL,
      tenantsUrl: provider.tenantsUrl || PLAYTOMIC_TENANTS_URL,
      tenants,
      discover,
      enabled: provider.enabled !== false && Object.keys(tenants).length + discover.length > 0,
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

function normaliseName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function playtomicTenantSearchUrl(provider, name) {
  const url = new URL(provider.tenantsUrl || PLAYTOMIC_TENANTS_URL);
  url.searchParams.set("tenant_name", name);
  url.searchParams.set("coordinate", SINGAPORE_COORDINATE);
  url.searchParams.set("radius", "50000");
  url.searchParams.set("size", "20");
  return url.toString();
}

// Prefer an exact name match, then a club whose name starts with or contains
// the venue's name (Playtomic often appends the operator in brackets).
function matchPlaytomicTenant(name, tenants) {
  if (!Array.isArray(tenants)) return null;
  const wanted = normaliseName(name);
  const named = tenants.filter((tenant) => tenant?.tenant_id && tenant?.tenant_name);
  return (
    named.find((tenant) => normaliseName(tenant.tenant_name) === wanted) ||
    named.find((tenant) => normaliseName(tenant.tenant_name).startsWith(wanted)) ||
    named.find((tenant) => normaliseName(tenant.tenant_name).includes(wanted)) ||
    null
  );
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

function dateRange(start, days) {
  const count = Math.min(Math.max(Number.parseInt(days, 10) || 1, 1), MAX_RANGE_DAYS);
  const first = new Date(`${start}T00:00:00Z`);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(first);
    date.setUTCDate(first.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

function playbypointHours(facility) {
  const open = Number.isInteger(facility.openHour) ? facility.openHour : 7;
  const close = Number.isInteger(facility.closeHour) ? facility.closeHour : 23;
  return Array.from({ length: Math.max(close - open, 0) }, (_, index) => open + index);
}

function playbypointUrl(provider, date, hour) {
  const url = new URL(`${provider.url.replace(/\/$/, "")}/availability/courts`);
  url.searchParams.set("date", date);
  url.searchParams.set("start_time", `${String(hour).padStart(2, "0")}:00`);
  url.searchParams.set("end_time", `${String(hour + 1).padStart(2, "0")}:00`);
  return url.toString();
}

// PlayByPoint lists the courts that are free for a requested window. The
// response may be a bare array or wrapped in data/courts; only the count is kept.
function countPlaybypointCourts(payload) {
  const courts = Array.isArray(payload) ? payload : payload?.data || payload?.courts || payload?.available_courts;
  if (!Array.isArray(courts)) throw new Error("PlayByPoint availability must list courts");
  return courts.length;
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

  async fetchJson(provider, url, extraHeaders = {}) {
    const response = await this.fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
        ...authorizationHeaders(provider, this.env),
        ...(provider.headers || {}),
        ...extraHeaders,
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
    if (provider.adapter === "playbypoint") {
      return Promise.all(
        Object.entries(provider.facilities).map(async ([facilityId, facility]) => {
          const counts = await Promise.all(
            playbypointHours(facility).map(async (hour) => [
              hour,
              countPlaybypointCourts(
                await this.fetchJson(provider, playbypointUrl(provider, date, hour), {
                  "X-PBP-Facility-Id": facilityId,
                }),
              ),
            ]),
          );
          const totalCourts = Math.max(Number(facility.totalCourts) || 0, ...counts.map(([, count]) => count), 1);
          return {
            courtId: facility.courtId,
            provider: provider.id,
            platform: "playbypoint",
            status: "live",
            date,
            timezone: provider.timezone,
            totalCourts,
            capturedAt: new Date().toISOString(),
            sourceUrl: facility.sourceUrl,
            slots: counts.map(([hour, count]) => ({
              start: `${String(hour).padStart(2, "0")}:00`,
              availableCourts: Math.min(count, totalCourts),
            })),
          };
        }),
      );
    }
    if (provider.adapter === "playtomic") {
      await this.discoverPlaytomicTenants(provider);
      if (!Object.keys(provider.tenants).length) throw new Error("No Playtomic clubs found yet");
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

  async discoverPlaytomicTenants(provider) {
    const pending = provider.discover.filter((venue) =>
      !Object.values(provider.tenants).some((tenant) => tenant.courtId === venue.courtId));
    if (!pending.length) return;
    if (provider.discoveryFailedAt && Date.now() - provider.discoveryFailedAt < TENANT_RETRY_MS) return;
    provider.discovering ||= Promise.all(pending.map(async (venue) => {
      const match = matchPlaytomicTenant(venue.name, await this.fetchJson(provider, playtomicTenantSearchUrl(provider, venue.name)));
      if (!match) return false;
      provider.tenants[match.tenant_id] = {
        courtId: venue.courtId,
        ...(venue.totalCourts ? { totalCourts: venue.totalCourts } : {}),
        sourceUrl: venue.sourceUrl,
      };
      return true;
    }))
      .then((found) => {
        if (found.includes(false)) provider.discoveryFailedAt = Date.now();
      })
      .catch((error) => {
        provider.discoveryFailedAt = Date.now();
        if (!Object.keys(provider.tenants).length) throw error;
      })
      .finally(() => {
        provider.discovering = null;
      });
    await provider.discovering;
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

  async refreshRange(dates) {
    await Promise.all(dates.map((date) => this.refreshDate(date)));
  }

  // Several days in one response; provider statuses describe the first day.
  rangePayload(dates, snapshots = {}) {
    const days = dates.map((date) => this.payload(date, snapshots));
    return {
      ...days[0],
      dates,
      courts: days.flatMap((day) => day.courts),
    };
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
  countPlaybypointCourts,
  dateRange,
  matchPlaytomicTenant,
  normalizeFeed,
  normalizePlaytomic,
  parseProviderConfig,
  playbypointUrl,
  playtomicUrl,
  providerUrl,
  readProviderConfig,
  todayInTimezone,
  validDate,
};
