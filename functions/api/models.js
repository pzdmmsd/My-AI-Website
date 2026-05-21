import {
  defaultModel,
  fallbackModels,
  json,
  readCachedModels,
  refreshModelCache,
  shouldRefresh
} from "../_models.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const forceRefresh = url.searchParams.get("refresh") === "1";

  if (env.APP_PASSWORD) {
    const providedPassword = request.headers.get("X-App-Password") || "";
    if (providedPassword !== env.APP_PASSWORD) {
      return json({ error: "Invalid app password.", models: [], default_model: defaultModel(env) }, 401);
    }
  }

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
