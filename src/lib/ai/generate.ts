import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import { geocodeFirst } from "@/lib/geo";
import { getSettings, type SettingsMap } from "@/lib/settings";
import { chat, chatStream, type AiConfig, type AiProtocol, type ChatMessage } from "./client";
import { parsePlan } from "./schema";
import { aiVerifyGeocodeBatch } from "./geo-verify";
import { detectFocusDays } from "./diff";
import type { AiPlan, AiPlanDay, ItineraryItemT, TripDetail } from "@/types";

dayjs.locale("zh-cn");

export function aiConfigFromSettings(settings: SettingsMap): AiConfig | null {
  const maxTokensRaw = settings["ai.maxTokens"];
  const maxTokens = maxTokensRaw ? parseInt(maxTokensRaw, 10) : undefined;
  const config: AiConfig = {
    protocol: (settings["ai.protocol"] || "openai") as AiProtocol,
    baseUrl: (settings["ai.baseUrl"] || "").trim(),
    apiKey: (settings["ai.apiKey"] || "").trim(),
    model: (settings["ai.model"] || "").trim(),
    maxTokens: maxTokens && !isNaN(maxTokens) && maxTokens > 0 ? maxTokens : undefined,
  };
  if (!config.baseUrl || !config.apiKey || !config.model) return null;
  return config;
}

// 单个行程项的 JSON 结构文案（多处提示词共用）
export const ITEM_JSON_SHAPE = `{"type":"SIGHT|TRANSPORT|HOTEL|FOOD|SHOPPING|OTHER","title":"标题","startTime":"09:00","endTime":"11:00","placeName":"可在高德地图搜到的准确地点名，无固定地点则填空字符串","city":"该地点所在城市名，必须与目的地中列出的城市完全一致；单城市目的地填该城市；交通/无固定地点填空字符串","estimatedCost":100,"needBooking":false,"notes":"一句推荐理由或实用提示"}`;

const JSON_CONTRACT = `你只输出一个 JSON 对象，不要任何解释文字，不要 Markdown 代码块。JSON 结构如下：
{"days":[{"theme":"当天主题","items":[${ITEM_JSON_SHAPE}]}]}
硬性要求：
1. days 数组长度必须严格等于行程天数，顺序即第 1..N 天；
2. 每天安排 4~7 个行程项：含重点餐饮、景点游览；首日含抵达交通与入住，末日含返程；
3. 同一天内时间从早到晚、互不重叠；相邻行程项地理位置尽量就近，动线合理；
4. 如果目的地含多个城市，按地理动线合理安排各城市停留天数（如「昆明、大理、丽江、香格里拉」建议昆明 2 天→大理 3 天→丽江 3 天→香格里拉 2 天），城市间转移当天安排城际交通行程项（type 为 TRANSPORT，title 如「昆明→大理 高铁」，placeName 填到达站点或留空）；theme 体现当天所在城市；
5. placeName 用规范 POI 名称（如「宽窄巷子」「成都大熊猫繁育研究基地」），交通/自由活动等留空字符串；
6. city 字段填写该行程项所在城市，必须与目的地中列出的某个城市名完全一致（如目的地为「昆明、大理、丽江」时只能填「昆明」「大理」「丽江」三者之一）；它是用于地图定位的关键信息，填错会导致地点定位到错误城市。交通行程项（如「昆明→大理 高铁」）的 city 填出发城市；无固定地点的项填空字符串；
7. estimatedCost 为人均预估费用（元，可为 0）；全部使用中文；
8. needBooking 表示该地点是否需要提前预约（故宫、国家博物馆、兵马俑等热门场馆通常为 true，无需预约的开放式地点填 false）。`;

export interface GenerateParams {
  destination: string;
  startDate: string; // YYYY-MM-DD
  days: number;
  departure?: string;
  people?: number;
  budgetLevel?: string;
  pace?: string; // 紧凑|适中|休闲
  preferences?: string[];
  mustVisit?: string[];
  extra?: string;
}

