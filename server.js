const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DinkWhereDatabase } = require("./lib/database");
const { PostgresDinkWhereDatabase } = require("./lib/postgres-database");
const { verifyFirebaseIdToken } = require("./lib/firebase-auth");
const {
  ProviderEngine,
  readProviderConfig,
  todayInTimezone,
  validDate,
} = require("./lib/provider-engine");

const root = __dirname;
loadEnv(path.join(root, ".env"));

const port = Number(process.env.PORT || 4173);
const refreshMs = Math.max(Number(process.env.AVAILABILITY_REFRESH_MS || 300000), 60000);
const snapshotPath = path.join(root, "data", "availability-snapshots.json");
const snapshots = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
const venues = JSON.parse(fs.readFileSync(path.join(root, "data", "venues.json"), "utf8"));
const communityCourtsPath = path.join(root, "data", "community-courts.json");
const communityCourts = JSON.parse(fs.readFileSync(communityCourtsPath, "utf8"));
const importedCommunityCourtIds = new Set(communityCourts.courts.map((court) => court.id));
const uploadDirectory = path.join(root, "uploads");
const database = process.env.DATABASE_URL
  ? new PostgresDinkWhereDatabase({ connectionString: process.env.DATABASE_URL })
  : new DinkWhereDatabase({
      databasePath: process.env.DATABASE_PATH || path.join(root, "data", "dinkwhere.sqlite"),
      uploadDirectory,
    });
