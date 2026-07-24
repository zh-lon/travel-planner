import { prisma } from "@/lib/db";

export const SETTING_KEYS = [
  "ai.protocol", // "openai" | "anthropic"
  "ai.baseUrl",
  "ai.apiKey",
  "ai.model",
  "amap.jsKey", // 高德 JS API Key（前端地图渲染）
  "amap.securityCode", // 高德 JS API 安全密钥
  "amap.webKey", // 高德 Web 服务 Key（服务端 POI 搜索/地理编码）
  "qweather.host", // 和风天气专属 API Host（选填）
  "qweather.key", // 和风天气 Key（选填）
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];
export type SettingsMap = Partial<Record<SettingKey, string>>;

export function isSettingKey(key: string): key is SettingKey {
  return (SETTING_KEYS as readonly string[]).includes(key);
}

export async function getSettings(): Promise<SettingsMap> {
  const rows = await prisma.setting.findMany();
  const map: SettingsMap = {};
  for (const row of rows) {
    if (isSettingKey(row.key)) {
      map[row.key] = row.value;
    }
  }
  return map;
}

export async function saveSettings(values: SettingsMap): Promise<void> {
  const entries = Object.entries(values).filter(([key]) => isSettingKey(key));
  await prisma.$transaction(
    entries.map(([key, value]) =>
      prisma.setting.upsert({
        where: { key },
        update: { value: value ?? "" },
        create: { key, value: value ?? "" },
      }),
    ),
  );
}
