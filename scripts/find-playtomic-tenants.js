// Looks up the Playtomic tenant ID of every venue in data/venues.json that
// books through Playtomic, then writes a ready-to-use provider block.
//
//   node scripts/find-playtomic-tenants.js            # print the config
//   node scripts/find-playtomic-tenants.js --write    # merge into data/providers.json
const fs = require("node:fs");
const path = require("node:path");

const dataDirectory = path.join(__dirname, "..", "data");
const { venues } = JSON.parse(fs.readFileSync(path.join(dataDirectory, "venues.json"), "utf8"));
const SINGAPORE = "1.3521,103.8198";

function normalise(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function searchTenants(name) {
  const url = new URL("https://api.playtomic.io/v1/tenants");
  url.searchParams.set("tenant_name", name);
  url.searchParams.set("coordinate", SINGAPORE);
  url.searchParams.set("radius", "50000");
  url.searchParams.set("size", "20");
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Playtomic returned HTTP ${response.status} for "${name}"`);
  return response.json();
}

function bestMatch(venue, tenants) {
  const slug = /playtomic\.com\/clubs\/([^/?#]+)/.exec(venue.bookingUrl)?.[1];
  const wanted = normalise(venue.name);
  return (
    tenants.find((tenant) => slug && normalise(tenant.slug || tenant.tenant_uid) === normalise(slug)) ||
    tenants.find((tenant) => normalise(tenant.tenant_name) === wanted) ||
    tenants.find((tenant) => normalise(tenant.tenant_name).includes(wanted.split(" ")[0])) ||
    null
  );
}

async function main() {
  const tenants = {};
  for (const venue of venues.filter((item) => item.platform === "playtomic")) {
    try {
      const match = bestMatch(venue, await searchTenants(venue.name));
      if (!match) {
        console.warn(`No Playtomic club found for ${venue.name}`);
        continue;
      }
      tenants[match.tenant_id] = {
        courtId: venue.id,
        ...(venue.courts ? { totalCourts: venue.courts } : {}),
        sourceUrl: venue.bookingUrl,
      };
      console.warn(`${venue.name} → ${match.tenant_name} (${match.tenant_id})`);
    } catch (error) {
      console.warn(`${venue.name}: ${error.message}`);
    }
  }

  const provider = { id: "playtomic", adapter: "playtomic", tenants };
  if (!process.argv.includes("--write")) {
    console.log(JSON.stringify({ providers: [provider] }, null, 2));
    return;
  }

  const configPath = path.join(dataDirectory, "providers.json");
  const config = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, "utf8"))
    : { providers: [] };
  config.providers = [...config.providers.filter((item) => item.id !== "playtomic"), provider];
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  console.warn(`Wrote ${Object.keys(tenants).length} Playtomic clubs to ${configPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
