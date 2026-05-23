const DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";
const DEFAULT_MODEL = "openai/gpt-oss-120b";
const CACHE_TTL_SECONDS = 60 * 60 * 6;
const REFRESH_INTERVAL_MS = 60 * 60 * 1000;

export const fallbackModels = ["openai/gpt-oss-120b"];

const excludePatterns = [
  /embed/i,
  /retriever/i,
  /rerank/i,
  /parse/i,
  /reward/i,
  /detector/i,
  /translate/i,
  /calibration/i,
  /gliner/i,
  /nvclip/i,
  /deplot/i,
  /kosmos/i,
  /fuyu/i,
  /vila/i,
  /neva/i,
  /vision/i,
  /vlm/i,
  /multimodal/i,
  /safety/i,
  /guard/i,
  /topic-control/i,
  /pii/i
];

export function defaultModel(env) {
  return env.NVIDIA_MODEL || DEFAULT_MODEL;
}

export function baseUrl(env) {
  return (env.NVIDIA_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

export function cacheKey(request) {
  const url = new URL(request.url);
  return new Request(`${url.origin}/api/models-cache`);
}

export function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export async function readCachedModels(request) {
  const response = await caches.default.match(cacheKey(request));
  if (!response) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function writeCachedModels(request, payload) {
  await caches.default.put(
    cacheKey(request),
    new Response(JSON.stringify(payload), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}`
      }
    })
  );
}

export function shouldRefresh(payload) {
  if (!payload?.checked_at) return true;
  return Date.now() - Date.parse(payload.checked_at) > REFRESH_INTERVAL_MS;
}

function isLikelyChatModel(id) {
  return id && !excludePatterns.some((pattern) => pattern.test(id));
}

async function fetchModelIds(endpoint, apiKey) {
  const upstream = await fetch(`${endpoint}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json"
    }
  });

  if (!upstream.ok) {
    throw new Error(await upstream.text());
  }

  const payload = await upstream.json();
  return [...new Set((payload.data || []).map((item) => item.id).filter(Boolean))].sort();
}

export async function refreshModelCache(request, env) {
  const endpoint = baseUrl(env);
  const listedModels = await fetchModelIds(endpoint, env.NVIDIA_API_KEY);
  const models = listedModels.filter(isLikelyChatModel);
  const preferredDefault = defaultModel(env);

  const payload = {
    models: models.length ? models : fallbackModels,
    default_model: models.includes(preferredDefault) ? preferredDefault : models[0] || preferredDefault,
    listed_count: listedModels.length,
    candidate_count: models.length,
    verified_count: models.length,
    rejected_count: listedModels.length - models.length,
    checked_at: new Date().toISOString(),
    source: models.length ? "nvidia-listed" : "fallback"
  };

  await writeCachedModels(request, payload);
  return payload;
}
