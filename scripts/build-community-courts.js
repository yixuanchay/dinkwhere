const fs = require("node:fs");
const path = require("node:path");

const inputPath = process.argv[2];
if (!inputPath) throw new Error("Usage: node scripts/build-community-courts.js <overpass.json>");

const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const excludedAccess = new Set(["private", "no", "customers", "permit"]);
const existingDatasetPath = path.join(__dirname, "..", "data", "community-courts.json");
const existingCourts = fs.existsSync(existingDatasetPath)
  ? new Map(
      JSON.parse(fs.readFileSync(existingDatasetPath, "utf8")).courts.map((court) => [court.id, court]),
    )
  : new Map();

const towns = [
  { name: "Woodlands", lat: 1.436, lon: 103.786 },
  { name: "Yishun", lat: 1.429, lon: 103.835 },
  { name: "Sembawang", lat: 1.449, lon: 103.82 },
  { name: "Punggol", lat: 1.405, lon: 103.902 },
  { name: "Sengkang", lat: 1.391, lon: 103.895 },
  { name: "Pasir Ris", lat: 1.373, lon: 103.949 },
  { name: "Tampines", lat: 1.353, lon: 103.944 },
  { name: "Bedok", lat: 1.324, lon: 103.93 },
  { name: "Hougang", lat: 1.371, lon: 103.893 },
  { name: "Serangoon", lat: 1.35, lon: 103.873 },
  { name: "Ang Mo Kio", lat: 1.37, lon: 103.849 },
  { name: "Bishan", lat: 1.351, lon: 103.849 },
  { name: "Toa Payoh", lat: 1.334, lon: 103.849 },
  { name: "Kallang", lat: 1.31, lon: 103.866 },
  { name: "Queenstown", lat: 1.294, lon: 103.806 },
  { name: "Bukit Merah", lat: 1.282, lon: 103.82 },
  { name: "Clementi", lat: 1.315, lon: 103.765 },
  { name: "Bukit Timah", lat: 1.33, lon: 103.802 },
  { name: "Bukit Batok", lat: 1.349, lon: 103.749 },
  { name: "Choa Chu Kang", lat: 1.385, lon: 103.744 },
  { name: "Bukit Panjang", lat: 1.378, lon: 103.763 },
  { name: "Jurong East", lat: 1.333, lon: 103.743 },
  { name: "Jurong West", lat: 1.34, lon: 103.706 },
];

const mrts = [
  { name: "Woodlands MRT", lat: 1.436, lon: 103.787 },
  { name: "Yishun MRT", lat: 1.429, lon: 103.835 },
  { name: "Punggol MRT", lat: 1.405, lon: 103.902 },
  { name: "Sengkang MRT", lat: 1.391, lon: 103.895 },
  { name: "Pasir Ris MRT", lat: 1.373, lon: 103.949 },
  { name: "Tampines MRT", lat: 1.354, lon: 103.945 },
  { name: "Bedok MRT", lat: 1.324, lon: 103.93 },
  { name: "Hougang MRT", lat: 1.371, lon: 103.893 },
  { name: "Serangoon MRT", lat: 1.35, lon: 103.873 },
  { name: "Ang Mo Kio MRT", lat: 1.37, lon: 103.849 },
  { name: "Bishan MRT", lat: 1.351, lon: 103.849 },
  { name: "Toa Payoh MRT", lat: 1.333, lon: 103.847 },
  { name: "Kallang MRT", lat: 1.311, lon: 103.871 },
  { name: "Queenstown MRT", lat: 1.294, lon: 103.806 },
  { name: "Clementi MRT", lat: 1.315, lon: 103.765 },
  { name: "Bukit Batok MRT", lat: 1.349, lon: 103.749 },
  { name: "Choa Chu Kang MRT", lat: 1.385, lon: 103.744 },
  { name: "Bukit Panjang MRT", lat: 1.379, lon: 103.762 },
  { name: "Jurong East MRT", lat: 1.333, lon: 103.743 },
  { name: "Boon Lay MRT", lat: 1.339, lon: 103.706 },
];

function distanceKm(a, b) {
  const latKm = (a.lat - b.lat) * 111;
  const lonKm = (a.lon - b.lon) * 111 * Math.cos((a.lat * Math.PI) / 180);
  return Math.sqrt(latKm ** 2 + lonKm ** 2);
}