export function buildCreatePrompt(p: GenerateParams): ChatMessage[] {
  const start = dayjs(p.startDate);
  const dateDesc = `${start.format("YYYY年M月D日 dddd")}出发，共 ${p.days} 天（${start.format(
    "M月D日",
  )} 至 ${start.add(p.days - 1, "day").format("M月D日")}）`;
  const lines = [
    `请为我规划一份国内旅行行程：`,
    `- 目的地：${p.destination}`,
    `- 日期：${dateDesc}`,
    `- 人数：${p.people ?? 2} 人`,
    `- 预算档位：${p.budgetLevel ?? "舒适"}`,
    `- 节奏：${p.pace ?? "适中"}${p.pace === "紧凑" ? "（每天 6~9 个行程项）" : p.pace === "休闲" ? "（每天 2~4 个行程项）" : "（每天 4~7 个行程项）"}`,
  ];
  if (p.departure?.trim()) lines.splice(2, 0, `- 出发地：${p.departure.trim()}`);
  if (p.preferences?.length) lines.push(`- 偏好：${p.preferences.join("、")}`);
  if (p.mustVisit?.length) lines.push(`- 必去地点：${p.mustVisit.join("、")}`);
  if (p.extra?.trim()) lines.push(`- 补充要求：${p.extra.trim()}`);
  return [
    { role: "system", content: `你是资深的国内旅行规划师。请为用户规划一份实用、合理的行程方案。${JSON_CONTRACT}
额外质量要求：
1. 景点安排在常见开放时间内（博物馆/展馆注意周一闭馆），餐饮安排在正常饭点；
2. 各项费用预估符合用户选择的预算档位。` },
    { role: "user", content: lines.join("\n") },
  ];
}

export interface GuideParams {
  content: string;
  destination: string;
  startDate: string; // YYYY-MM-DD
  days?: number; // 不填由 AI 根据攻略判断
}

export function buildGuidePrompt(p: GuideParams): ChatMessage[] {
  const start = dayjs(p.startDate);
  const daysReq = p.days
    ? `行程天数：${p.days} 天（days 数组长度必须严格等于 ${p.days}）`
    : "行程天数：请根据攻略内容合理判断（通常 1~7 天），days 数组长度等于你判断的天数";
  return [
    {
      role: "system",
      content: `你是资深的旅行行程整理师。用户会提供一段旅行攻略文本（可能来自小红书等社交平台，含表情符号、话题标签、口语化表达）。你的任务是把攻略内容提取并整理成按天的结构化行程。${JSON_CONTRACT}
针对攻略提取的额外要求：
1. 尽量保留攻略中出现的具体店名、景点名（写入 title 与 placeName）；
2. 攻略未给出的时间与费用请按常识合理推断；
3. 攻略未按天划分时，按地理动线与游玩节奏合理分天；
4. 忽略攻略中的广告、抽奖、关注引导、无关话题标签等内容；
5. 攻略中的实用提示（如需预约、几点去人少）写入对应行程项的 notes。`,
    },
    {
      role: "user",
      content: `目的地：${p.destination}\n出发日期：${start.format("YYYY年M月D日 dddd")}\n${daysReq}\n\n攻略原文：\n${p.content}`,
    },
  ];
}

export function buildAdjustPrompt(trip: TripDetail, items: ItineraryItemT[], instruction: string): ChatMessage[] {  const dayCount = dayjs(trip.endDate).diff(dayjs(trip.startDate), "day") + 1;
  const paramsDesc = describePlanParams(trip.planParams);
  const current = {
    days: Array.from({ length: dayCount }, (_, d) => ({
      items: items
        .filter((i) => i.dayIndex === d)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((i) => ({
          type: i.type,
          title: i.title,
          startTime: i.startTime ?? "",
          endTime: i.endTime ?? "",
          placeName: i.placeName ?? "",
          estimatedCost: i.estimatedCost ?? 0,
          needBooking: i.needBooking === true,
          notes: i.notes ?? "",
        })),
    })),
  };
  return [
    {
      role: "system",
      content: `你是资深的国内旅行规划师。你将收到一份现有行程和调整要求，请输出调整后的完整行程——必须完整输出所有天的所有行程项，不要只输出改动部分。未被调整要求直接涉及的字段必须从输入 JSON 中逐字复制原值，不得改写、润色、重新措辞或增删——包括标题、类型、地点名、费用、预约状态、备注等。仅当调整要求明确涉及某字段时才可改动该字段（如用户说「只改时间」则仅改 startTime/endTime，其余字段必须与输入完全一致）。若调整要求明确要求增加或减少天数（如「多加一天」「压缩成两天」），days 数组长度按要求变化；否则 days 数组长度必须与现有行程天数保持一致。${paramsDesc ? `\n该行程的规划参数：${paramsDesc}，调整时必须保持与这些参数一致（如偏好含「自驾游」则全程按自驾出行安排，不要出现公共交通换乘）。` : ""}${JSON_CONTRACT}`,
    },
    {
      role: "user",
      content: `目的地：${trip.destination}；行程 ${dayCount} 天，${dayjs(trip.startDate).format(
        "YYYY年M月D日",
      )}出发。

现有行程 JSON：
${JSON.stringify(current)}

调整要求：${instruction.trim()}`,
    },
  ];
}

