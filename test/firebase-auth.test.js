const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const { verifyFirebaseIdToken } = require("../lib/firebase-auth");

const keys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });

function signedToken(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: "RS256", kid: "test-key", typ: "JWT" });
  const payload = encode({
    aud: "dinkwhere-test",
    iss: "https://securetoken.google.com/dinkwhere-test",
    sub: "firebase-user",
    email: "player@example.com",
    email_verified: true,
    iat: now - 10,
    exp: now + 3600,
    auth_time: now - 10,
    ...overrides,
  });
  const signature = crypto.sign(
    "RSA-SHA256",
    Buffer.from(`${header}.${payload}`),
    keys.privateKey,
  ).toString("base64url");
  const certificate = keys.publicKey.export({ type: "spki", format: "pem" });
  return { token: `${header}.${payload}.${signature}`, certificate };
}

function certificateFetch(certificate) {
  return async () => ({
    ok: true,
    headers: { get: () => "public, max-age=3600" },
    json: async () => ({ "test-key": certificate }),
  });
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

test("verifies Firebase signature and required identity claims", async () => {
  const fixture = signedToken();
  const claims = await verifyFirebaseIdToken(
    fixture.token,
    "dinkwhere-test",
    certificateFetch(fixture.certificate),
  );
  assert.equal(claims.sub, "firebase-user");
  assert.equal(claims.email, "player@example.com");
});

test("rejects a Firebase token for another project", async () => {
  const fixture = signedToken({ aud: "another-project" });
  await assert.rejects(
    verifyFirebaseIdToken(
      fixture.token,
      "dinkwhere-test",
      certificateFetch(fixture.certificate),
    ),
    /wrong audience/,
  );
});
