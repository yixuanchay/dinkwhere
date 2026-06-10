const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REPORT_TTL_MS = 90 * 60 * 1000;

class DinkWhereDatabase {
  constructor({ databasePath, uploadDirectory }) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    fs.mkdirSync(uploadDirectory, { recursive: true });
    this.uploadDirectory = uploadDirectory;
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL COLLATE NOCASE UNIQUE,
        display_name TEXT NOT NULL,
        bio TEXT NOT NULL DEFAULT '',
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS reviews (
        id INTEGER PRIMARY KEY,
        court_id TEXT NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
        comment TEXT NOT NULL,
        markings TEXT NOT NULL DEFAULT 'Unknown',
        net TEXT NOT NULL DEFAULT 'Unknown',
        surface TEXT NOT NULL DEFAULT 'Unknown',
        lighting TEXT NOT NULL DEFAULT 'Unknown',
        shelter TEXT NOT NULL DEFAULT 'Unknown',
        noise TEXT NOT NULL DEFAULT 'Unknown',
        photo_path TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS court_reports (
        id INTEGER PRIMARY KEY,
        court_id TEXT NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('available', 'in_use', 'busy', 'unavailable')),
        players INTEGER NOT NULL CHECK (players BETWEEN 0 AND 40),
        note TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS community_courts (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        town TEXT NOT NULL,
        address TEXT NOT NULL DEFAULT '',
        court_type TEXT NOT NULL,
        markings TEXT NOT NULL DEFAULT 'Unknown',
        net TEXT NOT NULL DEFAULT 'Unknown',
        surface TEXT NOT NULL DEFAULT 'Unknown',
        lighting TEXT NOT NULL DEFAULT 'Unknown',
        shelter TEXT NOT NULL DEFAULT 'Unknown',
        noise TEXT NOT NULL DEFAULT 'Unknown',
        photo_path TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS reviews_court_created
        ON reviews(court_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS reviews_user_created
        ON reviews(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS reports_court_expires
        ON court_reports(court_id, expires_at DESC);
      CREATE INDEX IF NOT EXISTS sessions_expires
        ON sessions(expires_at);
      CREATE INDEX IF NOT EXISTS community_courts_created
        ON community_courts(created_at DESC);
      CREATE INDEX IF NOT EXISTS community_courts_user_created
        ON community_courts(user_id, created_at DESC);
    `);
    this.addColumn("users", "firebase_uid", "TEXT");
    this.addColumn("users", "email", "TEXT");
    this.addColumn("users", "avatar_url", "TEXT NOT NULL DEFAULT ''");
    this.addColumn("users", "auth_provider", "TEXT NOT NULL DEFAULT 'password'");
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS users_firebase_uid
        ON users(firebase_uid) WHERE firebase_uid IS NOT NULL;
    `);
  }

  addColumn(table, column, definition) {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some((item) => item.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  createUser({ username, displayName, password }) {
    const salt = crypto.randomBytes(16).toString("hex");
    const passwordHash = hashPassword(password, salt);
    const result = this.db.prepare(`
      INSERT INTO users (username, display_name, password_salt, password_hash, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(username, displayName, salt, passwordHash, Date.now());
    return this.getUserById(Number(result.lastInsertRowid));
  }

  verifyUser(username, password) {
    const row = this.db.prepare("SELECT * FROM users WHERE username = ?").get(username);
    if (!row || row.auth_provider !== "password") {
      hashPassword(password, crypto.randomBytes(16).toString("hex"));
      return null;
    }
    const actual = Buffer.from(hashPassword(password, row.password_salt), "hex");
    const expected = Buffer.from(row.password_hash, "hex");
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
    return publicUser(row);
  }

  getUserById(id) {
    const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    return row ? publicUser(row) : null;
  }

  getUserByUsername(username) {
    const row = this.db.prepare("SELECT * FROM users WHERE username = ?").get(username);
    return row ? publicUser(row) : null;
  }

  upsertGoogleUser({ firebaseUid, email, displayName, avatarUrl }) {
    const existing = this.db.prepare("SELECT * FROM users WHERE firebase_uid = ?").get(firebaseUid);
    if (existing) {
      this.db.prepare(`
        UPDATE users
        SET display_name = ?, email = ?, avatar_url = ?
        WHERE id = ?
      `).run(displayName, email, avatarUrl, existing.id);
      return this.getUserById(existing.id);
    }

    const username = this.availableUsername(email || displayName || "player");
    const salt = crypto.randomBytes(16).toString("hex");
    const disabledPassword = hashPassword(crypto.randomBytes(32).toString("hex"), salt);
    const result = this.db.prepare(`
      INSERT INTO users (
        username, display_name, bio, password_salt, password_hash,
        firebase_uid, email, avatar_url, auth_provider, created_at
      ) VALUES (?, ?, '', ?, ?, ?, ?, ?, 'google', ?)
    `).run(
      username,
      displayName,
      salt,
      disabledPassword,
      firebaseUid,
      email,
      avatarUrl,
      Date.now(),
    );
    return this.getUserById(Number(result.lastInsertRowid));
  }

  availableUsername(seed) {
    const base = String(seed)
      .split("@")[0]
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 20) || "player";
    let candidate = base.length >= 3 ? base : `player_${base}`;
    let suffix = 1;
    while (this.getUserByUsername(candidate)) {
      candidate = `${base.slice(0, 18)}_${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  updateProfile(userId, { displayName, bio }) {
    this.db.prepare(`
      UPDATE users SET display_name = ?, bio = ? WHERE id = ?
    `).run(displayName, bio, userId);
    return this.getUserById(userId);
  }

  createSession(userId) {
    const token = crypto.randomBytes(32).toString("base64url");
    const now = Date.now();
    this.cleanup();
    this.db.prepare(`
      INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
      VALUES (?, ?, ?, ?)
    `).run(tokenHash(token), userId, now + SESSION_TTL_MS, now);
    return token;
  }

  userForSession(token) {
    if (!token) return null;
    const row = this.db.prepare(`
      SELECT users.*
      FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ?
    `).get(tokenHash(token), Date.now());
    return row ? publicUser(row) : null;
  }

  deleteSession(token) {
    if (token) this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
  }

  addReview(review) {
    const result = this.db.prepare(`
      INSERT INTO reviews (
        court_id, user_id, rating, comment, markings, net, surface,
        lighting, shelter, noise, photo_path, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      review.courtId,
      review.userId,
      review.rating,
      review.comment,
      review.markings,
      review.net,
      review.surface,
      review.lighting,
      review.shelter,
      review.noise,
      review.photoPath || null,
      Date.now(),
    );
    return this.reviewById(Number(result.lastInsertRowid));
  }

  reviewById(id) {
    const row = this.db.prepare(`${reviewSelect()} WHERE reviews.id = ?`).get(id);
    return row ? normalizeReview(row) : null;
  }

  addReport(report) {
    const now = Date.now();
    const result = this.db.prepare(`
      INSERT INTO court_reports (
        court_id, user_id, status, players, note, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      report.courtId,
      report.userId,
      report.status,
      report.players,
      report.note,
      now,
      now + REPORT_TTL_MS,
    );
    return this.reportById(Number(result.lastInsertRowid));
  }

  addCommunityCourt(court) {
    this.db.prepare(`
      INSERT INTO community_courts (
        id, user_id, name, lat, lon, town, address, court_type,
        markings, net, surface, lighting, shelter, noise, photo_path, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      court.id,
      court.userId,
      court.name,
      court.lat,
      court.lon,
      court.town,
      court.address,
      court.courtType,
      court.markings,
      court.net,
      court.surface,
      court.lighting,
      court.shelter,
      court.noise,
      court.photoPath || null,
      Date.now(),
    );
    return this.communityCourtById(court.id);
  }

  communityCourtById(id) {
    const row = this.db.prepare(`${communityCourtSelect()} WHERE community_courts.id = ?`).get(id);
    return row ? normalizeCommunityCourt(row) : null;
  }

  communityCourts() {
    return this.db.prepare(`${communityCourtSelect()} ORDER BY community_courts.created_at DESC`)
      .all()
      .map(normalizeCommunityCourt);
  }

  reportById(id) {
    const row = this.db.prepare(`${reportSelect()} WHERE court_reports.id = ?`).get(id);
    return row ? normalizeReport(row) : null;
  }

  communityState() {
    this.cleanup();
    const reviews = this.db.prepare(`${reviewSelect()} ORDER BY reviews.created_at DESC`).all();
    const reports = this.db.prepare(`
      ${reportSelect()}
      WHERE court_reports.expires_at > ?
      ORDER BY court_reports.created_at DESC
    `).all(Date.now());
    return {
      reviews: reviews.map(normalizeReview),
      reports: reports.map(normalizeReport),
    };
  }

  publicProfile(username) {
    const user = this.getUserByUsername(username);
    if (!user) return null;
    const reviews = this.db.prepare(`
      ${reviewSelect()}
      WHERE users.id = ?
      ORDER BY reviews.created_at DESC
    `).all(user.id);
    const reportCount = this.db.prepare(`
      SELECT COUNT(*) AS count FROM court_reports WHERE user_id = ?
    `).get(user.id).count;
    const courtCount = this.db.prepare(`
      SELECT COUNT(*) AS count FROM community_courts WHERE user_id = ?
    `).get(user.id).count;
    return {
      user,
      reviews: reviews.map(normalizeReview),
      stats: { reviews: reviews.length, reports: reportCount, courtsAdded: courtCount },
    };
  }

  cleanup() {
    const now = Date.now();
    this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
    this.db.prepare("DELETE FROM court_reports WHERE expires_at <= ?").run(now);
  }

  close() {
    this.db.close();
  }
}

function reviewSelect() {
  return `
    SELECT reviews.*, users.username, users.display_name
    FROM reviews
    JOIN users ON users.id = reviews.user_id
  `;
}

function reportSelect() {
  return `
    SELECT court_reports.*, users.username, users.display_name
    FROM court_reports
    JOIN users ON users.id = court_reports.user_id
  `;
}

function communityCourtSelect() {
  return `
    SELECT community_courts.*, users.username, users.display_name
    FROM community_courts
    JOIN users ON users.id = community_courts.user_id
  `;
}

function publicUser(row) {
  return {
    id: Number(row.id),
    username: row.username,
    displayName: row.display_name,
    bio: row.bio,
    avatarUrl: row.avatar_url || "",
    authProvider: row.auth_provider || "password",
    createdAt: Number(row.created_at),
  };
}

function normalizeReview(row) {
  return {
    id: Number(row.id),
    courtId: row.court_id,
    rating: Number(row.rating),
    comment: row.comment,
    markings: row.markings,
    net: row.net,
    surface: row.surface,
    lighting: row.lighting,
    shelter: row.shelter,
    noise: row.noise,
    photoUrl: row.photo_path ? `/uploads/${row.photo_path}` : "",
    createdAt: Number(row.created_at),
    author: {
      username: row.username,
      displayName: row.display_name,
    },
  };
}

function normalizeReport(row) {
  return {
    id: Number(row.id),
    courtId: row.court_id,
    status: row.status,
    players: Number(row.players),
    note: row.note,
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
    author: {
      username: row.username,
      displayName: row.display_name,
    },
  };
}

function normalizeCommunityCourt(row) {
  return {
    id: row.id,
    name: row.name,
    lat: Number(row.lat),
    lon: Number(row.lon),
    town: row.town,
    address: row.address,
    courtType: row.court_type,
    markings: row.markings,
    net: row.net,
    surface: row.surface,
    lighting: row.lighting,
    sheltered: row.shelter,
    noise: row.noise,
    photoUrl: row.photo_path ? `/uploads/${row.photo_path}` : "",
    createdAt: Number(row.created_at),
    source: "Community",
    submittedBy: {
      username: row.username,
      displayName: row.display_name,
    },
  };
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

module.exports = {
  DinkWhereDatabase,
  REPORT_TTL_MS,
  SESSION_TTL_MS,
};
