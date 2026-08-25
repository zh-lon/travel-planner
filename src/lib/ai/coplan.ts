// AI 共同创作：聊天式逐天规划的提示词构建与输出解析
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import { z } from "zod";
import { ITEM_JSON_SHAPE_NO_STAY } from "./generate";
import { parseJsonLoose, looseDaySchema, normalizeDay } from "./schema";
import type { ChatMessage } from "./client";
import type { AiPlanDay, AiPlanItem } from "@/types";

dayjs.locale("zh-cn");

export interface CoplanParams {
  destination: string;
  startDate: string; // YYYY-MM-DD
  days: number;
  focusDay: number; // 0-based
  confirmedDays: { dayIndex: number; items: AiPlanItem[] }[];
  messages: { role: "user" | "assistant"; content: string }[];
  searchContext?: string;
}

export function buildCoplanPrompt(p: CoplanParams): ChatMessage[] {
  const start = dayjs(p.startDate);
  const focusDate = start.add(p.focusDay, "day");
  const confirmed = p.confirmedDays
    .slice()
    .sort((a, b) => a.dayIndex - b.dayIndex)
    .map((d) => ({
      day: d.dayIndex + 1,
      items: d.items.map((i) => ({
        type: i.type,
        title: i.title,
        startTime: i.startTime ?? "",
        endTime: i.endTime ?? "",
        placeName: i.placeName ?? "",
      })),
    }));
  const system = `你是资深的国内旅行规划师，正在和用户一起逐天共同创作一份旅行行程。
行程背景：目的地 ${p.destination}，${start.format("YYYY年M月D日 dddd")}出发，共 ${p.days} 天。
当前正在规划：第 ${p.focusDay + 1} 天（${focusDate.format("M月D日 dddd")}）。
${confirmed.length ? `已确认的天（只读上下文，不要改动，规划时注意动线衔接）：\n${JSON.stringify({ confirmedDays: confirmed })}\n` : ""}${p.searchContext ? `网络搜索参考（仅供参考，需结合实际判断时效性与准确性）：\n${p.searchContext}\n` : ""}
工作方式：根据用户的想法为当前这一天给出行程提议（4~7 个行程项，时间从早到晚互不重叠、动线合理），用户会勾选保留并可能提出修改意见；用户没有明确想法时你也要主动给出提议。若确实需要先向用户确认关键信息，可以只回复问题、不给提议（day 填 null）。
如果目的地含多个城市，规划当天行程时注意是否涉及城市间交通（如当天需从昆明到大理，应安排城际交通行程项，type 为 TRANSPORT，title 如「昆明→大理 高铁」）；theme 体现当天所在城市。
你只输出一个 JSON 对象，不要任何解释文字，不要 Markdown 代码块，结构：
{"reply":"给用户的简短聊天回复（1~3 句，说明思路或提问）","day":{"theme":"当天主题","items":[${ITEM_JSON_SHAPE_NO_STAY}]}}
无提议时 day 为 null。placeName 用规范 POI 名称，交通/自由活动留空字符串；estimatedCost 为人均预估费用（元）；全部使用中文。
重要：不要生成住宿（HOTEL）和餐饮（FOOD）类行程项。用户会自行安排住宿和餐饮，行程中只需安排景点游览、交通和购物等活动。`;
  return [
    { role: "system", content: system },
    ...p.messages.map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
  ];
}

const coplanReplySchema = z.object({
  reply: z.string().catch(""),
  day: looseDaySchema.nullish().catch(null),
});

export function parseCoplanReply(
  raw: string,
): { reply: string; day: AiPlanDay | null } | { error: string } {
  let obj: unknown;
  try {
    obj = parseJsonLoose(raw);
  } catch (err) {
    return { error: `JSON 解析失败（${err instanceof Error ? err.message : "未知错误"}）` };
  }
  const parsed = coplanReplySchema.safeParse(obj);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("；");
    return { error: `结构校验失败（${issues}）` };
  }
  const day = parsed.data.day ? normalizeDay(parsed.data.day) : null;
  const reply = parsed.data.reply.trim() || (day ? "我为这一天拟了一份提议，请查看右侧列表。" : "");
  if (!reply && !day) return { error: "输出既没有回复也没有提议" };
  return { reply, day };
}

