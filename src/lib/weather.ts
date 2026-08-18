// 和风天气抓取（服务端共享）：/api/weather 路由与行程体检共用
import { getSettings } from "@/lib/settings";

export interface DailyWeather {
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

export type WeatherResult =
  | { ok: true; daily: DailyWeather[] }
  | { ok: false; disabled?: true; error?: string };

// 未来 7 天天气；未配置和风返回 disabled，失败返回 error
export async function fetchDailyWeather(city: string): Promise<WeatherResult> {
  const settings = await getSettings();
  const host = normalizeHost(settings["qweather.host"] ?? "");
  const key = (settings["qweather.key"] ?? "").trim();
  if (!host || !key) return { ok: false, disabled: true };

  const hit = cache.get(city);
  if (hit && Date.now() - hit.ts < CACHE_TTL) {
    return { ok: true, daily: hit.daily };
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
        return { ok: false, error: `城市查找失败（code ${lookup.code ?? "?"}）` };
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
        return { ok: false, error: `天气查询失败（code ${wx.code ?? "?"}）` };
      }
      const daily: DailyWeather[] = wx.daily.map((d) => ({
        date: d.fxDate ?? "",
        text: d.textDay ?? "",
        tempMin: d.tempMin ?? "",
        tempMax: d.tempMax ?? "",
      }));
      cache.set(city, { ts: Date.now(), daily });
      return { ok: true, daily };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
