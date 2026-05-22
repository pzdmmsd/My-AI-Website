import {
  defaultModel,
  fallbackModels,
  json,
  readCachedModels,
  refreshModelCache,
  shouldRefresh
} from "../_models.js";
import { requireAuth } from "../_auth.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const forceRefresh = url.searchParams.get("refresh") === "1";

  const session = await requireAuth(context);
  if (session instanceof Response) return session;

  if (!env.NVIDIA_API_KEY) {
    return json({
      error: "NVIDIA_API_KEY is not configured.",
      models: fallbackModels,
      default_model: defaultModel(env),
      checked_at: null,
      source: "fallback"
    });
  }

  const cached = await readCachedModels(request);
  if (cached && !forceRefresh) {
    if (shouldRefresh(cached)) {
      context.waitUntil(refreshModelCache(request, env));
    }
    return json({ ...cached, refreshing: shouldRefresh(cached) });
  }

  if (forceRefresh) {
    return json(await refreshModelCache(request, env));
  }

  context.waitUntil(refreshModelCache(request, env));
  return json({
    models: fallbackModels,
    default_model: defaultModel(env),
    checked_at: null,
    refreshing: true,
    source: "fallback-refreshing"
  });
}