// 聚焦部分天的调整提示词：只发送关注天的行程项，AI 只输出关注天的 JSON
export function buildAdjustFocusPrompt(
  trip: TripDetail,
  items: ItineraryItemT[],
  instruction: string,
  focusDays: Set<number>,
): ChatMessage[] {
  const dayCount = dayjs(trip.endDate).diff(dayjs(trip.startDate), "day") + 1;
  const paramsDesc = describePlanParams(trip.planParams);
  const sortedFocus = [...focusDays].sort((a, b) => a - b);
  const dayLabels = sortedFocus.map((d) => `第${d + 1}天`).join("、");
  // 只发送关注天的行程项
  const focusCurrent = {
    days: sortedFocus.map((d) => ({
      dayLabel: `第${d + 1}天`,
      items: items
        .filter((i) => i.dayIndex === d)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((i) => ({
          type: i.type,
          title: i.title,
          startTime: i.startTime ?? "",
          endTime: i.endTime ?? "",
          placeName: i.placeName ?? "",
          estimatedCost: i.estimatedCost ?? 0,
          needBooking: i.needBooking === true,
          notes: i.notes ?? "",
        })),
    })),
  };
  // 非关注天的概要（提供全局上下文——前后续衔接、已安排景点等——不要求输出）
  const otherDaysOutline = Array.from({ length: dayCount }, (_, d) => {
    if (focusDays.has(d)) return null;
    const dayItems = items
      .filter((i) => i.dayIndex === d)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    if (dayItems.length === 0) return `第${d + 1}天：（暂无安排）`;
    const summary = dayItems
      .map((i) => {
        const time = i.startTime ? `${i.startTime}${i.endTime ? `-${i.endTime}` : ""} ` : "";
        const place = i.placeName ? `（${i.placeName}）` : "";
        return `${time}${i.title}${place}`;
      })
      .join(" → ");
    return `第${d + 1}天：${summary}`;
  })
    .filter(Boolean)
    .join("\n");
  return [
    {
      role: "system",
      content: `你是资深的国内旅行规划师。用户只需调整行程中的${dayLabels}，其他天保持不变也不需输出。你只输出${dayLabels}的行程 JSON：days 数组长度必须为 ${sortedFocus.length}（而非行程总天数 ${dayCount}），数组中各项依次对应${dayLabels}。不要输出其他天的内容。调整时需结合其他天的安排确保动线衔接合理（如与前一天住宿地就近、不与已安排的景点重复、跨城行程保持城市动线一致）。未被调整要求直接涉及的字段必须从输入 JSON 中逐字复制原值，不得改写、润色、重新措辞或增删——包括标题、类型、地点名、费用、预约状态、备注等。仅当调整要求明确涉及某字段时才可改动该字段。${paramsDesc ? `\n该行程的规划参数：${paramsDesc}，调整时必须保持与这些参数一致。` : ""}${JSON_CONTRACT}`,
    },
    {
      role: "user",
      content: `目的地：${trip.destination}；行程 ${dayCount} 天，${dayjs(trip.startDate).format(
        "YYYY年M月D日",
      )}出发。本次只需调整${dayLabels}。

${otherDaysOutline ? `其他天现有安排（仅供参考，保持不变，不要输出）：\n${otherDaysOutline}\n\n` : ""}${dayLabels}现有行程 JSON（需调整的部分）：
${JSON.stringify(focusCurrent)}

调整要求：${instruction.trim()}`,
    },
  ];
}

