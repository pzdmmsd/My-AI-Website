import { getToken, jsonOk, jsonFail } from "../../_auth.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.CHAT_KV) return jsonFail("KV not configured.", 500);
  const token = getToken(request);
  if (token) {
    await env.CHAT_KV.delete(`session:${token}`);
  }
  return jsonOk({ ok: true });
}

export function onRequestOptions() {
  return new Response(null, { status: 204 });
}
