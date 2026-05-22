import { jsonFail, jsonOk, requireAuth } from "../_auth.js";

const MAX_STATE_BYTES = 10_000_000;

function stateKey(session) {
  return `chat-state:${session.username.toLowerCase()}`;
}

export async function onRequestGet(context) {
  const session = await requireAuth(context);
  if (session instanceof Response) return session;

  const raw = await context.env.CHAT_KV.get(stateKey(session));
  if (!raw) return jsonOk({ state: null, savedAt: null });

  try {
    const payload = JSON.parse(raw);
    return jsonOk({ state: payload.state || null, savedAt: payload.savedAt || null });
  } catch {
    return jsonOk({ state: null, savedAt: null });
  }
}

export async function onRequestPut(context) {
  const session = await requireAuth(context);
  if (session instanceof Response) return session;

  const text = await context.request.text();
  if (text.length > MAX_STATE_BYTES) {
    return jsonFail("Chat state is too large to sync.", 413);
  }

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return jsonFail("Invalid JSON.");
  }

  if (!body || typeof body.state !== "object" || Array.isArray(body.state)) {
    return jsonFail("State object required.");
  }

  const savedAt = new Date().toISOString();
  await context.env.CHAT_KV.put(stateKey(session), JSON.stringify({ state: body.state, savedAt }));
  return jsonOk({ ok: true, savedAt });
}

export function onRequestOptions() {
  return new Response(null, { status: 204 });
}
