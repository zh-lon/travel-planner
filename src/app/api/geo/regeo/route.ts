import { NextResponse } from "next/server";
import { regeoAddress } from "@/lib/geo";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

// 逆地理编码代理：?lng=&lat= → 地址描述
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lng = Number(searchParams.get("lng"));
  const lat = Number(searchParams.get("lat"));
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return NextResponse.json({ ok: false, error: "坐标参数不合法" });
  }

  const settings = await getSettings();
  const webKey = (settings["amap.webKey"] ?? "").trim();
  if (!webKey) {
    return NextResponse.json({ ok: false, error: "未配置高德 Web 服务 Key" });
  }

  const address = await regeoAddress(webKey, lng, lat);
  return NextResponse.json({ ok: true, address });
}
