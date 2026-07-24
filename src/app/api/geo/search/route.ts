import { NextResponse } from "next/server";
import { searchPois } from "@/lib/geo";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

// POI 搜索代理：?keywords=宽窄巷子&city=成都
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const keywords = (searchParams.get("keywords") ?? "").trim();
  const city = (searchParams.get("city") ?? "").trim();

  if (!keywords) return NextResponse.json({ ok: true, pois: [] });

  const settings = await getSettings();
  const webKey = settings["amap.webKey"] ?? "";
  if (!webKey) {
    return NextResponse.json({ ok: false, error: "未配置高德 Web 服务 Key，请到设置页填写" });
  }

  try {
    const pois = await searchPois(webKey, keywords, city || undefined, 8);
    return NextResponse.json({ ok: true, pois });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