// 构建确认提示词：让 AI 判断用户指令是否需要向用户确认调整方式
export function buildConfirmPrompt(
  trip: TripDetail,
  items: ItineraryItemT[],
  instruction: string,
): ChatMessage[] {
  const dayCount = dayjs(trip.endDate).diff(dayjs(trip.startDate), "day") + 1;
  const outline = items
    .slice()
    .sort((a, b) => a.dayIndex - b.dayIndex || a.sortOrder - b.sortOrder)
    .map((i) => `第${i.dayIndex + 1}天 ${i.startTime ?? ""} ${i.title}${i.placeName ? `（${i.placeName}）` : ""}`)
    .join("\n")
    .slice(0, 800);
  return [
    {
      role: "system",
      content: `你是旅行规划助手。用户要求调整行程。请根据指令内容自主判断：\n\n1. 用户要调整哪些天的行程。focusDays 是 0-based 的天索引数组（第 1 天 = 0，第 2 天 = 1…）。如果指令涉及所有天或无法确定具体天，返回空数组。\n2. 是否需要先向用户确认后再生成方案。可以提 1-3 个问题，每个问题给出 2-3 个选项。用户会逐个回答所有问题后再生成方案。\n\n无需确认时输出：{"need":false,"focusDays":[0,1]}\n需要确认时输出：{"need":true,"focusDays":[0,1],"questions":[{"question":"简短提问","options":[{"label":"选项","desc":"简述"}]}]}\n\n只输出 JSON。`,
    },
    {
      role: "user",
      content: `行程：${trip.destination}，${dayCount} 天\n现有安排：\n${outline}\n\n用户指令：${instruction}`,
    },
  ];
}

// 解析确认结果
export interface ConfirmQuestion {
  question: string;
  options: Array<{ label: string; desc: string }>;
}
export interface ConfirmResult {
  need: boolean;
  questions?: ConfirmQuestion[];
  focusDays?: number[]; // 0-based 天索引，空数组或 undefined 表示所有天
}

export function parseConfirmResult(raw: string): ConfirmResult {
  try {
    const parsed = JSON.parse(raw);
    // 解析 focusDays（need 为 true 或 false 都可能返回）
    const focusDays = Array.isArray(parsed.focusDays)
      ? parsed.focusDays.filter((d: unknown) => typeof d === "number" && d >= 0) as number[]
      : undefined;
    if (parsed.need === false) return { need: false, focusDays };
    // 新格式：questions 数组
    if (parsed.need === true && Array.isArray(parsed.questions) && parsed.questions.length > 0) {
      const questions = parsed.questions
        .filter((q: Record<string, unknown>) => Array.isArray(q?.options) && q.options.length > 0)
        .map((q: Record<string, unknown>) => ({
          question: typeof q.question === "string" ? q.question : "请选择调整方式",
          options: (q.options as Record<string, unknown>[])
            .filter((o) => typeof o?.label === "string")
            .map((o) => ({
              label: o.label as string,
              desc: typeof o.desc === "string" ? o.desc : "",
            })),
        }))
        .filter((q: { question: string; options: Array<{ label: string; desc: string }> }) => q.options.length > 0);
      if (questions.length > 0) return { need: true, questions, focusDays };
    }
    // 旧格式兼容：单个 question + options
    if (parsed.need === true && Array.isArray(parsed.options) && parsed.options.length > 0) {
      return {
        need: true,
        questions: [{
          question: typeof parsed.question === "string" ? parsed.question : "请选择调整方式",
          options: parsed.options
            .filter((o: Record<string, unknown>) => typeof o?.label === "string")
            .map((o: Record<string, unknown>) => ({
              label: o.label as string,
              desc: typeof o.desc === "string" ? o.desc : "",
            })),
        }],
        focusDays,
      };
    }
  } catch {
    // 解析失败，不需要确认
  }
  return { need: false };
}