function nearest(point, places) {
  return places.reduce((best, place) => {
    const distance = distanceKm(point, place);
    return !best || distance < best.distance ? { ...place, distance } : best;
  }, null);
}

function titleCase(value) {
  return value.replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

const builtCourts = source.elements
  .map((element) => {
    const lat = element.lat ?? element.center?.lat;
    const lon = element.lon ?? element.center?.lon;
    const access = element.tags?.access || "unspecified";
    if (
      !lat ||
      !lon ||
      excludedAccess.has(access) ||
      lat < 1.22 ||
      lat > 1.49 ||
      lon < 103.58 ||
      lon > 104
    ) {
      return null;
    }

    const point = { lat, lon };
    const town = nearest(point, towns);
    const mrt = nearest(point, mrts);
    const sport = element.tags?.sport || "multi";
    const courtType = sport.includes("badminton")
      ? "Badminton court"
      : sport.includes("basketball")
        ? "Basketball court"
        : "Multipurpose court";
    const id = `osm-${element.type}-${element.id}`;
    const existing = existingCourts.get(id);
    const explicitName = element.tags?.name?.trim();
    const name =
      explicitName ||
      (existing?.nearestHdb
        ? `${existing.nearestHdb} ${courtType.replace(/\bcourt\b/i, "Court")}`
        : `${town.name} ${courtType.replace(/\bcourt\b/i, "Court")}`);

    return {
      id,
      osmType: element.type,
      osmId: element.id,
      name: titleCase(name),
      nameSource: explicitName ? "explicit" : "generated",
      lat: Number(lat.toFixed(7)),
      lon: Number(lon.toFixed(7)),
      town: town.name,
      nearestMrt: mrt.name,
      mrtDistanceKm: Number(mrt.distance.toFixed(1)),
      courtType,
      sport,
      access,
      sheltered: element.tags?.covered === "yes" ? "Sheltered" : "Unknown",
      lighting: element.tags?.lit === "yes" ? "Good" : element.tags?.lit === "no" ? "None" : "Unknown",
      markings: "Unknown",
      net: "Bring your own / unknown",
      surface: element.tags?.surface ? titleCase(element.tags.surface.replaceAll("_", " ")) : "Unknown",
      noise: "Community confirmation needed",
      source: "OpenStreetMap",
      ...(existing?.nearestHdb
        ? {
            nearestHdb: existing.nearestHdb,
            nearestHdbBlock: existing.nearestHdbBlock,
            nearestHdbStreet: existing.nearestHdbStreet,
            nearestHdbPostcode: existing.nearestHdbPostcode,
            nearestHdbDistanceM: existing.nearestHdbDistanceM,
          }
        : {}),
    };
  })
  .filter(Boolean);

function makeNamesUnique(courts) {
  const groups = new Map();
  for (const court of courts) {
    const baseName = court.name.replace(/ #\d+$/, "");
    court.baseName = baseName;
    const key = baseName.toLocaleLowerCase("en-SG");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(court);
  }
  for (const group of groups.values()) {
    if (group.length === 1) continue;
    group
      .sort((a, b) => b.lat - a.lat || a.lon - b.lon || a.id.localeCompare(b.id))
      .forEach((court, index) => {
        court.locationNumber = index + 1;
        court.name = `${court.baseName} #${court.locationNumber}`;
      });
  }
  return courts.sort((a, b) => a.town.localeCompare(b.town) || a.name.localeCompare(b.name));
}

const courts = makeNamesUnique(builtCourts);

const output = {
  generatedAt: new Date().toISOString(),
  sourceTimestamp: source.osm3s?.timestamp_osm_base || null,
  attribution: "© OpenStreetMap contributors, ODbL",
  methodology:
    "Basketball, badminton and multi-sport pitches on Singapore's main island, excluding features explicitly tagged private, permit-only, customer-only or inaccessible. HDB ownership and pickleball suitability require community confirmation.",
  courts,
};

const outputPath = path.join(__dirname, "..", "data", "community-courts.json");
fs.writeFileSync(outputPath, `${JSON.stringify(output)}\n`);
console.log(`Wrote ${courts.length} courts to ${outputPath}`);
