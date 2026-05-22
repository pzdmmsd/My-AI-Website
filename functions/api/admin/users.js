import {
  requireAdmin, jsonOk, jsonFail,
  getUser, hashPassword, generateToken
} from "../../_auth.js";

/** GET /api/admin/users — list all users */
export async function onRequestGet(context) {
  const session = await requireAdmin(context);
  if (session instanceof Response) return session;

  const { env } = context;
  const raw = await env.CHAT_KV.get("userlist");
  const usernames = raw ? JSON.parse(raw) : [];

  const users = await Promise.all(
    usernames.map(async (u) => {
      const user = await getUser(env.CHAT_KV, u);
      return user ? { username: user.username, createdAt: user.createdAt } : null;
    })
  );

  return jsonOk({ users: users.filter(Boolean) });
}

/** POST /api/admin/users — create a user */
export async function onRequestPost(context) {
  const session = await requireAdmin(context);
  if (session instanceof Response) return session;

  const { request, env } = context;
  let body;
  try { body = await request.json(); } catch { return jsonFail("Invalid JSON."); }

  const username = (body.username || "").trim().toLowerCase();
  const password = body.password || "";

  if (!username || !password) return jsonFail("Username and password required.");
  if (!/^[a-z0-9_-]{2,32}$/.test(username)) {
    return jsonFail("Username must be 2-32 chars: letters, numbers, _ or -");
  }
  if (password.length < 6) return jsonFail("Password must be at least 6 characters.");

  // Check not already exists
  const existing = await getUser(env.CHAT_KV, username);
  if (existing) return jsonFail("Username already exists.", 409);

  // Check not admin username
  const adminUser = (env.ADMIN_USERNAME || "").toLowerCase();
  if (username === adminUser) return jsonFail("Cannot create a user with the admin username.", 409);

  const salt = generateToken(16);
  const passwordHash = await hashPassword(password, salt);
  const createdAt = new Date().toISOString();
  const user = { username, passwordHash, salt, createdAt, sessionVersion: createdAt };

  await env.CHAT_KV.put(`user:${username}`, JSON.stringify(user));

  // Update userlist
  const listRaw = await env.CHAT_KV.get("userlist");
  const list = listRaw ? JSON.parse(listRaw) : [];
  if (!list.includes(username)) list.push(username);
  await env.CHAT_KV.put("userlist", JSON.stringify(list));

  return jsonOk({ ok: true, username });
}

/** DELETE /api/admin/users — delete a user { username } */
export async function onRequestDelete(context) {
  const session = await requireAdmin(context);
  if (session instanceof Response) return session;

  const { request, env } = context;
  let body;
  try { body = await request.json(); } catch { return jsonFail("Invalid JSON."); }

  const username = (body.username || "").trim().toLowerCase();
  if (!username) return jsonFail("Username required.");

  const existing = await getUser(env.CHAT_KV, username);
  if (!existing) return jsonFail("User not found.", 404);

  await env.CHAT_KV.delete(`user:${username}`);

  // Update userlist
  const listRaw = await env.CHAT_KV.get("userlist");
  const list = listRaw ? JSON.parse(listRaw) : [];
  await env.CHAT_KV.put("userlist", JSON.stringify(list.filter((u) => u !== username)));

  return jsonOk({ ok: true });
}

/** PUT /api/admin/users — change password { username, newPassword } */
export async function onRequestPut(context) {
  const session = await requireAdmin(context);
  if (session instanceof Response) return session;

  const { request, env } = context;
  let body;
  try { body = await request.json(); } catch { return jsonFail("Invalid JSON."); }

  const username = (body.username || "").trim().toLowerCase();
  const newPassword = body.newPassword || "";

  if (!username || !newPassword) return jsonFail("Username and newPassword required.");
  if (newPassword.length < 6) return jsonFail("Password must be at least 6 characters.");

  const user = await getUser(env.CHAT_KV, username);
  if (!user) return jsonFail("User not found.", 404);

  const salt = generateToken(16);
  const passwordHash = await hashPassword(newPassword, salt);
  await env.CHAT_KV.put(
    `user:${username}`,
    JSON.stringify({ ...user, passwordHash, salt, passwordChangedAt: new Date().toISOString(), sessionVersion: generateToken(16) })
  );

  return jsonOk({ ok: true });
}

export function onRequestOptions() {
  return new Response(null, { status: 204 });
}