// 将部分天的 AI 方案合并为完整行程：关注天用 AI 方案，其他天从现有行程项构建
export function mergeFocusPlan(
  partialPlan: AiPlan,
  items: ItineraryItemT[],
  focusDays: Set<number>,
): AiPlan {
  const sortedFocus = [...focusDays].sort((a, b) => a - b);
  const dayCount = Math.max(
    ...items.map((i) => i.dayIndex + 1),
    ...sortedFocus.map((d) => d + 1),
    1,
  );
  const days: AiPlanDay[] = [];
  for (let d = 0; d < dayCount; d++) {
    const focusIdx = sortedFocus.indexOf(d);
    if (focusIdx >= 0 && focusIdx < partialPlan.days.length) {
      days.push(partialPlan.days[focusIdx]);
    } else {
      days.push({
        theme: null,
        items: items
          .filter((i) => i.dayIndex === d)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((i) => ({
            type: i.type,
            title: i.title,
            startTime: i.startTime,
            endTime: i.endTime,
            placeName: i.placeName,
            city: null,
            estimatedCost: i.estimatedCost,
            needBooking: i.needBooking,
            notes: i.notes,
            lng: i.lng,
            lat: i.lat,
            address: i.address,
          })),
      });
    }
  }
  return { days };
}

// 从 day.theme 中提取城市名（AI prompt 约定 theme 体现当天所在城市）
// 如「昆明 · 滇池与市区」→ 「昆明」，「大理古城」→ 「大理」
function extractCityFromTheme(theme: string | null, cities: string[]): string | null {
  if (!theme) return null;
  for (const c of cities) {
    if (theme.includes(c)) return c;
  }
  return null;
}

// 从地点名称中提取城市名（如「大理古城」→ 「大理」，「丽江和府洲际度假酒店」→ 「丽江」）
function extractCityFromPlaceName(placeName: string, cities: string[]): string | null {
  for (const c of cities) {
    if (placeName.includes(c)) return c;
  }
  return null;
}

// 将 AI 给出的 city 字段归一化为目的地列表中的某个城市名。
// AI 可能写成「大理市」「云南省大理」「昆明市」等变体，这里做包含匹配；不在目的地列表里的视为无效（返回 null），
// 避免把"昆明、大理、丽江"这种整串或别的城市名直接传给高德当单城市搜索。
function normalizeItemCity(raw: string | null, cities: string[]): string | null {
  const c = raw?.trim();
  if (!c) return null;
  // 精确命中
  if (cities.includes(c)) return c;
  // 包含命中（处理「大理市」「云南省大理白族自治州」等）
  for (const city of cities) {
    if (c.includes(city)) return city;
  }
  return null;
}

// 坐标落地：批量用高德 POI 搜索匹配（同名去重，串行控制 QPS）；生成/共同创作共用
// 如果传入 aiConfig，还会对定位结果进行 AI 验证与修正
export async function matchPlanCoords(
  plan: AiPlan,
  webKey: string,
  city: string,
  aiConfig?: AiConfig,
): Promise<void> {
  const cache = new Map<string, Awaited<ReturnType<typeof geocodeFirst>>>();
  const cities = city
    .split(/[、,，/\s]+/)
    .map((c) => c.trim())
    .filter((c) => c.length >= 2 && c.length <= 10);
  const isMultiCity = cities.length > 1;
  // 单城市行程：city 必然是单个城市名，可直接作为搜索城市传给 geocodeFirst。
  const singleCity = !isMultiCity ? (cities[0] ?? (city.trim() || undefined)) : undefined;
  let total = 0;
  let located = 0;
  const failed: string[] = [];
  for (const day of plan.days) {
    // 多城市行程：从 theme 提取当天所在城市作为该天的兜底（theme 没体现城市时为 null，不退回整串 city）
    const dayCity = isMultiCity ? extractCityFromTheme(day.theme, cities) : null;
    for (const item of day.items) {
      const name = item.placeName?.trim();
      if (!name) continue;
      total++;
      // 多城市时推断该 item 的搜索城市，优先级：
      //   1. item.city（AI 明确给出的所在城市，归一化到目的地列表）
      //   2. 从 placeName 中提取的城市名
      //   3. 从 day.theme 提取的城市名
      // 都没有则传 undefined（让 geocodeFirst 走全国宽松搜 + 已知 POI 表），绝不可把整串 city 当单城市传
      let itemCity: string | undefined;
      if (isMultiCity) {
        itemCity =
          normalizeItemCity(item.city, cities) ??
          extractCityFromPlaceName(name, cities) ??
          dayCity ??
          undefined;
      } else {
        itemCity = singleCity;
      }
      // 多城市时缓存 key 带上城市，避免不同城市同名地点错误复用
      const cacheKey = isMultiCity ? `${itemCity ?? "_"}#${name}` : name;
      if (!cache.has(cacheKey)) {
        cache.set(cacheKey, await geocodeFirst(webKey, name, itemCity));
      }
      const poi = cache.get(cacheKey) ?? null;
      if (poi) {
        item.lng = poi.lng;
        item.lat = poi.lat;
        item.address = poi.address ?? poi.district ?? null;
        located++;
      } else {
        failed.push(name);
      }
    }
  }
  if (failed.length > 0) {
    console.warn("[matchPlanCoords] 坐标匹配汇总", {
      total,
      located,
      failed: failed.length,
      isMultiCity,
      city,
      failedNames: failed,
    });
  }

  // AI 验证定位结果（可选）
  if (aiConfig && located > 0) {
    const items = plan.days.flatMap((d) =>
      d.items
        .filter((i) => i.placeName)
        .map((i) => ({
          name: i.placeName!,
          city: i.city,
          lng: i.lng,
          lat: i.lat,
          address: i.address,
        })),
    );
    await aiVerifyGeocodeBatch(items, city, webKey, aiConfig);
    // 将修正后的坐标写回原始项
    for (const day of plan.days) {
      for (const item of day.items) {
        if (!item.placeName) continue;
        const verified = items.find((v) => v.name === item.placeName);
        if (verified) {
          item.lng = verified.lng;
          item.lat = verified.lat;
          item.address = verified.address;
        }
      }
    }
  }
}

