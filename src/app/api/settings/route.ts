import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { SETTING_KEYS, getSettings, saveSettings, type SettingsMap } from "@/lib/settings";

export const dynamic = "force-dynamic";

// 用户个人服务配置（AI/地图/天气 Key）：每个用户独立配置
export async function GET(request: Request) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  return NextResponse.json(await getSettings(user.id));
}

export async function PUT(request: Request) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }
  const values: SettingsMap = {};
  for (const key of SETTING_KEYS) {
    const value = body[key];
    if (typeof value === "string") {
      values[key] = value.trim();
    }
  }
  await saveSettings(user.id, values);
  return NextResponse.json({ ok: true });
}
