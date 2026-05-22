import {
  jsonFail, jsonOk, getUser, verifyPassword,
  adminUsername, createSession, createAdminSession,
  userSessionVersion, verifyAdminPassword
} from "../../_auth.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.CHAT_KV) return jsonFail("KV not configured.", 500);

  let body;
  try { body = await request.json(); } catch { return jsonFail("Invalid JSON."); }

  const username = (body.username || "").trim().toLowerCase();
  const password = body.password || "";
  if (!username || !password) return jsonFail("Username and password required.");

  // ── Check admin credentials (stored in env secrets) ──────────────
  const adminUser = adminUsername(env);
  if (username === adminUser) {
    if (!await verifyAdminPassword(env.CHAT_KV, env, username, password)) {
      return jsonFail("Invalid credentials.", 401);
    }
    const token = await createAdminSession(env.CHAT_KV, username, env);
    return jsonOk({ token, username, isAdmin: true });
  }

  // ── Check regular users stored in KV ─────────────────────────────
  const user = await getUser(env.CHAT_KV, username);
  if (!user) return jsonFail("Invalid credentials.", 401);

  const ok = await verifyPassword(user, password);
  if (!ok) return jsonFail("Invalid credentials.", 401);

  const token = await createSession(env.CHAT_KV, username, false, userSessionVersion(user));
  return jsonOk({ token, username, isAdmin: false });
}

export function onRequestOptions() {
  return new Response(null, { status: 204 });
}
