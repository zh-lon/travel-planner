// 地点攻略卡：AI 生成某个行程地点的实用攻略（预约/开放时间/门票/贴士），缓存到 ItineraryItem.guideInfo
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import { z } from "zod";
import { parseJsonLoose } from "./schema";
import type { ChatMessage } from "./client";

dayjs.locale("zh-cn");

export interface PoiGuide {
  summary: string | null; // 一句话介绍
  needReservation: boolean | null; // 是否需要预约
  reservationNote: string | null; // 预约方式/渠道
  openHours: string | null; // 开放时间（含闭馆日）
  ticketPrice: string | null; // 门票
  suggestedDuration: string | null; // 建议游玩时长
  bestTime: string | null; // 最佳时间
  highlights: string[]; // 亮点
  tips: string[]; // 注意事项/避坑
}

const guideSchema = z.object({
  summary: z.string().nullish().catch(null),
  needReservation: z.boolean().nullish().catch(null),
  reservationNote: z.string().nullish().catch(null),
  openHours: z.string().nullish().catch(null),
  ticketPrice: z.string().nullish().catch(null),
  suggestedDuration: z.string().nullish().catch(null),
  bestTime: z.string().nullish().catch(null),
  highlights: z.array(z.string()).catch([]),
  tips: z.array(z.string()).catch([]),
});

export function buildPoiGuidePrompt(params: {
  placeName: string;
  city: string;
  itemType: string;
  visitDate?: string; // YYYY-MM-DD，用于判断星期闭馆
}): ChatMessage[] {
  const dateDesc = params.visitDate
    ? `计划游览日期：${dayjs(params.visitDate).format("YYYY年M月D日 dddd")}。`
    : "";
  return [
    {
      role: "system",
      content: `你是严谨的旅行攻略编辑。用户会给出一个具体地点，请输出该地点的实用攻略信息。
要求：只写你有把握的常识性信息，不确定的字段填 null；门票、开放时间可能变动的要在文案中提示「以官方为准」；tips 重点写预约要求、闭馆日、避坑与实用建议（2~5 条）；highlights 写最值得看/做的点（2~4 条）。
你只输出一个 JSON 对象，不要任何解释文字，不要 Markdown 代码块，结构：
{"summary":"一句话介绍","needReservation":true或false或null,"reservationNote":"预约方式，如需在某公众号提前几天实名预约","openHours":"开放时间与闭馆日","ticketPrice":"门票价格说明","suggestedDuration":"建议游玩时长","bestTime":"最佳游览时间","highlights":["亮点1"],"tips":["注意事项1"]}
全部使用中文。`,
    },
    {
      role: "user",
      content: `地点：${params.placeName}（${params.city}，类型：${params.itemType}）。${dateDesc}请给出这个地点的攻略信息。`,
    },
  ];
}

export function parsePoiGuide(raw: string): PoiGuide | null {
  let obj: unknown;
  try {
    obj = parseJsonLoose(raw);
  } catch {
    return null;
  }
  const parsed = guideSchema.safeParse(obj);
  if (!parsed.success) return null;
  const d = parsed.data;
  return {
    summary: d.summary?.trim() || null,
    needReservation: d.needReservation ?? null,
    reservationNote: d.reservationNote?.trim() || null,
    openHours: d.openHours?.trim() || null,
    ticketPrice: d.ticketPrice?.trim() || null,
    suggestedDuration: d.suggestedDuration?.trim() || null,
    bestTime: d.bestTime?.trim() || null,
    highlights: d.highlights.map((s) => s.trim()).filter(Boolean).slice(0, 6),
    tips: d.tips.map((s) => s.trim()).filter(Boolean).slice(0, 8),
  };
}
