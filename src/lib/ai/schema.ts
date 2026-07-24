import { z } from "zod";
import { ITEM_TYPE_VALUES } from "@/types/constants";
import type { AiPlan, AiPlanDay } from "@/types";

// 宽容的结构校验：字段缺失/类型轻微不符时兜底，硬伤（days 缺失、title 为空）才报错
const looseItem = z.object({
  type: z.string().catch("OTHER"),
  title: z.string().min(1),
  startTime: z.string().nullish().catch(null),
  endTime: z.string().nullish().catch(null),
  placeName: z.string().nullish().catch(null),
  estimatedCost: z.coerce.number().nonnegative().nullish().catch(null),
  notes: z.string().nullish().catch(null),
});

const looseDay = z.object({
  theme: z.string().nullish().catch(null),
  items: z.array(looseItem).catch([]),
});

export const aiPlanSchema = z.object({ days: z.array(looseDay).min(1) });

// 从模型输出中提取 JSON：剥掉 Markdown 代码块，截取首个 { 到最后一个 }
export function extractJson(raw: string): string {
  let text = raw.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fence) text = fence[1].trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) text = text.slice(first, last + 1);
  return text;
}

function normalizeTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

export function parsePlan(
  raw: string,
  expectedDays: number,
  allowDayMismatch = false,
): { plan: AiPlan } | { error: string } {
  let obj: unknown;
  try {
    obj = JSON.parse(extractJson(raw));
  } catch (err) {
    return { error: `JSON 解析失败（${err instanceof Error ? err.message : "未知错误"}）` };
  }

  const parsed = aiPlanSchema.safeParse(obj);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("；");
    return { error: `结构校验失败（${issues}）` };
  }

  let days: AiPlanDay[] = parsed.data.days.map((day) => ({
    theme: day.theme?.trim() || null,
    items: day.items.map((item) => ({
      type: ITEM_TYPE_VALUES.includes(item.type.toUpperCase()) ? item.type.toUpperCase() : "OTHER",
      title: item.title.trim(),
      startTime: normalizeTime(item.startTime),
      endTime: normalizeTime(item.endTime),
      placeName: item.placeName?.trim() || null,
      estimatedCost: item.estimatedCost != null ? Math.round(item.estimatedCost * 100) / 100 : null,
      notes: item.notes?.trim() || null,
      lng: null,
      lat: null,
      address: null,
    })),
  }));

  if (expectedDays > 0 && days.length !== expectedDays) {
    if (!allowDayMismatch) {
      return { error: `天数不符：要求 ${expectedDays} 天，实际输出 ${days.length} 天` };
    }
    if (days.length > expectedDays) {
      // 多出的天合并进最后一天
      const extras = days.slice(expectedDays);
      days = days.slice(0, expectedDays);
      for (const extra of extras) days[expectedDays - 1].items.push(...extra.items);
    } else {
      while (days.length < expectedDays) days.push({ theme: null, items: [] });
    }
  }

  return { plan: { days } };
}