// ===== 行程概览模式 =====
export interface OverviewSegment {
  dayStart: number; // 1-based
  dayEnd: number; // 1-based，含首尾
  city: string;
  summary: string;
}

export interface OverviewParams {
  destination: string;
  startDate: string; // YYYY-MM-DD
  days: number;
  messages?: { role: "user" | "assistant"; content: string }[];
  searchContext?: string;
}

export function buildOverviewPrompt(p: OverviewParams): ChatMessage[] {
  const start = dayjs(p.startDate);
  const system = `你是资深的国内旅行规划师。用户正在规划一段旅行，需要你先给出整体行程的大致安排，让用户确认后再逐天细化。
行程背景：目的地 ${p.destination}，${start.format("YYYY年M月D日 dddd")}出发，共 ${p.days} 天。
${p.searchContext ? `网络搜索参考（仅供参考，需结合实际判断时效性与准确性）：\n${p.searchContext}\n` : ""}

请给出每天在哪个城市/区域以及主要游玩方向。你只输出一个 JSON 对象，不要任何解释文字，不要 Markdown 代码块，结构：
{"reply":"简要说明行程安排思路（1~3 句，如整体路线、节奏、亮点）","overview":[{"dayStart":1,"dayEnd":3,"city":"城市名","summary":"该天段主要安排的一句话概述"}]}

要求：
1. dayStart 和 dayEnd 是 1-based 的天数（含首尾），所有天段必须连续覆盖第 1 到 ${p.days} 天，不能有遗漏或重叠；
2. 如果目的地含多个城市，按地理动线合理分配各城市天数（如「昆明、大理、丽江、香格里拉」建议昆明 2~3 天→大理 2~3 天→丽江 2~3 天→香格里拉 1~2 天），城市间安排交通；
3. 如果目的地是单个城市，可按区域或主题分天段；
4. summary 用一句话概括该天段的主要安排和亮点；
5. 全部使用中文。`;
  const msgs = (p.messages ?? []).map(
    (m) => ({ role: m.role, content: m.content }) as ChatMessage,
  );
  if (msgs.length === 0) {
    msgs.push({
      role: "user",
      content: `目的地：${p.destination}，${start.format("YYYY年M月D日")}出发，共 ${p.days} 天。请给出整体行程的大致安排。`,
    });
  }
  return [{ role: "system", content: system }, ...msgs];
}

const overviewSegmentSchema = z.object({
  dayStart: z.coerce.number().int().min(1),
  dayEnd: z.coerce.number().int().min(1),
  city: z.string(),
  summary: z.string(),
});

const overviewReplySchema = z.object({
  reply: z.string().catch(""),
  overview: z.array(overviewSegmentSchema).catch([]),
});

export function parseOverviewReply(
  raw: string,
): { reply: string; overview: OverviewSegment[] } | { error: string } {
  let obj: unknown;
  try {
    obj = parseJsonLoose(raw);
  } catch (err) {
    return { error: `JSON 解析失败（${err instanceof Error ? err.message : "未知错误"}）` };
  }
  const parsed = overviewReplySchema.safeParse(obj);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("；");
    return { error: `结构校验失败（${issues}）` };
  }
  const reply = parsed.data.reply.trim() || "这是我为你的行程拟定的大致安排，请查看右侧概览。";
  const overview = parsed.data.overview.map((seg) => ({
    dayStart: seg.dayStart,
    dayEnd: seg.dayEnd,
    city: seg.city.trim(),
    summary: seg.summary.trim(),
  }));
  if (overview.length === 0) return { error: "概览为空" };
  return { reply, overview };
}
