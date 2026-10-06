const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ProviderEngine,
  authorizationHeaders,
  countPlaybypointCourts,
  dateRange,
  normalizeFeed,
  normalizePlaytomic,
  parseProviderConfig,
  playtomicUrl,
  providerUrl,
} = require("../lib/provider-engine");

test("builds date-aware provider URLs", () => {
  assert.equal(
    providerUrl({ url: "https://example.test/feed/{date}" }, "2026-06-10"),
    "https://example.test/feed/2026-06-10",
  );
  assert.equal(
    providerUrl(
      { url: "https://example.test/feed", dateQueryParam: "date" },
      "2026-06-10",
    ),
    "https://example.test/feed?date=2026-06-10",
  );
});

test("keeps credentials in environment variables", () => {
  assert.deepEqual(
    authorizationHeaders(
      {
        auth: {
          type: "basic",
          username: "env:API_USER",
          password: "env:API_PASSWORD",
        },
      },
      { API_USER: "dinkwhere", API_PASSWORD: "secret" },
    ),
    { Authorization: "Basic ZGlua3doZXJlOnNlY3JldA==" },
  );
});

test("normalizes and maps aggregate availability", () => {
  const courts = normalizeFeed(
    {
      id: "venue",
      platform: "courtreserve",
      timezone: "Asia/Singapore",
      courtIds: { upstream: "local-court" },
    },
    {
      generatedAt: "2026-06-10T08:00:00+08:00",
      courts: [
        {
          courtId: "upstream",
          totalCourts: 2,
          slots: [{ start: "09:00", availableCourts: 1 }],
        },
      ],
    },
    "2026-06-10",
  );

  assert.equal(courts[0].courtId, "local-court");
  assert.equal(courts[0].date, "2026-06-10");
  assert.deepEqual(courts[0].slots, [{ start: "09:00", availableCourts: 1 }]);
});

test("deduplicates concurrent refreshes and serves the cache", async () => {
  let calls = 0;
  const provider = {
    id: "venue",
    platform: "custom",
    adapter: "normalized-json",
    url: "https://example.test/feed/{date}",
    timezone: "Asia/Singapore",
    enabled: true,
  };
  const engine = new ProviderEngine({
    providers: [provider],
    refreshMs: 300000,
    fetchImpl: async () => {
      calls += 1;
      return {
        ok: true,
        json: async () => ({
          courts: [
            {
              courtId: "court",
              date: "2026-06-10",
              totalCourts: 1,
              slots: [{ start: "09:00", availableCourts: 1 }],
            },
          ],
        }),
      };
    },
  });

  await Promise.all([
    engine.refreshProvider(provider, "2026-06-10"),
    engine.refreshProvider(provider, "2026-06-10"),
  ]);

  assert.equal(calls, 1);
  assert.equal(engine.payload("2026-06-10").courts[0].status, "live");
});

test("builds Playtomic availability URLs for one club and day", () => {
  const url = new URL(playtomicUrl({ sportId: "PICKLEBALL" }, "tenant-1", "2026-10-06"));
  assert.equal(url.origin + url.pathname, "https://api.playtomic.io/v1/availability");
  assert.equal(url.searchParams.get("tenant_id"), "tenant-1");
  assert.equal(url.searchParams.get("sport_id"), "PICKLEBALL");
  assert.equal(url.searchParams.get("local_start_min"), "2026-10-06T00:00:00");
  assert.equal(url.searchParams.get("local_start_max"), "2026-10-06T23:59:59");
});

test("collapses Playtomic open slots into hourly court counts", () => {
  const provider = parseProviderConfig({
    providers: [{
      id: "playtomic",
      adapter: "playtomic",
      tenants: { "tenant-1": { courtId: "tsa-jalan-kayu", totalCourts: 10 } },
    }],
  })[0];
  const court = normalizePlaytomic(provider, "tenant-1", [
    {
      resource_id: "court-a",
      start_date: "2026-10-06",
      slots: [
        { start_time: "08:00:00", duration: 60, price: "25 SGD" },
        { start_time: "08:30:00", duration: 90, price: "37.5 SGD" },
        { start_time: "19:00:00", duration: 30, price: "12 SGD" },
      ],
    },
    {
      resource_id: "court-b",
      start_date: "2026-10-06",
      slots: [{ start_time: "08:30:00", duration: 60, price: "25 SGD" }],
    },
    { resource_id: "court-c", start_date: "2026-10-07", slots: [{ start_time: "09:00:00", duration: 60 }] },
  ], "2026-10-06");

  assert.equal(court.courtId, "tsa-jalan-kayu");
  assert.equal(court.totalCourts, 10);
  assert.deepEqual(court.slots, [{ start: "08:00", availableCourts: 2 }]);
  assert.equal(JSON.stringify(court).includes("court-a"), false);
});