// 解析行程持久化的规划参数 JSON，转为一段中文描述（无则返回空字符串）
export function describePlanParams(planParams: string | null | undefined): string {
  if (!planParams) return "";
  try {
    const p = JSON.parse(planParams) as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof p.departure === "string" && p.departure.trim()) parts.push(`出发地：${p.departure.trim()}`);
    if (typeof p.people === "number" && p.people > 0) parts.push(`人数：${p.people} 人`);
    if (typeof p.budgetLevel === "string" && p.budgetLevel.trim()) parts.push(`预算档位：${p.budgetLevel.trim()}`);
    if (typeof p.pace === "string" && p.pace.trim()) parts.push(`节奏：${p.pace.trim()}`);
    if (Array.isArray(p.preferences) && p.preferences.length > 0) {
      parts.push(`旅行偏好：${p.preferences.map((x) => String(x)).join("、")}`);
    }
    if (Array.isArray(p.mustVisit) && p.mustVisit.length > 0) {
      parts.push(`必去地点：${p.mustVisit.map((x) => String(x)).join("、")}`);
    }
    if (typeof p.extra === "string" && p.extra.trim()) parts.push(`补充要求：${p.extra.trim()}`);
    return parts.join("；");
  } catch {
    return "";
  }
}

// 构建 AI 助手日常对话的提示词（对话不改变行程，仅回答问题/给建议）
export function buildChatPrompt(
  trip: TripDetail,
  history: ChatMessage[],
  message: string,
  searchContext?: string,
): ChatMessage[] {
  const dayCount = dayjs(trip.endDate).diff(dayjs(trip.startDate), "day") + 1;
  const paramsDesc = describePlanParams(trip.planParams);
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `你是一位贴心专业的国内旅行助手。用户当前正在规划一份行程：目的地「${trip.destination}」，共 ${dayCount} 天（${dayjs(trip.startDate).format("YYYY年M月D日")} 至 ${dayjs(trip.endDate).format("YYYY年M月D日")}）。${paramsDesc ? `\n该行程的规划参数：${paramsDesc}。请务必结合这些参数回答（例如偏好含「自驾游」时，用户是自驾出行，交通建议应围绕驾车路线、停车、加油等，不要推荐公共交通换乘方案）。` : ""}
请结合这份行程上下文与用户自然对话：回答目的地、景点、美食、交通、住宿、天气、注意事项等问题，给出实用、简洁的建议。要求：
1. 用中文回答，语气亲切自然，适当使用 Markdown（列表、加粗）让内容清晰易读；
2. 回答控制在合理篇幅内，不要过度冗长；
3. 不要输出行程 JSON，也不要主动修改行程——用户想调整行程时，提示其直接说出调整要求即可；
4. 如用户的问题与行程中已安排的内容相关，可直接引用行程中的具体安排（如第几天、景点名、时间）来回答。`,
    },
    ...history,
  ];
  let userContent = message;
  if (searchContext) {
    userContent += `\n\n以下是一些联网搜索到的参考信息，请结合这些信息回答：\n${searchContext}`;
  }
  messages.push({ role: "user", content: userContent });
  return messages;
}

