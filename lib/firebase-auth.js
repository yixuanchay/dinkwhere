const crypto = require("node:crypto");

const CERT_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
let certificateCache = { expiresAt: 0, certificates: {} };

async function verifyFirebaseIdToken(idToken, projectId, fetchImpl = fetch) {
  if (!idToken || !projectId) throw authError("Google sign-in is not configured");
  const parts = idToken.split(".");
  if (parts.length !== 3) throw authError("Invalid Firebase ID token");

  const header = decodeJson(parts[0]);
  const payload = decodeJson(parts[1]);
  if (header.alg !== "RS256" || !header.kid) throw authError("Invalid Firebase token header");

  const certificates = await firebaseCertificates(fetchImpl);
  const certificate = certificates[header.kid];
  if (!certificate) throw authError("Firebase signing certificate was not found");

  const validSignature = crypto.verify(
    "RSA-SHA256",
    Buffer.from(`${parts[0]}.${parts[1]}`),
    certificate,
    base64UrlBuffer(parts[2]),
  );
  if (!validSignature) throw authError("Invalid Firebase token signature");

  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId) throw authError("Firebase token has the wrong audience");
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw authError("Firebase token has the wrong issuer");
  }
  if (typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 128) {
    throw authError("Firebase token has an invalid subject");
  }
  if (!Number.isFinite(payload.exp) || payload.exp <= now) throw authError("Firebase token has expired");
  if (!Number.isFinite(payload.iat) || payload.iat > now + 60) throw authError("Firebase token is not active");
  if (payload.auth_time && payload.auth_time > now + 60) throw authError("Firebase authentication time is invalid");
  if (!payload.email || payload.email_verified !== true) {
    throw authError("A verified Google email address is required");
  }

  return payload;
}

async function firebaseCertificates(fetchImpl) {
  if (certificateCache.expiresAt > Date.now()) return certificateCache.certificates;
  const response = await fetchImpl(CERT_URL);
  if (!response.ok) throw authError("Could not verify Google sign-in");
  const certificates = await response.json();
  const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get("cache-control") || "")?.[1] || 3600);
  certificateCache = {
    certificates,
    expiresAt: Date.now() + Math.max(maxAge - 60, 60) * 1000,
  };
  return certificates;
}

function decodeJson(value) {
  try {
    return JSON.parse(base64UrlBuffer(value).toString("utf8"));
  } catch {
    throw authError("Invalid Firebase token encoding");
  }
}

function base64UrlBuffer(value) {
  return Buffer.from(value.replaceAll("-", "+").replaceAll("_", "/"), "base64");
}

function authError(message) {
  const error = new Error(message);
  error.status = 401;
  return error;
}

module.exports = { verifyFirebaseIdToken };
