import { NextResponse } from "next/server";
import { webSearch, type WebSearchResult } from "@/lib/websearch";
import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

const MAX_RESULTS = 20;

// 多城市目的地拆分
function splitCities(city: string): string[] {
  return city
    .trim()
    .split(/[、,，/\s]+/)
    .map((c) => c.trim())
    .filter((c) => c.length >= 2 && c.length <= 10);
}

interface WebResultWithCity extends WebSearchResult {
  city: string;
}

// 平台域名映射（"全部"不限定域名，让搜索引擎自由匹配）
const PLATFORM_DOMAINS: Record<string, { label: string; domains?: string[] }> = {
  all: { label: "全部" },
  ctrip: { label: "携程", domains: ["ctrip.com"] },
  mafengwo: { label: "马蜂窝", domains: ["mafengwo.cn"] },
  xiaohongshu: { label: "小红书", domains: ["xiaohongshu.com"] },
  dianping: { label: "大众点评", domains: ["dianping.com"] },
  qunar: { label: "去哪儿", domains: ["qunar.com"] },
  fliggy: { label: "飞猪", domains: ["fliggy.com"] },
  qyer: { label: "穷游", domains: ["qyer.com"] },
};

export async function GET(request: Request) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const { searchParams } = new URL(request.url);
  const keywords = (searchParams.get("keywords") ?? "").trim();
  const destination = (searchParams.get("city") ?? "").trim();
  const platform = (searchParams.get("platform") ?? "all").trim();

  if (!keywords && !destination) {
    return NextResponse.json({ ok: true, results: [] });
  }

  const settings = await getSettings(user.id);
  const provider = settings["search.provider"] ?? "tavily";
  const apiKey = settings["search.apiKey"] ?? "";
  if (!apiKey) {
    return NextResponse.json({
      ok: false,
      error: "未配置联网搜索 API Key，请到设置页填写",
    });
  }

  const platformInfo = PLATFORM_DOMAINS[platform] ?? PLATFORM_DOMAINS.all;
  const domains = platformInfo.domains;

  try {
    const cities = splitCities(destination);

    if (cities.length > 1) {
      // 多城市：逐城市搜索，合并去重
      const allResults: WebResultWithCity[] = [];
      const seenUrls = new Set<string>();
      const perCity = Math.ceil(MAX_RESULTS / cities.length) + 3;

      const tasks = cities.map(async (city) => {
        const query = [keywords, city, "旅游攻略", "路线", "景点"].filter(Boolean).join(" ");
        try {
          const results = await webSearch(provider, apiKey, query, perCity, 15000, domains);
          return results.map((r) => ({ ...r, city }));
        } catch {
          return [] as WebResultWithCity[];
        }
      });

      const cityResults = await Promise.all(tasks);
      for (const items of cityResults) {
        for (const item of items) {
          if (seenUrls.has(item.url)) continue;
          seenUrls.add(item.url);
          allResults.push(item);
          if (allResults.length >= MAX_RESULTS) break;
        }
        if (allResults.length >= MAX_RESULTS) break;
      }

      return NextResponse.json({
        ok: true,
        results: allResults.slice(0, MAX_RESULTS),
        platform: platformInfo.label,
      });
    }

    // 单城市
    const query = [keywords, destination, "旅游攻略", "景点推荐"].filter(Boolean).join(" ");
    const results: WebSearchResult[] = await webSearch(
      provider,
      apiKey,
      query,
      MAX_RESULTS,
      15000,
      domains,
    );
    const withCity: WebResultWithCity[] = results.map((r) => ({
      ...r,
      city: destination,
    }));
    return NextResponse.json({ ok: true, results: withCity, platform: platformInfo.label });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg });
  }
}
