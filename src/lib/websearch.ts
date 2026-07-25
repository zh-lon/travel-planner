// 联网搜索适配层：Tavily / 博查（Bocha），返回统一的结果结构
export interface WebSearchResult {
  title: string;
  url: string;
  content: string; // 摘要/正文片段
}

export type SearchProvider = "tavily" | "bocha";

export const SEARCH_PROVIDERS: { value: SearchProvider; label: string }[] = [
  { value: "tavily", label: "Tavily（有免费额度）" },
  { value: "bocha", label: "博查 Bocha（国内）" },
];

function truncate(text: string, max = 500): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export async function webSearch(
  provider: string,
  apiKey: string,
  query: string,
  count = 4,
  timeoutMs = 15000,
  domain?: string, // 限定站点（如 xiaohongshu.com）
): Promise<WebSearchResult[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (provider === "bocha") {
      const res = await fetch("https://api.bochaai.com/v1/web-search", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          query: domain ? `site:${domain} ${query}` : query,
          count,
          summary: true,
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`博查搜索失败 HTTP ${res.status}：${truncate(await res.text(), 200)}`);
      const data = (await res.json()) as {
        data?: { webPages?: { value?: Array<{ name?: string; url?: string; summary?: string; snippet?: string }> } };
      };
      return (data.data?.webPages?.value ?? [])
        .filter((item) => item.name && item.url)
        .map((item) => ({
          title: item.name!,
          url: item.url!,
          content: truncate((item.summary || item.snippet || "").trim()),
        }));
    }

    // 默认 tavily：同时用 Bearer 头与 body api_key 以兼容新旧版本
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: count,
        search_depth: "basic",
        include_answer: false,
        ...(domain ? { include_domains: [domain] } : {}),
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Tavily 搜索失败 HTTP ${res.status}：${truncate(await res.text(), 200)}`);
    const data = (await res.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };
    return (data.results ?? [])
      .filter((item) => item.title && item.url)
      .map((item) => ({
        title: item.title!,
        url: item.url!,
        content: truncate((item.content ?? "").trim()),
      }));
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("搜索请求超时（15 秒）");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
