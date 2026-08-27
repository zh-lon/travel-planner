import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { fetchDailyWeather } from "@/lib/weather";

export const dynamic = "force-dynamic";

// GET /api/weather?city=成都 → 未来 7 天天气（需在设置页配置和风天气）
export async function GET(request: Request) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const { searchParams } = new URL(request.url);
  const city = (searchParams.get("city") ?? "").trim();
  if (!city) return NextResponse.json({ ok: false, error: "缺少 city 参数" });

  const settings = await getSettings(user.id);
  const result = await fetchDailyWeather(city, settings);
  return NextResponse.json(result);
}
