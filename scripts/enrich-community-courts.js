const fs = require("node:fs");
const path = require("node:path");

const inputPath = process.argv[2];
if (!inputPath) {
  throw new Error("Usage: node scripts/enrich-community-courts.js <hdb-overpass.json>");
}

const datasetPath = path.join(__dirname, "..", "data", "community-courts.json");
const dataset = JSON.parse(fs.readFileSync(datasetPath, "utf8"));
const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));

function distanceKm(a, b) {
  const latKm = (a.lat - b.lat) * 111;
  const lonKm = (a.lon - b.lon) * 111 * Math.cos((a.lat * Math.PI) / 180);
  return Math.sqrt(latKm ** 2 + lonKm ** 2);
}

function isGeneratedName(court) {
  return (
    court.nameSource === "generated" ||
    court.name.endsWith(` ${court.osmId}`) ||
    (court.nearestHdb && court.name === `${court.nearestHdb} ${court.courtType}`)
  );
}

function displayCourtType(courtType) {
  return courtType.replace(/\bcourt\b/i, "Court");
}

const hdbBlocks = source.elements
  .map((element) => {
    const lat = element.lat ?? element.center?.lat;
    const lon = element.lon ?? element.center?.lon;
    const block = element.tags?.["addr:housenumber"]?.trim();
    const street = element.tags?.["addr:street"]?.trim();
    if (!lat || !lon || !block || !street) return null;

    return {
      lat,
      lon,
      block,
      street,
      postcode: element.tags?.["addr:postcode"]?.trim() || "",
    };
  })
  .filter(Boolean);

if (!hdbBlocks.length) {
  throw new Error("No addressed HDB blocks found in the supplied Overpass data.");
}

let enrichedCount = 0;
const enrichedCourts = dataset.courts.map((court) => {
  const nearest = hdbBlocks.reduce((best, block) => {
    const distance = distanceKm(court, block);
    return !best || distance < best.distance ? { ...block, distance } : best;
  }, null);

  // A distant block is not a useful or honest location reference.
  if (!nearest || nearest.distance > 0.6) {
    return {
      ...court,
      name: isGeneratedName(court)
        ? `${court.town} ${displayCourtType(court.courtType)} near ${court.nearestMrt}`
        : court.name,
      nameSource: isGeneratedName(court) ? "generated" : "explicit",
    };
  }

  const nearestHdb = `Blk ${nearest.block} ${nearest.street}`;
  enrichedCount += 1;
  return {
    ...court,
    name: isGeneratedName(court) ? `${nearestHdb} ${displayCourtType(court.courtType)}` : court.name,
    nameSource: isGeneratedName(court) ? "generated" : "explicit",
    nearestHdb,
    nearestHdbBlock: nearest.block,
    nearestHdbStreet: nearest.street,
    nearestHdbPostcode: nearest.postcode,
    nearestHdbDistanceM: Math.round(nearest.distance * 1000),
  };
});

function makeNamesUnique(courts) {
  const groups = new Map();
  for (const court of courts) {
    const baseName = court.baseName || court.name.replace(/ #\d+$/, "");
    court.baseName = baseName;
    const key = baseName.toLocaleLowerCase("en-SG");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(court);
  }

  for (const group of groups.values()) {
    if (group.length === 1) {
      group[0].name = group[0].baseName;
      delete group[0].locationNumber;
      continue;
    }
    group
      .sort((a, b) => b.lat - a.lat || a.lon - b.lon || a.id.localeCompare(b.id))
      .forEach((court, index) => {
        court.locationNumber = index + 1;
        court.name = `${court.baseName} #${court.locationNumber}`;
      });
  }

  return courts.sort((a, b) => a.town.localeCompare(b.town) || a.name.localeCompare(b.name));
}

const courts = makeNamesUnique(enrichedCourts);

const output = {
  ...dataset,
  addressEnrichedAt: new Date().toISOString(),
  addressSourceTimestamp: source.osm3s?.timestamp_osm_base || null,
  methodology: dataset.methodology.includes("Nearby HDB references")
    ? dataset.methodology
    : `${dataset.methodology} Nearby HDB references are matched to the closest OpenStreetMap building tagged residential=HDB within 600 metres.`,
  courts,
};

fs.writeFileSync(datasetPath, `${JSON.stringify(output)}\n`);
console.log(`Added nearby HDB references to ${enrichedCount} of ${courts.length} courts.`);
