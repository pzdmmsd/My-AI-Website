const DEFAULT_SEARCH_RESULTS = 5;

function normalizeResult(result, index) {
  return {
    index: index + 1,
    title: result.title || result.name || result.url || `Source ${index + 1}`,
    url: result.url,
    snippet: result.content || result.description || result.snippet || ""
  };
}

export function hasSearchConfig(env) {
  return Boolean(env.TAVILY_API_KEY || env.BRAVE_SEARCH_API_KEY);
}

export async function webSearch(env, query) {
  const provider = (env.SEARCH_PROVIDER || (env.TAVILY_API_KEY ? "tavily" : "brave")).toLowerCase();
  const maxResults = Number(env.SEARCH_MAX_RESULTS || DEFAULT_SEARCH_RESULTS);

  if (provider === "brave") {
    return braveSearch(env, query, maxResults);
  }

  return tavilySearch(env, query, maxResults);
}

async function tavilySearch(env, query, maxResults) {
  if (!env.TAVILY_API_KEY) {
    throw new Error("TAVILY_API_KEY is not configured.");
  }

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.TAVILY_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      query,
      search_depth: "basic",
      max_results: maxResults,
      include_answer: false,
      include_raw_content: false
    })
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const payload = await response.json();
  return (payload.results || []).map(normalizeResult).filter((item) => item.url);
}

async function braveSearch(env, query, maxResults) {
  if (!env.BRAVE_SEARCH_API_KEY) {
    throw new Error("BRAVE_SEARCH_API_KEY is not configured.");
  }

  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(Math.min(maxResults, 10)));
  url.searchParams.set("text_decorations", "false");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": env.BRAVE_SEARCH_API_KEY
    }
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const payload = await response.json();
  return (payload.web?.results || []).map(normalizeResult).filter((item) => item.url);
}

export function sourcesToPrompt(sources) {
  if (!sources.length) return "";

  return `Web search results:\n\n${sources
    .map((source) => `[${source.index}] ${source.title}\nURL: ${source.url}\nSnippet: ${source.snippet}`)
    .join("\n\n")}\n\nUse these sources when they are relevant. If you use web information, cite sources with [1], [2], etc.`;
}
