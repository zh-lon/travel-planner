import { NextResponse } from "next/server";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

interface DailyWeather {
  date: string;
  text: string;
  tempMin: string;
  tempMax: string;
}

// 简单内存缓存（30 分钟），节省和风免费配额
const cache = new Map<string, { ts: number; daily: DailyWeather[] }>();
const CACHE_TTL = 30 * 60 * 1000;

function normalizeHost(raw: string): string {
  return raw.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

// GET /api/weather?city=成都 → 未来 7 天天气（需在设置页配置和风天气）
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const city = (searchParams.get("city") ?? "").trim();
  if (!city) return NextResponse.json({ ok: false, error: "缺少 city 参数" });

  const settings = await getSettings();
  const host = normalizeHost(settings["qweather.host"] ?? "");
  const key = (settings["qweather.key"] ?? "").trim();
  if (!host || !key) {
    return NextResponse.json({ ok: false, disabled: true });
  }

  const hit = cache.get(city);
  if (hit && Date.now() - hit.ts < CACHE_TTL) {
    return NextResponse.json({ ok: true, daily: hit.daily });
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      // 1. 城市查找
      const lookupRes = await fetch(
        `https://${host}/geo/v2/city/lookup?location=${encodeURIComponent(city)}&key=${encodeURIComponent(key)}&number=1`,
        { signal: controller.signal },
      );
      const lookup = (await lookupRes.json()) as {
        code?: string;
        location?: Array<{ id?: string }>;
      };
      if (lookup.code !== "200" || !lookup.location?.[0]?.id) {
        return NextResponse.json({ ok: false, error: `城市查找失败（code ${lookup.code ?? "?"}）` });
      }
      // 2. 7 天预报
      const wxRes = await fetch(
        `https://${host}/v7/weather/7d?location=${lookup.location[0].id}&key=${encodeURIComponent(key)}`,
        { signal: controller.signal },
      );
      const wx = (await wxRes.json()) as {
        code?: string;
        daily?: Array<{ fxDate?: string; textDay?: string; tempMin?: string; tempMax?: string }>;
      };
      if (wx.code !== "200" || !wx.daily) {
        return NextResponse.json({ ok: false, error: `天气查询失败（code ${wx.code ?? "?"}）` });
      }
      const daily: DailyWeather[] = wx.daily.map((d) => ({
        date: d.fxDate ?? "",
        text: d.textDay ?? "",
        tempMin: d.tempMin ?? "",
        tempMax: d.tempMax ?? "",
      }));
      cache.set(city, { ts: Date.now(), daily });
      return NextResponse.json({ ok: true, daily });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
