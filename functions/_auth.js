// ──────────────────────────────────────────────
// Authentication utilities for Cloudflare Workers
// ──────────────────────────────────────────────

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

/** Generate a cryptographically random hex string */
export function generateToken(byteLength = 32) {
  const buf = new Uint8Array(byteLength);
  crypto.getRandomValues(buf);
  return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Derive a PBKDF2 hash from a plaintext password and hex salt */
export async function hashPassword(password, saltHex) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const saltBytes = hexToBytes(saltHex);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations: 100_000 },
    keyMaterial,
    256
  );
  return bytesToHex(new Uint8Array(bits));
}

function hexToBytes(hex) {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value) {
  const bits = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(bits));
}

export function userSessionVersion(user) {
  return user.sessionVersion || user.passwordChangedAt || user.createdAt || "";
}

async function adminSessionVersion(env) {
  if (!env.ADMIN_PASSWORD) return "";
  return sha256Hex(env.ADMIN_PASSWORD);
}

/** Validate session token from KV; returns { username, isAdmin } or null */
export async function validateSession(kv, token) {
  if (!token || typeof token !== "string" || token.length < 16) return null;
  const raw = await kv.get(`session:${token}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw); // { username, isAdmin }
  } catch {
    return null;
  }
}

/** Extract session token from request headers */
export function getToken(request) {
  return request.headers.get("X-Session-Token") || null;
}

/** Middleware: require a valid session. Returns { username, isAdmin } or a Response */
export async function requireAuth(context) {
  const { request, env } = context;
  if (!env.CHAT_KV) return jsonFail("KV not configured.", 500);
  const token = getToken(request);
  const session = await validateSession(env.CHAT_KV, token);
  if (!session) return jsonFail("Not authenticated.", 401);

  if (session.isAdmin) {
    const adminUser = (env.ADMIN_USERNAME || "").trim().toLowerCase();
    if (!adminUser || !env.ADMIN_PASSWORD || session.username !== adminUser) {
      return jsonFail("Not authenticated.", 401);
    }
    if (session.sessionVersion !== await adminSessionVersion(env)) {
      return jsonFail("Not authenticated.", 401);
    }
    return session;
  }

  if (!session.username || typeof session.username !== "string") {
    return jsonFail("Not authenticated.", 401);
  }

  const user = await getUser(env.CHAT_KV, session.username);
  if (!user || session.sessionVersion !== userSessionVersion(user)) {
    return jsonFail("Not authenticated.", 401);
  }

  return session;
}

/** Middleware: require admin session. Returns { username, isAdmin } or a Response */
export async function requireAdmin(context) {
  const result = await requireAuth(context);
  if (result instanceof Response) return result;
  if (!result.isAdmin) return jsonFail("Admin access required.", 403);
  return result;
}

/** Fetch a user record from KV */
export async function getUser(kv, username) {
  if (!username || typeof username !== "string") return null;
  const raw = await kv.get(`user:${username.toLowerCase()}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/** Verify plaintext password against stored user record */
export async function verifyPassword(user, password) {
  const hash = await hashPassword(password, user.salt);
  return hash === user.passwordHash;
}

export async function createAdminSession(kv, username, env) {
  return createSession(kv, username, true, await adminSessionVersion(env));
}

/** Create a new session in KV; returns the token */
export async function createSession(kv, username, isAdmin, sessionVersion = "") {
  const token = generateToken();
  await kv.put(
    `session:${token}`,
    JSON.stringify({ username, isAdmin, sessionVersion }),
    { expirationTtl: SESSION_TTL_SECONDS }
  );
  return token;
}

/** JSON error response helper */
export function jsonFail(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

/** JSON success response helper */
export function jsonOk(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}
