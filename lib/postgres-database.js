const crypto = require("node:crypto");
const { Pool } = require("pg");

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REPORT_TTL_MS = 90 * 60 * 1000;

class PostgresDinkWhereDatabase {
  constructor({ connectionString }) {
    this.pool = new Pool({
      connectionString,
      max: 5,
      ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
    });
    this.ready = this.migrate();
  }

  async migrate() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        bio TEXT NOT NULL DEFAULT '',
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        firebase_uid TEXT UNIQUE,
        email TEXT,
        avatar_url TEXT NOT NULL DEFAULT '',
        auth_provider TEXT NOT NULL DEFAULT 'password',
        created_at BIGINT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (LOWER(username));

      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at BIGINT NOT NULL,
        created_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS reviews (
        id BIGSERIAL PRIMARY KEY,
        court_id TEXT NOT NULL,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
        comment TEXT NOT NULL,
        markings TEXT NOT NULL DEFAULT 'Unknown',
        net TEXT NOT NULL DEFAULT 'Unknown',
        surface TEXT NOT NULL DEFAULT 'Unknown',
        lighting TEXT NOT NULL DEFAULT 'Unknown',
        shelter TEXT NOT NULL DEFAULT 'Unknown',
        noise TEXT NOT NULL DEFAULT 'Unknown',
        photo_path TEXT,
        created_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS court_reports (
        id BIGSERIAL PRIMARY KEY,
        court_id TEXT NOT NULL,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('available', 'in_use', 'busy', 'unavailable')),
        players INTEGER NOT NULL CHECK (players BETWEEN 0 AND 40),
        note TEXT NOT NULL DEFAULT '',
        created_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS community_courts (
        id TEXT PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        lat DOUBLE PRECISION NOT NULL,
        lon DOUBLE PRECISION NOT NULL,
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
        created_at BIGINT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS reviews_court_created ON reviews(court_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS reviews_user_created ON reviews(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS reports_court_expires ON court_reports(court_id, expires_at DESC);
      CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires_at);
      CREATE INDEX IF NOT EXISTS community_courts_created ON community_courts(created_at DESC);
    `);
  }

  async query(text, values = []) {
    await this.ready;
    return this.pool.query(text, values);
  }

  async createUser({ username, displayName, password }) {
    const salt = crypto.randomBytes(16).toString("hex");
    const result = await this.query(`
      INSERT INTO users (username, display_name, password_salt, password_hash, created_at)
      VALUES ($1, $2, $3, $4, $5) RETURNING *
    `, [username, displayName, salt, hashPassword(password, salt), Date.now()]);
    return publicUser(result.rows[0]);
  }

  async verifyUser(username, password) {
    const result = await this.query("SELECT * FROM users WHERE LOWER(username) = LOWER($1)", [username]);
    const row = result.rows[0];
    if (!row || row.auth_provider !== "password") {
      hashPassword(password, crypto.randomBytes(16).toString("hex"));
      return null;
    }
    const actual = Buffer.from(hashPassword(password, row.password_salt), "hex");
    const expected = Buffer.from(row.password_hash, "hex");
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
    return publicUser(row);
  }

  async getUserById(id) {
    const result = await this.query("SELECT * FROM users WHERE id = $1", [id]);
    return result.rows[0] ? publicUser(result.rows[0]) : null;
  }

  async getUserByUsername(username) {
    const result = await this.query("SELECT * FROM users WHERE LOWER(username) = LOWER($1)", [username]);
    return result.rows[0] ? publicUser(result.rows[0]) : null;
  }

  async upsertGoogleUser({ firebaseUid, email, displayName, avatarUrl }) {
    const existing = await this.query("SELECT * FROM users WHERE firebase_uid = $1", [firebaseUid]);
    if (existing.rows[0]) {
      const result = await this.query(`
        UPDATE users SET display_name = $1, email = $2, avatar_url = $3
        WHERE id = $4 RETURNING *
      `, [displayName, email, avatarUrl, existing.rows[0].id]);
      return publicUser(result.rows[0]);
    }
    const username = await this.availableUsername(email || displayName || "player");
    const salt = crypto.randomBytes(16).toString("hex");
    const result = await this.query(`
      INSERT INTO users (
        username, display_name, bio, password_salt, password_hash,
        firebase_uid, email, avatar_url, auth_provider, created_at
      ) VALUES ($1, $2, '', $3, $4, $5, $6, $7, 'google', $8) RETURNING *
    `, [
      username,
      displayName,
      salt,
      hashPassword(crypto.randomBytes(32).toString("hex"), salt),
      firebaseUid,
      email,
      avatarUrl,
      Date.now(),
    ]);
    return publicUser(result.rows[0]);
  }

  async availableUsername(seed) {
    const base = String(seed)
      .split("@")[0]
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 20) || "player";
    let candidate = base.length >= 3 ? base : `player_${base}`;
    let suffix = 1;
    while (await this.getUserByUsername(candidate)) {
      candidate = `${base.slice(0, 18)}_${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  async updateProfile(userId, { displayName, bio }) {
    const result = await this.query(
      "UPDATE users SET display_name = $1, bio = $2 WHERE id = $3 RETURNING *",
      [displayName, bio, userId],
    );
    return publicUser(result.rows[0]);
  }

  async createSession(userId) {
    const token = crypto.randomBytes(32).toString("base64url");
    const now = Date.now();
    await this.cleanup();
    await this.query(`
      INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
      VALUES ($1, $2, $3, $4)
    `, [tokenHash(token), userId, now + SESSION_TTL_MS, now]);
    return token;
  }

  async userForSession(token) {
    if (!token) return null;
    const result = await this.query(`
      SELECT users.* FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = $1 AND sessions.expires_at > $2
    `, [tokenHash(token), Date.now()]);
    return result.rows[0] ? publicUser(result.rows[0]) : null;
  }

  async deleteSession(token) {
    if (token) await this.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token)]);
  }

  async addReview(review) {
    const result = await this.query(`
      INSERT INTO reviews (
        court_id, user_id, rating, comment, markings, net, surface,
        lighting, shelter, noise, photo_path, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id
    `, [
      review.courtId, review.userId, review.rating, review.comment, review.markings,
      review.net, review.surface, review.lighting, review.shelter, review.noise,
      review.photoPath || null, Date.now(),
    ]);
    return this.reviewById(result.rows[0].id);
  }

  async reviewById(id) {
    const result = await this.query(`${reviewSelect()} WHERE reviews.id = $1`, [id]);
    return result.rows[0] ? normalizeReview(result.rows[0]) : null;
  }

  async addReport(report) {
    const now = Date.now();
    const result = await this.query(`
      INSERT INTO court_reports (
        court_id, user_id, status, players, note, created_at, expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id
    `, [
      report.courtId, report.userId, report.status, report.players, report.note,
      now, now + REPORT_TTL_MS,
    ]);
    return this.reportById(result.rows[0].id);
  }

  async reportById(id) {
    const result = await this.query(`${reportSelect()} WHERE court_reports.id = $1`, [id]);
    return result.rows[0] ? normalizeReport(result.rows[0]) : null;
  }

  async addCommunityCourt(court) {
    await this.query(`
      INSERT INTO community_courts (
        id, user_id, name, lat, lon, town, address, court_type,
        markings, net, surface, lighting, shelter, noise, photo_path, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    `, [
      court.id, court.userId, court.name, court.lat, court.lon, court.town,
      court.address, court.courtType, court.markings, court.net, court.surface,
      court.lighting, court.shelter, court.noise, court.photoPath || null, Date.now(),
    ]);
    return this.communityCourtById(court.id);
  }

  async communityCourtById(id) {
    const result = await this.query(`${communityCourtSelect()} WHERE community_courts.id = $1`, [id]);
    return result.rows[0] ? normalizeCommunityCourt(result.rows[0]) : null;
  }

  async communityCourts() {
    const result = await this.query(`${communityCourtSelect()} ORDER BY community_courts.created_at DESC`);
    return result.rows.map(normalizeCommunityCourt);
  }

  async communityState() {
    await this.cleanup();
    const [reviews, reports] = await Promise.all([
      this.query(`${reviewSelect()} ORDER BY reviews.created_at DESC`),
      this.query(`${reportSelect()} WHERE court_reports.expires_at > $1 ORDER BY court_reports.created_at DESC`, [Date.now()]),
    ]);
    return {
      reviews: reviews.rows.map(normalizeReview),
      reports: reports.rows.map(normalizeReport),
    };
  }

  async publicProfile(username) {
    const user = await this.getUserByUsername(username);
    if (!user) return null;
    const [reviews, reports, courts] = await Promise.all([
      this.query(`${reviewSelect()} WHERE users.id = $1 ORDER BY reviews.created_at DESC`, [user.id]),
      this.query("SELECT COUNT(*) AS count FROM court_reports WHERE user_id = $1", [user.id]),
      this.query("SELECT COUNT(*) AS count FROM community_courts WHERE user_id = $1", [user.id]),
    ]);
    return {
      user,
      reviews: reviews.rows.map(normalizeReview),
      stats: {
        reviews: reviews.rows.length,
        reports: Number(reports.rows[0].count),
        courtsAdded: Number(courts.rows[0].count),
      },
    };
  }

  async cleanup() {
    const now = Date.now();
    await Promise.all([
      this.query("DELETE FROM sessions WHERE expires_at <= $1", [now]),
      this.query("DELETE FROM court_reports WHERE expires_at <= $1", [now]),
    ]);
  }

  async close() {
    await this.pool.end();
  }
}

function reviewSelect() {
  return `SELECT reviews.*, users.username, users.display_name
    FROM reviews JOIN users ON users.id = reviews.user_id`;
}

function reportSelect() {
  return `SELECT court_reports.*, users.username, users.display_name
    FROM court_reports JOIN users ON users.id = court_reports.user_id`;
}

function communityCourtSelect() {
  return `SELECT community_courts.*, users.username, users.display_name
    FROM community_courts JOIN users ON users.id = community_courts.user_id`;
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
    photoUrl: photoUrl(row.photo_path),
    createdAt: Number(row.created_at),
    author: { username: row.username, displayName: row.display_name },
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
    author: { username: row.username, displayName: row.display_name },
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
    photoUrl: photoUrl(row.photo_path),
    createdAt: Number(row.created_at),
    source: "Community",
    submittedBy: { username: row.username, displayName: row.display_name },
  };
}

function photoUrl(value) {
  if (!value) return "";
  return /^https?:\/\//.test(value) ? value : `/uploads/${value}`;
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

module.exports = { PostgresDinkWhereDatabase };
