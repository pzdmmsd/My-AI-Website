import {
  jsonFail, jsonOk, getUser, verifyPassword,
  createSession, createAdminSession, userSessionVersion
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
  const adminUser = (env.ADMIN_USERNAME || "").trim().toLowerCase();
  if (username === adminUser && env.ADMIN_PASSWORD) {
    if (password !== env.ADMIN_PASSWORD) {
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
