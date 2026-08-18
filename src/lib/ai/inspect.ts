// 出发前行程体检：规则检查（纯函数）+ AI 审查（开放时间/闭馆风险/节奏可行性）
import dayjs from "dayjs";
import { z } from "zod";
import { parseJsonLoose } from "./schema";
import type { ChatMessage } from "./client";
import type { DailyWeather } from "@/lib/weather";
import type { ItineraryItemT } from "@/types";

export type InspectLevel = "green" | "yellow" | "red";

export interface InspectFinding {
  id: string; // 稳定 key：`${check}:${itemId|day-N}`
  itemId?: string;
  dayIndex: number;
  level: InspectLevel;
  check: "time-conflict" | "order" | "transit" | "opening" | "weather" | "missing" | "lodging";
  message: string;
  suggestion?: string;
  source: "rule" | "ai";
}

const toMinutes = (t: string | null): number | null => {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
};

function haversineKm(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 交通方式估速（km/h，城市场景保守值）
const SPEED_KMH: Record<string, number> = { walking: 4.5, riding: 15, driving: 30 };

export function runRuleChecks(
  items: ItineraryItemT[],
  dayCount: number,
  defaultTransportMode = "driving",
): InspectFinding[] {
  const findings: InspectFinding[] = [];
  const push = (f: Omit<InspectFinding, "id" | "source">) =>
    findings.push({ ...f, id: `${f.check}:${f.itemId ?? `day-${f.dayIndex}`}`, source: "rule" });

  for (let d = 0; d < dayCount; d++) {
    const dayItems = items
      .filter((i) => i.dayIndex === d)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    // 1. 时间：起止倒挂 / 区间重叠 / 时间与顺序不符
    let prevTimed: { item: ItineraryItemT; start: number; end: number } | null = null;
    for (const item of dayItems) {
      const start = toMinutes(item.startTime);
      const end = toMinutes(item.endTime);
      if (start != null && end != null && start > end) {
        push({
          itemId: item.id,
          dayIndex: d,
          level: "red",
          check: "time-conflict",
          message: `「${item.title}」结束时间早于开始时间（${item.startTime} → ${item.endTime}）`,
          suggestion: "修正该行程项的起止时间",
        });
      }
      if (start != null) {
        if (prevTimed && start < prevTimed.end) {
          const overlapWithEnd = prevTimed.end > start;
          push({
            itemId: item.id,
            dayIndex: d,
            level: overlapWithEnd && prevTimed.start > start ? "red" : "yellow",
            check: prevTimed.start > start ? "order" : "time-conflict",
            message:
              prevTimed.start > start
                ? `「${item.title}」时间（${item.startTime}）早于前一项「${prevTimed.item.title}」，与排列顺序不符`
                : `「${item.title}」（${item.startTime} 开始）与前一项「${prevTimed.item.title}」时间重叠`,
            suggestion:
              prevTimed.start > start ? "调整两项的顺序或时间" : "错开两项的时间安排",
          });
        }
        prevTimed = { item, start, end: end ?? start };
      }
    }

    // 2. 交通衔接：相邻有坐标条目按直线距离与方式估时
    for (let i = 1; i < dayItems.length; i++) {
      const prev = dayItems[i - 1];
      const cur = dayItems[i];
      if (prev.lng == null || prev.lat == null || cur.lng == null || cur.lat == null) continue;
      const prevEnd = toMinutes(prev.endTime) ?? toMinutes(prev.startTime);
      const curStart = toMinutes(cur.startTime);
      if (prevEnd == null || curStart == null) continue;
      const km = haversineKm(prev.lng, prev.lat, cur.lng, cur.lat);
      if (km < 0.3) continue;
      const mode = cur.transportMode || defaultTransportMode;
      const speed = SPEED_KMH[mode] ?? SPEED_KMH.driving;
      // 直线距离 × 1.4 折算实际路程
      const needMin = Math.round(((km * 1.4) / speed) * 60);
      const gapMin = curStart - prevEnd;
      if (gapMin < needMin) {
        const modeLabel = mode === "walking" ? "步行" : mode === "riding" ? "骑行" : "驾车";
        push({
          itemId: cur.id,
          dayIndex: d,
          level: gapMin < needMin / 2 ? "red" : "yellow",
          check: "transit",
          message: `「${prev.title}」→「${cur.title}」约 ${km.toFixed(1)} km，${modeLabel}预计需 ${needMin} 分钟，但仅预留 ${Math.max(gapMin, 0)} 分钟`,
          suggestion: "拉开两项的时间间隔，或调整交通方式",
        });
      }
    }

    // 3. 缺失信息
    for (const item of dayItems) {
      if (item.placeName && (item.lng == null || item.lat == null)) {
        push({
          itemId: item.id,
          dayIndex: d,
          level: "yellow",
          check: "missing",
          message: `「${item.title}」尚未匹配到地图坐标`,
          suggestion: "编辑该项重新搜索地点，或在地图上点选纠正",
        });
      }
      if ((item.type === "SIGHT" || item.type === "FOOD") && !item.startTime) {
        push({
          itemId: item.id,
          dayIndex: d,
          level: "yellow",
          check: "missing",
          message: `「${item.title}」未设置时间`,
          suggestion: "补充开始/结束时间，便于检查当天节奏",
        });
      }
    }

    // 4. 住宿：非末日无 HOTEL
    if (d < dayCount - 1 && dayItems.length > 0 && !dayItems.some((i) => i.type === "HOTEL")) {
      push({
        dayIndex: d,
        level: "yellow",
        check: "lodging",
        message: `第 ${d + 1} 天没有住宿安排`,
        suggestion: "添加一个住宿类行程项，或确认当晚住宿已在其他天覆盖",
      });
    }
  }
  return findings;
}

const RAIN_RE = /雨|雪|冰雹|雷/;

export function runWeatherChecks(
  items: ItineraryItemT[],
  startDate: string,
  dayCount: number,
  daily: DailyWeather[],
): InspectFinding[] {
  const findings: InspectFinding[] = [];
  const byDate = new Map(daily.map((d) => [d.date, d]));
  for (let d = 0; d < dayCount; d++) {
    const date = dayjs(startDate).add(d, "day").format("YYYY-MM-DD");
    const wx = byDate.get(date);
    if (!wx || !RAIN_RE.test(wx.text)) continue;
    const outdoor = items.filter((i) => i.dayIndex === d && i.type === "SIGHT");
    if (outdoor.length === 0) continue;
    findings.push({
      id: `weather:day-${d}`,
      dayIndex: d,
      level: "yellow",
      check: "weather",
      source: "rule",
      message: `第 ${d + 1} 天（${date}）预报「${wx.text}」，安排了 ${outdoor.length} 个景点游览`,
      suggestion: "准备雨具，或考虑替换为室内景点（博物馆/展馆等）",
    });
  }
  return findings;
}

// ---------- AI 审查 ----------

export function buildInspectPrompt(
  destination: string,
  startDate: string,
  dayCount: number,
  items: ItineraryItemT[],
): ChatMessage[] {
  const days = Array.from({ length: dayCount }, (_, d) => ({
    day: d + 1,
    date: dayjs(startDate).add(d, "day").format("YYYY-MM-DD"),
    items: items
      .filter((i) => i.dayIndex === d)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((i) => ({
        type: i.type,
        title: i.title,
        startTime: i.startTime ?? "",
        endTime: i.endTime ?? "",
        placeName: i.placeName ?? "",
      })),
  }));
  return [
    {
      role: "system",
      content: `你是严谨的旅行行程审查员。你将收到一份行程，请从以下角度找出风险点：
1. 开放时间：安排的游览时间是否落在该地点常见的开放时间之外（如博物馆晚上、寺庙清晨等）；
2. 闭馆/预约风险：周一闭馆的博物馆、需提前预约的热门景点、季节性关闭等（结合具体日期与星期判断）；
3. 节奏可行性：单日安排是否过满、跨区域奔波是否现实；
4. 跨城衔接：多城市行程中，城际交通项的时间是否合理（如高铁/飞机需预留换乘时间），到达后是否还有合理时间开始游览。
只报告有把握的问题，不要为凑数而输出；一切正常时输出空数组。
你只输出一个 JSON 对象，不要任何解释文字，不要 Markdown 代码块，结构：
{"findings":[{"dayIndex":0,"itemTitle":"与行程中完全一致的标题，若是整天问题则填空字符串","level":"yellow或red","message":"问题描述","suggestion":"修改建议"}]}
dayIndex 从 0 开始。全部使用中文。`,
    },
    {
      role: "user",
      content: `目的地：${destination}\n出发日期：${dayjs(startDate).format("YYYY年M月D日 dddd")}，共 ${dayCount} 天。\n\n行程 JSON：\n${JSON.stringify({ days })}`,
    },
  ];
}

const aiFindingSchema = z.object({
  findings: z
    .array(
      z.object({
        dayIndex: z.coerce.number().int().min(0).catch(0),
        itemTitle: z.string().catch(""),
        level: z.enum(["yellow", "red"]).catch("yellow"),
        message: z.string().min(1),
        suggestion: z.string().nullish().catch(null),
      }),
    )
    .catch([]),
});

// 解析 AI 审查输出并把 itemTitle 匹配回 itemId；解析失败返回 null（AI 结果仅为增益）
export function parseAiFindings(raw: string, items: ItineraryItemT[]): InspectFinding[] | null {
  let obj: unknown;
  try {
    obj = parseJsonLoose(raw);
  } catch {
    return null;
  }
  const parsed = aiFindingSchema.safeParse(obj);
  if (!parsed.success) return null;
  return parsed.data.findings.map((f, idx) => {
    const title = f.itemTitle.trim();
    const dayItems = items.filter((i) => i.dayIndex === f.dayIndex);
    const match =
      title === ""
        ? undefined
        : (dayItems.find((i) => i.title === title) ??
          dayItems.find((i) => i.title.includes(title) || title.includes(i.title)));
    return {
      id: `opening:ai-${idx}`,
      itemId: match?.id,
      dayIndex: f.dayIndex,
      level: f.level,
      check: "opening" as const,
      source: "ai" as const,
      message: f.message,
      suggestion: f.suggestion ?? undefined,
    };
  });
}
