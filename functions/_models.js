const DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";
const DEFAULT_MODEL = "google/gemma-4-31b-it";
const CACHE_TTL_SECONDS = 60 * 60 * 6;
const REFRESH_INTERVAL_MS = 60 * 60 * 1000;

export const fallbackModels = ["google/gemma-4-31b-it"];

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

async function verifyModel(endpoint, apiKey, model) {
  const response = await fetch(`${endpoint}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(12000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Reply with ok." }],
      max_tokens: 1,
      temperature: 0,
      stream: false
    })
  });

  return response.ok;
}

async function verifyModels(endpoint, apiKey, models) {
  const verified = [];
  const failures = [];
  let index = 0;
  const workerCount = Math.min(6, models.length);

  async function worker() {
    while (index < models.length) {
      const model = models[index];
      index += 1;
      try {
        if (await verifyModel(endpoint, apiKey, model)) {
          verified.push(model);
        } else {
          failures.push(model);
        }
      } catch {
        failures.push(model);
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker));
  return {
    verified: verified.sort(),
    failures: failures.sort()
  };
}

export async function refreshModelCache(request, env) {
  const endpoint = baseUrl(env);
  const listedModels = await fetchModelIds(endpoint, env.NVIDIA_API_KEY);
  const candidates = listedModels.filter(isLikelyChatModel);
  const { verified, failures } = await verifyModels(endpoint, env.NVIDIA_API_KEY, candidates);
  const models = verified.length ? verified : fallbackModels;
  const preferredDefault = defaultModel(env);

  const payload = {
    models,
    default_model: models.includes(preferredDefault) ? preferredDefault : models[0] || preferredDefault,
    listed_count: listedModels.length,
    candidate_count: candidates.length,
    verified_count: verified.length,
    rejected_count: listedModels.length - verified.length,
    rejected_models: failures,
    checked_at: new Date().toISOString(),
    source: verified.length ? "nvidia-verified-cache" : "fallback"
  };

  await writeCachedModels(request, payload);
  return payload;
}
