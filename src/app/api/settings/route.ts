import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { SETTING_KEYS, getSettings, saveSettings, type SettingsMap } from "@/lib/settings";

export const dynamic = "force-dynamic";

// 全局服务配置（AI/地图/天气 Key）：仅管理员可读写
export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  return NextResponse.json(await getSettings());
}

export async function PUT(request: Request) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
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
  await saveSettings(values);
  return NextResponse.json({ ok: true });
}