// SSE 事件发送器类型（工作流编排与流式响应共用）
export type SseSend = (obj: unknown) => void;

// 工作流步骤事件：start（开始执行）/ done（完成，可带 detail）/ error（失败）
export function sendStep(
  send: SseSend,
  id: string,
  label: string,
  status: "start" | "done" | "error",
  detail?: string,
) {
  send({ type: "step", id, label, status, ...(detail ? { detail } : {}) });
}

// 行程方案生成核心：生成 + 校验重试 + 方案自检 + 坐标落地（不含 SSE 外壳，供调整接口与助手工作流复用）
// 返回 null 表示失败（已通过 send 推送 error 事件）
// resume：从失败步骤续跑——from=selfcheck 跳过生成直接自检；from=coords 跳过生成与自检直接匹配坐标
export async function runPlanGeneration(
  send: SseSend,
  config: AiConfig,
  settings: SettingsMap,
  input: { messages: ChatMessage[]; expectedDays: number; city: string },
  hooks?: {
    onValidated?: (plan: AiPlan) => void;
    onSelfCheckFailed?: (detail: string) => void;
    onSelfCheckDone?: (detail: string, plan: AiPlan) => void;
    onCoordsStart?: () => void;
  },
  resume?: { from: "selfcheck" | "coords"; plan: AiPlan },
): Promise<AiPlan | null> {
  const convo: ChatMessage[] = [...input.messages];
  let plan: AiPlan | null = resume?.plan ?? null;

  if (!resume) {
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !plan; attempt++) {
      send({
        type: "status",
        text: attempt === 1 ? "正在生成行程…" : `输出校验未通过，正在重试（第 ${attempt - 1} 次）…`,
      });
      let raw = "";
      try {
        raw = await chatStream(config, convo, (delta) => send({ type: "delta", text: delta }), config.maxTokens);
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.name === "AbortError"
              ? "AI 调用超时（5 分钟）"
              : err.message
            : String(err);
        send({ type: "error", message: `AI 调用失败：${msg}` });
        return null;
      }
      const result = parsePlan(raw, input.expectedDays, attempt === MAX_ATTEMPTS);
      if ("plan" in result) {
        plan = result.plan;
      } else {
        convo.push({ role: "assistant", content: raw });
        convo.push({
          role: "user",
          content: `你上一次的输出未通过校验：${result.error}。请重新输出完全符合要求的纯 JSON，不要任何其他文字。`,
        });
        send({ type: "status", text: `校验失败：${result.error}` });
      }
    }
  }

  if (!plan) {
    send({ type: "error", message: "多次尝试后仍无法得到合法的行程 JSON，建议更换能力更强的模型后重试" });
    return null;
  }
  if (!resume) hooks?.onValidated?.(plan);

  // 方案自检：审查顺路程度与时段合理性，不合格自动微调；自检失败直接终止工作流
  if (resume?.from !== "coords") {
    send({ type: "status", text: "正在自检方案（顺路程度/时段合理性）…" });
    let checked: { plan: AiPlan; summary: string };
    try {
      checked = await selfCheckPlan(config, plan, input);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      hooks?.onSelfCheckFailed?.(msg);
      send({ type: "error", message: `方案自检失败：${msg}` });
      return null;
    }
    plan = checked.plan;
    hooks?.onSelfCheckDone?.(checked.summary, plan);
  }

  // 坐标落地：批量用高德 POI 搜索匹配（同名去重，串行控制 QPS）
  const webKey = (settings["amap.webKey"] || "").trim();
  if (webKey) {
    hooks?.onCoordsStart?.();
    send({ type: "status", text: "正在匹配地点坐标…" });
    await matchPlanCoords(plan, webKey, input.city, config);
  } else {
    send({ type: "status", text: "未配置高德 Web 服务 Key，已跳过坐标匹配" });
  }

  return plan;
}

