const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ProviderEngine,
  authorizationHeaders,
  normalizeFeed,
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
