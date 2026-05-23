import { hasSearchConfig, sourcesToPrompt, webSearch } from "../_search.js";
import { requireAuth } from "../_auth.js";

const DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";
const DEFAULT_MODEL = "openai/gpt-oss-120b";

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

function fail(message, status = 400) {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return null;

  return messages
    .filter((message) => message && typeof message.content === "string")
    .map((message) => ({
      role: ["system", "user", "assistant"].includes(message.role) ? message.role : "user",
      content: message.content.slice(0, 20000)
    }))
    .slice(-40);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const session = await requireAuth(context);
  if (session instanceof Response) return session;

  if (!env.NVIDIA_API_KEY) {
    return fail("NVIDIA_API_KEY is not configured.", 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return fail("Invalid JSON body.");
  }

  const messages = normalizeMessages(body.messages);
  if (!messages?.length) {
    return fail("At least one message is required.");
  }

  const baseUrl = (env.NVIDIA_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const model = typeof body.model === "string" && body.model.trim()
    ? body.model.trim()
    : env.NVIDIA_MODEL || DEFAULT_MODEL;

  let webSources = [];
  if (body.web_search) {
    if (!hasSearchConfig(env)) {
      return fail("Web mode requires TAVILY_API_KEY or BRAVE_SEARCH_API_KEY.", 500);
    }

    const query = typeof body.search_query === "string" && body.search_query.trim()
      ? body.search_query.trim()
      : messages[messages.length - 1]?.content || "";
    webSources = await webSearch(env, query.slice(0, 500));
    const sourcePrompt = sourcesToPrompt(webSources);
    if (sourcePrompt) {
      messages.unshift({ role: "system", content: sourcePrompt });
    }
  }

  const payload = {
    model,
    messages,
    temperature: Number.isFinite(body.temperature) ? body.temperature : 0.3,
    stream: body.stream !== false
  };

  if (Number.isFinite(body.max_tokens) && body.max_tokens > 0) {
    payload.max_tokens = body.max_tokens;
  }

  const upstream = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
      "Content-Type": "application/json",
      Accept: payload.stream ? "text/event-stream" : "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!upstream.ok) {
    const detail = await upstream.text();
    return fail(detail || `NVIDIA NIM request failed with ${upstream.status}.`, upstream.status);
  }

  if (!payload.stream) {
    return new Response(upstream.body, {
      status: upstream.status,
      headers: jsonHeaders
    });
  }

  if (webSources.length) {
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ web_sources: webSources })}\n\n`));
        const reader = upstream.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
        controller.close();
      }
    });

    return new Response(stream, {
      status: upstream.status,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no"
      }
    });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no"
    }
  });
}

export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: jsonHeaders
  });
}
