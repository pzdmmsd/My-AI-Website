import { requireAuth, jsonOk } from "../../_auth.js";

export async function onRequestGet(context) {
  const session = await requireAuth(context);
  if (session instanceof Response) return session;
  return jsonOk({ username: session.username, isAdmin: session.isAdmin });
}

export function onRequestOptions() {
  return new Response(null, { status: 204 });
}
