const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");

process.env.DATABASE_PATH = path.join(os.tmpdir(), `dinkwhere-entry-${process.pid}.sqlite`);
process.env.PLAYTOMIC_DISCOVERY = "off";
const handler = require("../api");

test("restores the visitor's path from the Vercel rewrite", () => {
  const { restoreOriginalUrl } = handler;
  assert.equal(restoreOriginalUrl("/api?__path="), "/");
  assert.equal(restoreOriginalUrl("/api?__path=assets%2Fleaflet.js"), "/assets/leaflet.js");
  assert.equal(restoreOriginalUrl("/api?__path=api%2Favailability&date=2026-10-06&days=7"), "/api/availability?date=2026-10-06&days=7");
  assert.equal(restoreOriginalUrl("/api?date=2026-10-06&__path=api/venues"), "/api/venues?date=2026-10-06");
  assert.equal(restoreOriginalUrl("/api/venues"), "/api/venues");
});

function call(url) {
  return new Promise((resolve) => {
    const headers = {};
    const response = {
      headersSent: false,
      writeHead(status, values = {}) {
        this.statusCode = status;
        Object.assign(headers, values);
        this.headersSent = true;
      },
      setHeader(name, value) { headers[name] = value; },
      write() {},
      end(body) { resolve({ status: this.statusCode, headers, body: String(body ?? "") }); },
      on() { return this; },
      once() { return this; },
      emit() {},
      removeListener() {},
    };
    handler({ url, method: "GET", headers: { host: "example.vercel.app" } }, response);
  });
}

test("serves the home page and API through the rewritten URL", async () => {
  const home = await call("/api?__path=");
  assert.equal(home.status, 200);
  const venues = await call("/api?__path=api/venues");
  assert.equal(venues.status, 200);
  assert.ok(JSON.parse(venues.body).venues.length > 40);
});