const providers = readProviderConfig(root);
const engine = new ProviderEngine({ providers, refreshMs });
const SESSION_COOKIE = "dinkwhere_session";
const MAX_JSON_BYTES = 1_400_000;
const MAX_PHOTO_BYTES = 900_000;
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || "",
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || "",
  projectId: process.env.FIREBASE_PROJECT_ID || "",
  appId: process.env.FIREBASE_APP_ID || "",
};
const firebaseEnabled = Object.values(firebaseConfig).every(Boolean);

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_JSON_BYTES) {
        reject(httpError(413, "Request is too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(httpError(400, "Request body must be valid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function parseCookies(request) {
  return Object.fromEntries(
    String(request.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        return separator === -1
          ? [part, ""]
          : [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
      }),
  );
}

async function currentUser(request) {
  return database.userForSession(parseCookies(request)[SESSION_COOKIE]);
}

async function requireUser(request) {
  const user = await currentUser(request);
  if (!user) throw httpError(401, "Create an account or sign in to continue");
  return user;
}

function setSessionCookie(response, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000${secure}`,
  );
}

function clearSessionCookie(response) {
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`,
  );
}

function validateAccount(body) {
  const username = String(body.username || "").trim().toLowerCase();
  const displayName = String(body.displayName || "").trim();
  const password = String(body.password || "");
  if (!/^[a-z0-9_]{3,24}$/.test(username)) {
    throw httpError(400, "Username must be 3-24 letters, numbers, or underscores");
  }
  if (displayName.length < 2 || displayName.length > 40) {
    throw httpError(400, "Display name must be 2-40 characters");
  }
  if (password.length < 8 || password.length > 128) {
    throw httpError(400, "Password must be 8-128 characters");
  }
  return { username, displayName, password };
}

async function validateCourt(courtId) {
  if (!importedCommunityCourtIds.has(courtId) && !(await database.communityCourtById(courtId))) {
    throw httpError(404, "Court not found");
  }
}

function cleanChoice(value, allowed) {
  return allowed.includes(value) ? value : "Unknown";
}

function distanceMetres(a, b) {
  const latKm = (a.lat - b.lat) * 111;
  const lonKm = (a.lon - b.lon) * 111 * Math.cos((a.lat * Math.PI) / 180);
  return Math.sqrt(latKm ** 2 + lonKm ** 2) * 1000;
}

function uniqueCourtName(name, courts) {
  const used = new Set(courts.map((court) => court.name.toLocaleLowerCase("en-SG")));
  if (!used.has(name.toLocaleLowerCase("en-SG"))) return name;
  let number = 2;
  while (used.has(`${name} #${number}`.toLocaleLowerCase("en-SG"))) number += 1;
  return `${name} #${number}`;
}

async function savePhoto(dataUrl) {
  if (!dataUrl) return null;
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([a-zA-Z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw httpError(400, "Photo must be a JPEG, PNG, or WebP image");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) {
    throw httpError(400, "Photo must be smaller than 900 KB");
  }
  const validSignature = {
    "image/jpeg": bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
    "image/png": bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")),
    "image/webp": bytes.length >= 12
      && bytes.subarray(0, 4).toString("ascii") === "RIFF"
      && bytes.subarray(8, 12).toString("ascii") === "WEBP",
  }[match[1]];
  if (!validSignature) throw httpError(400, "Photo contents do not match its image type");
  const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[match[1]];
  const filename = `${Date.now()}-${crypto.randomBytes(12).toString("hex")}.${extension}`;
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = require("@vercel/blob");
    const blob = await put(`court-photos/${filename}`, bytes, {
      access: "public",
      contentType: match[1],
      addRandomSuffix: false,
    });
    return blob.url;
  }
  fs.writeFileSync(path.join(uploadDirectory, filename), bytes, { flag: "wx" });
  return filename;
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function serveFile(requestPath, response) {
  const relativePath = requestPath === "/" ? "index.html" : decodeURIComponent(requestPath.slice(1));
  const publicFiles = new Set(["index.html", "app.js", "community.js", "styles.css"]);
  const isPublicFile = publicFiles.has(relativePath);
  const isPublicAsset = relativePath.startsWith("assets/");
  const isUpload = relativePath.startsWith("uploads/");
  if (!isPublicFile && !isPublicAsset && !isUpload) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  const baseDirectory = isPublicAsset
    ? path.join(root, "assets")
    : isUpload
      ? uploadDirectory
      : root;
  const filePath = path.resolve(root, relativePath);
  const insideBase = isPublicFile || filePath.startsWith(`${baseDirectory}${path.sep}`);
  if (!insideBase || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".json": "application/json; charset=utf-8",
  };
  response.writeHead(200, {
    "Content-Type": types[path.extname(filePath)] || "application/octet-stream",
    "Cache-Control": isUpload || isPublicAsset ? "public, max-age=3600" : "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  fs.createReadStream(filePath).pipe(response);
}

async function requestHandler(request, response) {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === "GET" && url.pathname === "/api/availability") {
      const date = url.searchParams.get("date") || todayInTimezone();
      if (!validDate(date)) {
        sendJson(response, 400, { error: "date must use YYYY-MM-DD" });
        return;
      }
      await engine.refreshDate(date);
      sendJson(response, 200, engine.payload(date, snapshots));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/venues") {
      sendJson(response, 200, venues);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/health") {
      const date = todayInTimezone();
      sendJson(response, 200, { ok: true, database: true, providers: engine.payload(date).providers });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/community-courts") {
      sendJson(response, 200, {
        ...communityCourts,
        courts: [...await database.communityCourts(), ...communityCourts.courts],
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/community-courts") {
      const user = await requireUser(request);
      const body = await readJson(request);
      const name = String(body.name || "").trim();
      const town = String(body.town || "").trim();
      const address = String(body.address || "").trim();
      const courtType = String(body.courtType || "");
      const lat = Number(body.lat);
      const lon = Number(body.lon);
      if (name.length < 3 || name.length > 80) {
        throw httpError(400, "Court name must be 3-80 characters");
      }
      if (town.length < 2 || town.length > 40) {
        throw httpError(400, "Town or neighbourhood must be 2-40 characters");
      }
      if (address.length > 120) throw httpError(400, "Address must be 120 characters or fewer");
      if (!["Badminton court", "Basketball court", "Multipurpose court", "Dedicated pickleball court"].includes(courtType)) {
        throw httpError(400, "Invalid court type");
      }
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 1.12 || lat > 1.52 || lon < 103.52 || lon > 104.15) {
        throw httpError(400, "Choose a location within Singapore");
      }
      const allCourts = [...await database.communityCourts(), ...communityCourts.courts];
      const nearbyMatch = allCourts.find(
        (court) => court.courtType === courtType && distanceMetres({ lat, lon }, court) < 20,
      );
      if (nearbyMatch) {
        throw httpError(409, `This appears to match the existing court “${nearbyMatch.name}”`);
      }
      const fields = {
        markings: ["Unknown", "Yes", "No", "Temporary tape"],
        net: ["Unknown", "Permanent", "Bring your own"],
        surface: ["Unknown", "Good", "Okay", "Slippery", "Uneven"],
        lighting: ["Unknown", "Good", "Limited", "No night lighting"],
        shelter: ["Unknown", "Sheltered", "Unsheltered"],
        noise: ["Unknown", "Near blocks", "Open area", "Restricted hours"],
      };
      const photoPath = await savePhoto(String(body.photo || ""));
      const court = await database.addCommunityCourt({
        id: `community-${crypto.randomUUID()}`,
        userId: user.id,
        name: uniqueCourtName(name, allCourts),
        lat,
        lon,
        town,
        address,
        courtType,
        markings: cleanChoice(body.markings, fields.markings),
        net: cleanChoice(body.net, fields.net),
        surface: cleanChoice(body.surface, fields.surface),
        lighting: cleanChoice(body.lighting, fields.lighting),
        shelter: cleanChoice(body.shelter, fields.shelter),
        noise: cleanChoice(body.noise, fields.noise),
        photoPath,
      });
      sendJson(response, 201, { court });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/community-state") {
      sendJson(response, 200, await database.communityState());
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/auth/me") {
      sendJson(response, 200, { user: await currentUser(request) });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/auth/firebase-config") {
      sendJson(response, 200, {
        enabled: firebaseEnabled,
        config: firebaseEnabled ? firebaseConfig : null,
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/auth/google") {
      if (!firebaseEnabled) throw httpError(503, "Google sign-in is not configured yet");
      const body = await readJson(request);
      const claims = await verifyFirebaseIdToken(
        String(body.idToken || ""),
        firebaseConfig.projectId,
      );
      const user = await database.upsertGoogleUser({
        firebaseUid: claims.sub,
        email: claims.email,
        displayName: String(claims.name || claims.email.split("@")[0]).slice(0, 40),
        avatarUrl: String(claims.picture || "").slice(0, 500),
      });
      const token = await database.createSession(user.id);
      setSessionCookie(response, token);
      sendJson(response, 200, { user });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/auth/register") {
      const account = validateAccount(await readJson(request));
      let user;
      try {
        user = await database.createUser(account);
      } catch (error) {
        if (String(error.message).includes("UNIQUE")) throw httpError(409, "That username is already taken");
        throw error;
      }
      const token = await database.createSession(user.id);
      setSessionCookie(response, token);
      sendJson(response, 201, { user });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/auth/login") {
      const body = await readJson(request);
      const user = await database.verifyUser(
        String(body.username || "").trim().toLowerCase(),
        String(body.password || ""),
      );
      if (!user) throw httpError(401, "Incorrect username or password");
      const token = await database.createSession(user.id);
      setSessionCookie(response, token);
      sendJson(response, 200, { user });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/auth/logout") {
      await database.deleteSession(parseCookies(request)[SESSION_COOKIE]);
      clearSessionCookie(response);
      sendJson(response, 200, { ok: true });
      return;
    }
    if (request.method === "PATCH" && url.pathname === "/api/profile") {
      const user = await requireUser(request);
      const body = await readJson(request);
      const displayName = String(body.displayName || "").trim();
      const bio = String(body.bio || "").trim();
      if (displayName.length < 2 || displayName.length > 40) {
        throw httpError(400, "Display name must be 2-40 characters");
      }
      if (bio.length > 240) throw httpError(400, "Bio must be 240 characters or fewer");
      sendJson(response, 200, { user: await database.updateProfile(user.id, { displayName, bio }) });
      return;
    }

    const profileMatch = /^\/api\/profiles\/([a-zA-Z0-9_]+)$/.exec(url.pathname);
    if (request.method === "GET" && profileMatch) {
      const profile = await database.publicProfile(profileMatch[1]);
      if (!profile) throw httpError(404, "Profile not found");
      sendJson(response, 200, profile);
      return;
    }

    const reviewMatch = /^\/api\/courts\/([^/]+)\/reviews$/.exec(url.pathname);
    if (request.method === "POST" && reviewMatch) {
      const user = await requireUser(request);
      const courtId = decodeURIComponent(reviewMatch[1]);
      await validateCourt(courtId);
      const body = await readJson(request);
      const rating = Number(body.rating);
      const comment = String(body.comment || "").trim();
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        throw httpError(400, "Rating must be between 1 and 5");
      }
      if (!comment || comment.length > 300) {
        throw httpError(400, "Review must be 1-300 characters");
      }
      const fields = {
        markings: ["Unknown", "Yes", "No", "Temporary tape"],
        net: ["Unknown", "Permanent", "Bring your own"],
        surface: ["Unknown", "Good", "Okay", "Slippery", "Uneven"],
        lighting: ["Unknown", "Good", "Limited", "No night lighting"],
        shelter: ["Unknown", "Sheltered", "Unsheltered"],
        noise: ["Unknown", "Near blocks", "Open area", "Restricted hours"],
      };
      const photoPath = await savePhoto(String(body.photo || ""));
      const review = await database.addReview({
        courtId,
        userId: user.id,
        rating,
        comment,
        markings: cleanChoice(body.markings, fields.markings),
        net: cleanChoice(body.net, fields.net),
        surface: cleanChoice(body.surface, fields.surface),
        lighting: cleanChoice(body.lighting, fields.lighting),
        shelter: cleanChoice(body.shelter, fields.shelter),
        noise: cleanChoice(body.noise, fields.noise),
        photoPath,
      });
      sendJson(response, 201, { review });
      return;
    }

    const reportMatch = /^\/api\/courts\/([^/]+)\/reports$/.exec(url.pathname);
    if (request.method === "POST" && reportMatch) {
      const user = await requireUser(request);
      const courtId = decodeURIComponent(reportMatch[1]);
      await validateCourt(courtId);
      const body = await readJson(request);
      const status = String(body.status || "");
      const players = Number(body.players);
      const note = String(body.note || "").trim();
      if (!["available", "in_use", "busy", "unavailable"].includes(status)) {
        throw httpError(400, "Invalid court status");
      }
      if (!Number.isInteger(players) || players < 0 || players > 40) {
        throw httpError(400, "Players must be between 0 and 40");
      }
      if (note.length > 160) throw httpError(400, "Note must be 160 characters or fewer");
      const report = await database.addReport({ courtId, userId: user.id, status, players, note });
      sendJson(response, 201, { report });
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }
    serveFile(url.pathname, response);
  } catch (error) {
    if (!response.headersSent) {
      sendJson(response, error.status || 500, {
        error: error.status ? error.message : "Internal server error",
      });
    }
    if (!error.status) console.error(error);
  }
}

if (require.main === module) {
  const today = todayInTimezone();
  engine.refreshDate(today, { force: true });
  const refreshTimer = setInterval(() => engine.refreshDate(todayInTimezone(), { force: true }), refreshMs);
  refreshTimer.unref();

  http.createServer(requestHandler).listen(port, () => {
    console.log(`DinkWhere running at http://127.0.0.1:${port}`);
  });
}

module.exports = requestHandler;
