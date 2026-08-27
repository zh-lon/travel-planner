import { NextResponse } from "next/server";
import { searchPois, type PoiResult } from "@/lib/geo";
import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

const MAX_RESULTS = 20;

// 多城市目的地拆分（如「昆明、大理、丽江」→ ["昆明","大理","丽江"]）
function splitCities(city: string): string[] {
  return city
    .trim()
    .split(/[、,，/\s]+/)
    .map((c) => c.trim())
    .filter((c) => c.length >= 2 && c.length <= 10);
}

// POI 搜索代理：?keywords=宽窄巷子&city=成都&type=110000
export async function GET(request: Request) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const { searchParams } = new URL(request.url);
  const keywords = (searchParams.get("keywords") ?? "").trim();
  const city = (searchParams.get("city") ?? "").trim();
  const type = (searchParams.get("type") ?? "").trim();

  if (!keywords && !type) return NextResponse.json({ ok: true, pois: [] });

  const settings = await getSettings(user.id);
  const webKey = settings["amap.webKey"] ?? "";
  if (!webKey) {
    return NextResponse.json({ ok: false, error: "未配置高德 Web 服务 Key，请到设置页填写" });
  }

  try {
    const cities = splitCities(city);

    if (cities.length > 1) {
      // 多城市目的地：逐个城市搜索，合并去重
      const allPois: PoiResult[] = [];
      const seen = new Set<string>();
      const perCity = Math.ceil(MAX_RESULTS / cities.length) + 5;
      for (const c of cities) {
        const pois = await searchPois(
          webKey,
          keywords,
          c,
          perCity,
          true,
          type || undefined,
        );
        for (const poi of pois) {
          const key = `${poi.name}@${poi.lng.toFixed(6)},${poi.lat.toFixed(6)}`;
          if (!seen.has(key)) {
            seen.add(key);
            allPois.push(poi);
          }
        }
        if (allPois.length >= MAX_RESULTS) break;
      }
      return NextResponse.json({ ok: true, pois: allPois.slice(0, MAX_RESULTS) });
    }

    // 单城市：直接搜索（不再用 city 做 keywords 的 fallback）
    const pois = await searchPois(
      webKey,
      keywords,
      city || undefined,
      MAX_RESULTS,
      !!city,
      type || undefined,
    );
    return NextResponse.json({ ok: true, pois });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
