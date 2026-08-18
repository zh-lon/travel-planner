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
  city: z.string().nullish().catch(null),
  estimatedCost: z.coerce.number().nonnegative().nullish().catch(null),
  needBooking: z.boolean().nullish().catch(null),
  notes: z.string().nullish().catch(null),
});

const looseDay = z.object({
  theme: z.string().nullish().catch(null),
  items: z.array(looseItem).catch([]),
});

export const looseDaySchema = looseDay;

export const aiPlanSchema = z.object({ days: z.array(looseDay).min(1) });

// 把宽松解析结果规范化为 AiPlanDay（时间/类型/费用清洗）
export function normalizeDay(day: z.infer<typeof looseDay>): AiPlanDay {
  return {
    theme: day.theme?.trim() || null,
    items: day.items.map((item) => ({
      type: ITEM_TYPE_VALUES.includes(item.type.toUpperCase()) ? item.type.toUpperCase() : "OTHER",
      title: item.title.trim(),
      startTime: normalizeTime(item.startTime),
      endTime: normalizeTime(item.endTime),
      placeName: item.placeName?.trim() || null,
      city: item.city?.trim() || null,
      estimatedCost: item.estimatedCost != null ? Math.round(item.estimatedCost * 100) / 100 : null,
      needBooking: item.needBooking === true,
      notes: item.notes?.trim() || null,
      lng: null,
      lat: null,
      address: null,
    })),
  };
}

// 从模型输出中提取 JSON：剥掉 Markdown 代码块，截取首个 { 到最后一个 } 或首个 [ 到最后一个 ]
export function extractJson(raw: string): string {
  let text = raw.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fence) text = fence[1].trim();
  const firstObj = text.indexOf("{");
  const lastObj = text.lastIndexOf("}");
  const firstArr = text.indexOf("[");
  const lastArr = text.lastIndexOf("]");
  // 优先用更靠前的定界符：数组 [ 在 { 前面时取数组，否则取对象
  const arrFirst = firstArr >= 0 && (firstObj < 0 || firstArr < firstObj);
  if (arrFirst && lastArr > firstArr) {
    text = text.slice(firstArr, lastArr + 1);
  } else if (firstObj >= 0 && lastObj > firstObj) {
    text = text.slice(firstObj, lastObj + 1);
  }
  return text;
}

// 修复被截断的 JSON 文本（模型输出达到长度上限时尾部括号缺失）：
// 用带状态的括号栈扫描（区分键/值/字符串内外），按需闭合未结束的字符串、
// 丢弃尾部不完整片段（悬空键名、半截字面量）、补齐右括号
export function repairTruncatedJson(text: string): string {
  // state: key=期待键, colon=键后期待冒号, value=期待/正在读值, after=值已完成期待逗号或收尾
  const stack: Array<{ ch: "{" | "["; state: "key" | "colon" | "value" | "after" }> = [];
  let inString = false;
  let escaped = false;
  let lastComplete = 0; // 最后一个完整值结束的位置（不含其后逗号）
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const frame = stack[stack.length - 1];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') {
        inString = false;
        if (frame?.state === "key") frame.state = "colon";
        else if (frame?.state === "value") {
          frame.state = "after";
          lastComplete = i + 1;
        }
      }
      continue;
    }
    if (c === '"') {
      inString = true;
    } else if (c === "{" || c === "[") {
      stack.push({ ch: c, state: c === "{" ? "key" : "value" });
    } else if (c === "}" || c === "]") {
      if (stack.length > 0) {
        stack.pop();
        const parent = stack[stack.length - 1];
        if (parent) parent.state = "after";
        lastComplete = i + 1;
      }
    } else if (c === ":") {
      if (frame?.state === "colon") frame.state = "value";
    } else if (c === ",") {
      if (frame?.state === "value") lastComplete = i; // 标量值在逗号前结束
      if (frame && (frame.state === "value" || frame.state === "after")) {
        frame.state = frame.ch === "{" ? "key" : "value";
      }
    }
    // 数字/true/false/null/空白等不改变状态
  }

  let out = text;
  const frame = stack[stack.length - 1];
  if (inString) {
    if (frame?.state === "value") {
      out += '"'; // 截断在值字符串内：闭合引号保留（值可能不完整但可用）
    } else {
      out = out.slice(0, lastComplete); // 截断在键字符串内：丢弃悬空键
    }
  } else if (frame?.state === "value") {
    // 尾部是标量：若形似完整数字/字面量则保留，否则丢弃
    const tail = /(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)$/.exec(out.trimEnd());
    if (!tail) out = out.slice(0, lastComplete);
  } else if (frame && frame.state !== "after") {
    out = out.slice(0, lastComplete); // 悬空的键/冒号片段
  }
  // 保底：至少保留首个开括号，避免补括号后得到非法文本
  if (!out.trim() && (text[0] === "{" || text[0] === "[")) out = text[0];
  out = out.replace(/[,:\s]+$/, ""); // 去掉尾部悬空逗号/冒号
  while (stack.length > 0) out += stack.pop()!.ch === "{" ? "}" : "]";
  return out;
}

// 判断模型输出是否被截断（括号未闭合或字符串未结束）
function isTruncatedJson(text: string): boolean {
  let inStr = false;
  let esc = false;
  const stack: string[] = [];
  for (const c of text) {
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") stack.pop();
  }
  return inStr || stack.length > 0;
}

// 解析可能不合法/被截断的模型输出：完整输出直接解析；截断输出先修复再解析
// （截断时不走 extractJson 的收尾括号截取，避免丢失未闭合的数组/对象外层）
export function parseJsonLoose(raw: string): unknown {
  const extracted = extractJson(raw);
  if (!isTruncatedJson(raw)) return JSON.parse(extracted);
  // 兜底一：剥掉代码块后的原始文本从首个定界符开始修复（保住未闭合的外层）
  let text = raw.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fence) text = fence[1].trim();
  const fo = text.indexOf("{");
  const fa = text.indexOf("[");
  const s = fa >= 0 && (fo < 0 || fa < fo) ? fa : fo;
  if (s > 0) text = text.slice(s);
  try {
    return JSON.parse(repairTruncatedJson(text));
  } catch {
    // 兜底二：对 extractJson 截取结果再修复
    const firstObj = extracted.indexOf("{");
    const firstArr = extracted.indexOf("[");
    const start = firstArr >= 0 && (firstObj < 0 || firstArr < firstObj) ? firstArr : firstObj;
    return JSON.parse(repairTruncatedJson(start > 0 ? extracted.slice(start) : extracted));
  }
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
    obj = parseJsonLoose(raw);
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
      city: item.city?.trim() || null,
      estimatedCost: item.estimatedCost != null ? Math.round(item.estimatedCost * 100) / 100 : null,
      needBooking: item.needBooking === true,
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