test("fetches each configured Playtomic club", async () => {
  const requested = [];
  const engine = new ProviderEngine({
    providers: parseProviderConfig([{
      id: "playtomic",
      adapter: "playtomic",
      tenants: {
        "tenant-1": { courtId: "balmoral-pickleball-club", totalCourts: 4 },
        "tenant-2": { courtId: "tsa-expo" },
      },
    }]),
    refreshMs: 60000,
    fetchImpl: async (url) => {
      requested.push(new URL(url).searchParams.get("tenant_id"));
      return {
        ok: true,
        json: async () => [{ resource_id: "r1", start_date: "2026-10-06", slots: [{ start_time: "10:00:00", duration: 60 }] }],
      };
    },
  });
  await engine.refreshDate("2026-10-06");
  const payload = engine.payload("2026-10-06");
  assert.deepEqual(requested.sort(), ["tenant-1", "tenant-2"]);
  assert.deepEqual(payload.courts.map((court) => court.courtId).sort(), ["balmoral-pickleball-club", "tsa-expo"]);
  assert.equal(payload.providers[0].status, "live");
});

test("disables Playtomic until a club is mapped", () => {
  const [provider] = parseProviderConfig([{ id: "playtomic", adapter: "playtomic" }]);
  assert.equal(provider.enabled, false);
});

test("builds consecutive date ranges capped at two weeks", () => {
  assert.deepEqual(dateRange("2026-10-30", 4), ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  assert.equal(dateRange("2026-10-06", 99).length, 14);
  assert.deepEqual(dateRange("2026-10-06", "nonsense"), ["2026-10-06"]);
});

test("returns several days of availability in one payload", async () => {
  const engine = new ProviderEngine({
    providers: parseProviderConfig([{
      id: "playtomic",
      adapter: "playtomic",
      tenants: { t1: { courtId: "tsa-expo", totalCourts: 2 } },
    }]),
    refreshMs: 60000,
    fetchImpl: async (url) => {
      const date = new URL(url).searchParams.get("local_start_min").slice(0, 10);
      return { ok: true, json: async () => [{ resource_id: "r", start_date: date, slots: [{ start_time: "09:00:00", duration: 60 }] }] };
    },
  });
  const dates = dateRange("2026-10-06", 3);
  await engine.refreshRange(dates);
  const payload = engine.rangePayload(dates);
  assert.deepEqual(payload.dates, dates);
  assert.deepEqual(payload.courts.map((court) => court.date), dates);
});

test("counts PlayByPoint courts from any documented wrapper", () => {
  assert.equal(countPlaybypointCourts([{ id: "court_1" }, { id: "court_2" }]), 2);
  assert.equal(countPlaybypointCourts({ data: [{ id: "court_1" }] }), 1);
  assert.throws(() => countPlaybypointCourts({ error: "nope" }));
});

test("asks PlayByPoint for each opening hour with the facility header", async () => {
  const calls = [];
  const engine = new ProviderEngine({
    providers: parseProviderConfig([{
      id: "straits",
      adapter: "playbypoint",
      auth: { type: "bearer", token: "env:PBP_KEY" },
      facilities: { fac_1: { courtId: "straits-pickle-club", totalCourts: 3, openHour: 8, closeHour: 10 } },
    }]),
    refreshMs: 60000,
    env: { PBP_KEY: "secret" },
    fetchImpl: async (url, options) => {
      const start = new URL(url).searchParams.get("start_time");
      calls.push({ start, headers: options.headers });
      const courts = start === "08:00" ? [{}, {}] : [];
      return { ok: true, json: async () => ({ data: courts }) };
    },
  });
  await engine.refreshDate("2026-10-06");
  const [court] = engine.payload("2026-10-06").courts;
  assert.deepEqual(calls.map((call) => call.start).sort(), ["08:00", "09:00"]);
  assert.equal(calls[0].headers["X-PBP-Facility-Id"], "fac_1");
  assert.equal(calls[0].headers.Authorization, "Bearer secret");
  assert.equal(court.courtId, "straits-pickle-club");
  assert.equal(court.slots.reduce((sum, slot) => sum + slot.availableCourts, 0), 2);
});
