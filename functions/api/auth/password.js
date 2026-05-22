import {
  generateToken,
  getUser,
  hashPassword,
  jsonFail,
  jsonOk,
  requireAuth,
  verifyPassword
} from "../../_auth.js";

export async function onRequestPost(context) {
  const session = await requireAuth(context);
  if (session instanceof Response) return session;
  if (session.isAdmin) return jsonFail("Admin password is managed in Cloudflare Pages secrets.", 403);

  let body;
  try {
    body = await context.request.json();
  } catch {
    return jsonFail("Invalid JSON.");
  }

  const currentPassword = body.currentPassword || "";
  const newPassword = body.newPassword || "";
  if (!currentPassword || !newPassword) return jsonFail("Current and new password required.");
  if (newPassword.length < 6) return jsonFail("Password must be at least 6 characters.");

  const user = await getUser(context.env.CHAT_KV, session.username);
  if (!user) return jsonFail("User not found.", 404);
  if (!await verifyPassword(user, currentPassword)) return jsonFail("Invalid current password.", 401);

  const salt = generateToken(16);
  const passwordHash = await hashPassword(newPassword, salt);
  await context.env.CHAT_KV.put(
    `user:${session.username.toLowerCase()}`,
    JSON.stringify({
      ...user,
      passwordHash,
      salt,
      passwordChangedAt: new Date().toISOString(),
      sessionVersion: generateToken(16)
    })
  );

  return jsonOk({ ok: true });
}

export function onRequestOptions() {
  return new Response(null, { status: 204 });
}
