// AI 地理定位验证：对高德定位结果进行 AI 分析，对错误结果尝试修正
import { chat } from "./client";
import type { AiConfig } from "./client";
import { geocodeFirst, KNOWN_CITY_CENTERS } from "@/lib/geo";
import { parseJsonLoose } from "./schema";

// 待验证的定位结果项
export interface GeoVerifyItem {
  name: string;
  city: string | null;
  lng: number | null;
  lat: number | null;
  address: string | null;
}

// 批量验证并修正地理定位结果
// 对 items 中已定位的项调用 AI 分析正确性，对 AI 认为错误的项尝试修正
export async function aiVerifyGeocodeBatch(
  items: GeoVerifyItem[],
  destination: string,
  webKey: string,
  aiConfig: AiConfig,
): Promise<void> {
  // 只验证有坐标的项
  const located = items.filter(
    (i) => i.lng != null && i.lat != null,
  );
  if (located.length === 0) return;

  // ---- 第一步：批量验证 ----
  const verifyPrompt = buildVerifyPrompt(located, destination);
  let verifyRaw: string;
  try {
    verifyRaw = await chat(
      aiConfig,
      [
        {
          role: "system",
          content:
           "你是一个严谨的地理验证专家。请判断列表中每个地点的高德地图定位结果是否正确。\n" +
            "注意：\n" +
            "1. 有些地点因重名可能被定位到其他城市，需要根据地点名和期望城市判断。\n" +
            "2. 地点可能位于目的地城市的周边县市（如德钦位于香格里拉所在的迪庆州内、\n" +
            "   沙溪位于大理州内），这属于正常定位，不应判定为错误。\n" +
            "只输出一个 JSON 数组（不要任何其他文字），每个元素格式：\n" +
            '{"name":"地点名","correct":true/false,"reason":"简要判断理由"}',
        },
        { role: "user", content: verifyPrompt },
      ],
      4096,
      60000,
    );
  } catch (err) {
    console.warn("[aiGeoVerify] 验证调用失败", err instanceof Error ? err.message : String(err));
    return;
  }

  let verifications: Array<{ name: string; correct: boolean; reason: string }>;
  try {
    const parsed = parseJsonLoose(verifyRaw);
    verifications = Array.isArray(parsed) ? parsed : [];
  } catch {
    console.warn("[aiGeoVerify] 验证结果解析失败");
    return;
  }

  // 找出 AI 认为不正确的项
  const needFix = verifications.filter((v) => !v.correct && v.name);
  if (needFix.length === 0) return;

  console.log(
    `[aiGeoVerify] ${needFix.length}/${located.length} 个定位需修正:`,
    needFix.map((v) => `${v.name}（${v.reason}）`).join("; "),
  );

  // ---- 第二步：批量获取修正建议 ----
  const fixPrompt = buildFixPrompt(needFix, located, destination);
  let fixRaw: string;
  try {
    fixRaw = await chat(
      aiConfig,
      [
        {
          role: "system",
          content:
            "你是一个地理专家。下列地点定位错误，请分析它们应在哪里，并给出高德地图上可搜索到的修正关键词。\n" +
            "只输出一个 JSON 数组（不要任何其他文字），每个元素格式：\n" +
            '{"name":"原始地点名","correctedQuery":"修正后的搜索关键词","correctedCity":"所在城市","reason":"分析说明"}',
        },
        { role: "user", content: fixPrompt },
      ],
      4096,
      60000,
    );
  } catch (err) {
    console.warn("[aiGeoVerify] 修正建议调用失败", err instanceof Error ? err.message : String(err));
    return;
  }

  let fixes: Array<{
    name: string;
    correctedQuery: string;
    correctedCity: string;
    reason: string;
  }>;
  try {
    const parsed = parseJsonLoose(fixRaw);
    fixes = Array.isArray(parsed) ? parsed : [];
  } catch {
    console.warn("[aiGeoVerify] 修正建议解析失败");
    return;
  }

  // ---- 第三步：重新定位 ----
  for (const fix of fixes) {
    if (!fix.name || !fix.correctedQuery) continue;
    const item = located.find((i) => i.name === fix.name);
    if (!item) continue;
    // 修正关键词与原名相同则跳过（避免无限循环）
    const query = fix.correctedQuery.trim();
    if (query === item.name) continue;
    const city = fix.correctedCity?.trim() || item.city || destination;

    try {
      const poi = await geocodeFirst(webKey, query, city);
      if (poi) {
        console.log(
          `[aiGeoVerify] 修正定位: "${item.name}" → "${query}" (${
            poi.lng
          },${poi.lat}) 原: (${item.lng},${item.lat})`,
        );
        item.lng = poi.lng;
        item.lat = poi.lat;
        item.address = poi.address ?? poi.district ?? null;
      }
    } catch {
      // 修正失败，保留原结果
    }
  }
}

// 构建验证提示
function buildVerifyPrompt(
  items: GeoVerifyItem[],
  destination: string,
): string {
  const cities = splitDestination(destination);
  const lines: string[] = [];
  if (cities.length > 1) {
    lines.push(`整体目的地：${destination}`);
    lines.push(`目的地包含城市：${cities.join("、")}`);
  } else {
    lines.push(`整体目的地：${destination}`);
    // 查找该目的地对应的周边县市
    const related = getRelatedCities(cities[0]);
    if (related.length > 0) {
      lines.push(`周边区域包括：${related.join("、")}`);
    }
  }
  lines.push("");
  lines.push("请判断以下每个地点的定位结果是否正确：");
  items.forEach((item, i) => {
    lines.push(
      `${i + 1}. "${item.name}" → 定位到 (${item.lng},${item.lat}), 地址: ${item.address ?? "无"}, 期望城市: ${item.city || destination}`,
    );
  });
  return lines.join("\n");
}

// 构建修正提示
function buildFixPrompt(
  needFix: Array<{ name: string }>,
  allItems: GeoVerifyItem[],
  destination: string,
): string {
  const cities = splitDestination(destination);
  const lines: string[] = [];
  if (cities.length > 1) {
    lines.push(`整体目的地：${destination}`);
    lines.push(`目的地包含城市：${cities.join("、")}`);
  } else {
    lines.push(`整体目的地：${destination}`);
    const related = getRelatedCities(cities[0]);
    if (related.length > 0) {
      lines.push(`周边区域包括：${related.join("、")}`);
    }
  }
  lines.push("");
  lines.push("以下地点定位结果不正确，请为每个地点给出修正建议：");
  for (const v of needFix) {
    const item = allItems.find((i) => i.name === v.name);
    if (item) {
      lines.push(
        `- "${item.name}"：当前定位 (${item.lng},${item.lat}), 期望城市 ${item.city || destination}`,
      );
    }
  }
  return lines.join("\n");
}

// 将目的地字符串拆分为城市列表
function splitDestination(destination: string): string[] {
  return destination
    .split(/[、,，/\s]+/)
    .map((c) => c.trim())
    .filter((c) => c.length >= 2);
}

// 查找某个目的地周边相关的县市（从 KNOWN_CITY_CENTERS 中匹配）
// 用于帮助 AI 理解该目的地下的有效区域
function getRelatedCities(destCity: string): string[] {
  const related: string[] = [];
  for (const name of Object.keys(KNOWN_CITY_CENTERS)) {
    if (name === destCity) continue;
    // 如果已知城市名包含目的地城市名（如"大理古城"包含"大理"），则认为是相关
    if (name.includes(destCity) || destCity.includes(name)) {
      related.push(name);
    }
  }
  return related;
}