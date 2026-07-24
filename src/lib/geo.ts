// 高德 Web 服务 API（服务端调用）：POI 搜索与地理编码

export interface PoiResult {
  name: string;
  address: string | null;
  district: string;
  lng: number;
  lat: number;
}

interface AmapPoiRaw {
  name?: string;
  address?: string | string[];
  location?: string;
  pname?: string;
  cityname?: string;
  adname?: string;
}

export async function searchPois(
  webKey: string,
  keywords: string,
  city?: string,
  limit = 8,
  cityLimit = false,
): Promise<PoiResult[]> {
  const url = new URL("https://restapi.amap.com/v3/place/text");
  url.searchParams.set("keywords", keywords);
  url.searchParams.set("key", webKey);
  url.searchParams.set("offset", String(limit));
  url.searchParams.set("page", "1");
  url.searchParams.set("citylimit", cityLimit ? "true" : "false");
  if (city?.trim()) url.searchParams.set("city", city.trim());

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const data = (await res.json()) as {
      status?: string;
      info?: string;
      pois?: AmapPoiRaw[];
    };
    if (data.status !== "1") {
      throw new Error(`高德搜索失败：${data.info ?? "未知错误"}`);
    }
    const pois: PoiResult[] = [];
    for (const poi of data.pois ?? []) {
      const [lngStr, latStr] = (poi.location ?? "").split(",");
      const lng = Number(lngStr);
      const lat = Number(latStr);
      if (!poi.name || !Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      const address = Array.isArray(poi.address) ? null : poi.address?.trim() || null;
      const district = [poi.pname, poi.cityname, poi.adname]
        .filter((part, idx, arr) => part && arr.indexOf(part) === idx)
        .join("");
      pois.push({ name: poi.name, address, district, lng, lat });
    }
    return pois;
  } finally {
    clearTimeout(timer);
  }
}

// 取第一个匹配结果（AI 生成行程的坐标落地用），失败时静默返回 null。
// 先限制在目的地城市内找（避免同名地点匹配到外地），找不到再放开全国
export async function geocodeFirst(
  webKey: string,
  keywords: string,
  city?: string,
): Promise<PoiResult | null> {
  try {
    if (city?.trim()) {
      const strict = await searchPois(webKey, keywords, city, 1, true);
      if (strict[0]) return strict[0];
    }
    const loose = await searchPois(webKey, keywords, city, 1, false);
    return loose[0] ?? null;
  } catch {
    return null;
  }
}

// 逆地理编码：坐标 → 地址描述（地图选点定位用），失败静默返回 null
export async function regeoAddress(webKey: string, lng: number, lat: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const url = new URL("https://restapi.amap.com/v3/geocode/regeo");
    url.searchParams.set("location", `${lng.toFixed(6)},${lat.toFixed(6)}`);
    url.searchParams.set("key", webKey);
    const res = await fetch(url, { signal: controller.signal });
    const data = (await res.json()) as {
      status?: string;
      regeocode?: { formatted_address?: string | string[] };
    };
    if (data.status !== "1") return null;
    const addr = data.regeocode?.formatted_address;
    return typeof addr === "string" && addr.trim() ? addr.trim() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
