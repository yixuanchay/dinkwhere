const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DinkWhereDatabase } = require("../lib/database");

function createDatabase() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dinkwhere-db-"));
  const databasePath = path.join(directory, "test.sqlite");
  const uploadDirectory = path.join(directory, "uploads");
  return {
    directory,
    databasePath,
    database: new DinkWhereDatabase({ databasePath, uploadDirectory }),
  };
}

test("persists users and authenticates server-side sessions", () => {
  const fixture = createDatabase();
  const user = fixture.database.createUser({
    username: "court_fan",
    displayName: "Court Fan",
    password: "correct-horse",
  });
  assert.equal(user.username, "court_fan");
  assert.equal(fixture.database.verifyUser("court_fan", "wrong"), null);
  assert.equal(fixture.database.verifyUser("court_fan", "correct-horse").id, user.id);

  const token = fixture.database.createSession(user.id);
  assert.equal(fixture.database.userForSession(token).username, "court_fan");
  fixture.database.close();

  const reopened = new DinkWhereDatabase({
    databasePath: fixture.databasePath,
    uploadDirectory: path.join(fixture.directory, "uploads"),
  });
  assert.equal(reopened.userForSession(token).displayName, "Court Fan");
  reopened.close();
  fs.rmSync(fixture.directory, { recursive: true, force: true });
});

test("stores reviews, photos, reports, and public profile history", () => {
  const fixture = createDatabase();
  const user = fixture.database.createUser({
    username: "east_player",
    displayName: "East Player",
    password: "eight-letters",
  });
  const review = fixture.database.addReview({
    courtId: "osm-way-123",
    userId: user.id,
    rating: 4,
    comment: "Good surface and lights.",
    markings: "Temporary tape",
    net: "Bring your own",
    surface: "Good",
    lighting: "Good",
    shelter: "Unsheltered",
    noise: "Near blocks",
    photoPath: "court.webp",
  });
  const report = fixture.database.addReport({
    courtId: "osm-way-123",
    userId: user.id,
    status: "available",
    players: 0,
    note: "Empty now",
  });

  assert.equal(review.photoUrl, "/uploads/court.webp");
  assert.equal(report.author.username, "east_player");
  assert.equal(fixture.database.communityState().reviews.length, 1);

  const profile = fixture.database.publicProfile("EAST_PLAYER");
  assert.equal(profile.stats.reviews, 1);
  assert.equal(profile.stats.reports, 1);
  assert.equal(profile.reviews[0].comment, "Good surface and lights.");

  fixture.database.close();
  fs.rmSync(fixture.directory, { recursive: true, force: true });
});

test("creates and reuses a Google-backed user without enabling password login", () => {
  const fixture = createDatabase();
  const created = fixture.database.upsertGoogleUser({
    firebaseUid: "firebase-user-123",
    email: "Google.Player@example.com",
    displayName: "Google Player",
    avatarUrl: "https://example.com/avatar.png",
  });
  assert.equal(created.username, "google_player");
  assert.equal(created.authProvider, "google");
  assert.equal(created.avatarUrl, "https://example.com/avatar.png");
  assert.equal(fixture.database.verifyUser(created.username, "any-password"), null);

  const reused = fixture.database.upsertGoogleUser({
    firebaseUid: "firebase-user-123",
    email: "Google.Player@example.com",
    displayName: "Updated Player",
    avatarUrl: "https://example.com/new.png",
  });
  assert.equal(reused.id, created.id);
  assert.equal(reused.displayName, "Updated Player");

  fixture.database.close();
  fs.rmSync(fixture.directory, { recursive: true, force: true });
});

test("persists community-submitted courts and attributes them to a profile", () => {
  const fixture = createDatabase();
  const user = fixture.database.createUser({
    username: "court_mapper",
    displayName: "Court Mapper",
    password: "mapping-courts",
  });
  const court = fixture.database.addCommunityCourt({
    id: "community-test-court",
    userId: user.id,
    name: "Blk 123 Test Street Hard Court",
    lat: 1.35,
    lon: 103.85,
    town: "Test Town",
    address: "Blk 123 Test Street",
    courtType: "Multipurpose court",
    markings: "Temporary tape",
    net: "Bring your own",
    surface: "Good",
    lighting: "Limited",
    shelter: "Unsheltered",
    noise: "Near blocks",
    photoPath: "submitted.png",
  });

  assert.equal(court.submittedBy.username, "court_mapper");
  assert.equal(court.photoUrl, "/uploads/submitted.png");
  assert.equal(fixture.database.communityCourts()[0].name, "Blk 123 Test Street Hard Court");
  assert.equal(fixture.database.publicProfile("court_mapper").stats.courtsAdded, 1);

  fixture.database.close();
  fs.rmSync(fixture.directory, { recursive: true, force: true });
});