// 去掉坐标等落地字段后送审
function stripPlanCoords(plan: AiPlan) {
  return {
    days: plan.days.map((d) => ({
      theme: d.theme ?? "",
      items: d.items.map((i) => ({
        type: i.type,
        title: i.title,
        startTime: i.startTime ?? "",
        endTime: i.endTime ?? "",
        placeName: i.placeName ?? "",
        estimatedCost: i.estimatedCost ?? 0,
        needBooking: i.needBooking === true,
        notes: i.notes ?? "",
      })),
    })),
  };
}

// 方案自检：让 AI 审查顺路程度与时段合理性，不合格自动微调
// 失败（调用异常/输出不合法）时抛出异常，由调用方终止工作流
// 用流式调用：自检需输出完整行程 JSON，耗时较长；非流式时连接长时间无数据，易被中间代理 504 断开
export async function selfCheckPlan(
  config: AiConfig,
  plan: AiPlan,
  input: { expectedDays: number; city: string },
): Promise<{ plan: AiPlan; summary: string }> {
  const clean = stripPlanCoords(plan);
  const raw = await chatStream(
    config,
    [
      {
        role: "system",
        content: `你是细致的旅行方案审查员。请审查给定的行程 JSON，逐项检查：
1. 动线顺路程度：同一天内的顺序是否按地理位置就近安排，有无明显折返绕路；
2. 时段合理性：景点是否排在常见开放时间内（博物馆/展馆类注意周一闭馆）、餐饮是否安排在正常饭点、夜间活动是否错排在白天、相邻项目时间有无重叠；
3. 节奏合理性：单日是否过满（赶场）或过空；
4. 跨城衔接：多城市行程中城际交通项是否合理衔接前后天的城市。
对不合格项直接微调（调整顺序、修正时间或替换为合理方案）：保持 JSON 结构与字段格式完全一致，days 数组长度不变，尽量保留原地点名称与主题。若全部合格，原样返回该 JSON。你只输出一个纯 JSON 对象，不要任何解释文字，不要 Markdown 代码块。`,
      },
      {
        role: "user",
        content: `目的地：${input.city}${input.expectedDays > 0 ? `；行程 ${input.expectedDays} 天` : ""}\n\n行程 JSON：\n${JSON.stringify(clean)}`,
      },
    ],
    () => {
      // 自检输出不需要展示，静默收集即可
    },
    config.maxTokens ?? 8000,
    300000,
  );
  const result = parsePlan(raw, input.expectedDays, true);
  if ("plan" in result) {
    const adjusted = JSON.stringify(stripPlanCoords(result.plan)) !== JSON.stringify(clean);
    return { plan: result.plan, summary: adjusted ? "已微调动线与时段安排" : "检查通过，无需微调" };
  }
  throw new Error("自检输出未通过校验");
}

// SSE 事件：status（进度提示）/ delta（流式文本）/ result（最终方案）/ error
export function planStreamResponse(
  build: (settings: SettingsMap) => Promise<{ messages: ChatMessage[]; expectedDays: number; city: string }>,
  options?: {
    transformPlan?: (plan: AiPlan) => AiPlan;
    preCheck?: (send: (obj: unknown) => void, config: AiConfig, settings: SettingsMap) => Promise<boolean>;
    resultData?: () => Record<string, unknown>;
  },
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          // 客户端已断开
        }
      };
      // 心跳：每 15 秒发一个 SSE 注释，防止 Nginx/Cloudflare 等代理因无数据而超时断连
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          // 客户端已断开
        }
      }, 15000);
      try {
        const settings = await getSettings();
        const config = aiConfigFromSettings(settings);
        if (!config) {
          send({ type: "error", message: "尚未配置 AI 服务，请先到设置页填写服务地址、API Key 和模型名" });
          return;
        }
        // 生成前检查（如确认步骤）：返回 false 表示需要用户确认，终止生成
        if (options?.preCheck) {
          const shouldContinue = await options.preCheck(send, config, settings);
          if (!shouldContinue) return;
        }
        const input = await build(settings);
        const plan = await runPlanGeneration(send, config, settings, input);
        if (plan) {
          const finalPlan = options?.transformPlan ? options.transformPlan(plan) : plan;
          const extras = options?.resultData ? options.resultData() : {};
          send({ type: "result", plan: finalPlan, ...extras });
        }
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // 已关闭
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
    },
  });
}
