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
  "search.provider", // 联网搜索服务商：tavily | bocha（选填）
  "search.apiKey", // 联网搜索 API Key（选填）
  "ai.maxTokens", // AI 生成回复的 token 上限（选填，默认 8000）
  "ai.thinkingIntensity", // 思考强度：disabled | low | medium | high（选填，默认 disabled）
  "ai.secondaryModel", // 小模型名（选填，轻量任务用）
  "ai.secondaryProtocol", // 小模型协议（选填，留空则复用主模型协议）
  "ai.secondaryBaseUrl", // 小模型服务地址（选填，留空则复用主模型地址）
  "ai.secondaryApiKey", // 小模型 API Key（选填，留空则复用主模型 Key）
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];
export type SettingsMap = Partial<Record<SettingKey, string>>;

export function isSettingKey(key: string): key is SettingKey {
  return (SETTING_KEYS as readonly string[]).includes(key);
}

export async function getSettings(userId: string): Promise<SettingsMap> {
  const rows = await prisma.userSetting.findMany({ where: { userId } });
  const map: SettingsMap = {};
  for (const row of rows) {
    if (isSettingKey(row.key)) {
      map[row.key] = row.value;
    }
  }
  return map;
}

export async function saveSettings(userId: string, values: SettingsMap): Promise<void> {
  const entries = Object.entries(values).filter(([key]) => isSettingKey(key));
  await prisma.$transaction(
    entries.map(([key, value]) =>
      prisma.userSetting.upsert({
        where: { userId_key: { userId, key } },
        update: { value: value ?? "" },
        create: { userId, key, value: value ?? "" },
      }),
    ),
  );
}
