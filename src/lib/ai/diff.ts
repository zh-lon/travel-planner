// AI 调整方案与现有行程的对比（diff）与合成应用
import { itemTypeMeta } from "@/types/constants";
import type { AiPlan, AiPlanItem, ItineraryItemT } from "@/types";

export type DiffKind = "unchanged" | "modified" | "added" | "removed";

export interface DiffChange {
  label: string;
  from: string;
  to: string;
}

export interface DiffEntry {
  key: string;
  kind: DiffKind;
  dayIndex: number; // 展示归属天（新方案的天；removed 为原天）
  orderInDay: number;
  newItem: AiPlanItem | null;
  oldItem: ItineraryItemT | null;
  changes: DiffChange[];
}

export interface ApplyItemPayload {
  id?: string;
  dayIndex: number;
  sortOrder: number;
  type: string;
  title: string;
  startTime: string | null;
  endTime: string | null;
  placeName: string | null;
  lng: number | null;
  lat: number | null;
  address: string | null;
  estimatedCost: number | null;
  needBooking: boolean;
  notes: string | null;
  aiGenerated: boolean;
}

type Draft = Omit<ApplyItemPayload, "dayIndex" | "sortOrder">;

const norm = (s: string | null | undefined) => (s ?? "").trim();

function fmtTime(start: string | null, end: string | null): string {
  return start ? `${start}${end ? `-${end}` : ""}` : "未设定";
}

function fmtCost(v: number | null): string {
  return v != null ? `¥${v}` : "未设定";
}

function fieldChanges(oldItem: ItineraryItemT, newItem: AiPlanItem, newDay: number): DiffChange[] {
  const changes: DiffChange[] = [];
  if (oldItem.dayIndex !== newDay) {
    changes.push({ label: "天", from: `第${oldItem.dayIndex + 1}天`, to: `第${newDay + 1}天` });
  }
  if (norm(oldItem.type) !== norm(newItem.type)) {
    changes.push({
      label: "类型",
      from: itemTypeMeta(oldItem.type).label,
      to: itemTypeMeta(newItem.type).label,
    });
  }
  if (norm(oldItem.title) !== norm(newItem.title)) {
    changes.push({ label: "标题", from: oldItem.title, to: newItem.title });
  }
  const oldTime = fmtTime(oldItem.startTime, oldItem.endTime);
  const newTime = fmtTime(newItem.startTime, newItem.endTime);
  if (oldTime !== newTime) changes.push({ label: "时间", from: oldTime, to: newTime });
  if (norm(oldItem.placeName) !== norm(newItem.placeName)) {
    changes.push({
      label: "地点",
      from: norm(oldItem.placeName) || "未设定",
      to: norm(newItem.placeName) || "未设定",
    });
  }
  if ((oldItem.estimatedCost ?? null) !== (newItem.estimatedCost ?? null)) {
    changes.push({ label: "费用", from: fmtCost(oldItem.estimatedCost), to: fmtCost(newItem.estimatedCost) });
  }
  if ((oldItem.needBooking ?? false) !== (newItem.needBooking ?? false)) {
    changes.push({
      label: "预约",
      from: oldItem.needBooking ? "需预约" : "无需预约",
      to: newItem.needBooking ? "需预约" : "无需预约",
    });
  }
  if (norm(oldItem.notes) !== norm(newItem.notes)) {
    changes.push({ label: "备注", from: norm(oldItem.notes) || "（空）", to: norm(newItem.notes) || "（空）" });
  }
  return changes;
}

// 编辑距离（Levenshtein），用于标题模糊匹配
function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

// 标题模糊相似度判断：AI 轻微改写标题后仍能匹配同一行程项
function titleSimilar(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  // 包含关系（短的一方长度 ≥ 2，避免单字误匹配）
  const shorter = a.length < b.length ? a : b;
  if (shorter.length >= 2 && (a.includes(b) || b.includes(a))) return true;
  // 编辑距离 / 较长长度 < 0.4
  const maxLen = Math.max(a.length, b.length);
  return maxLen >= 3 && editDistance(a, b) / maxLen < 0.4;
}

// 新旧匹配：优先 同天同名 → 同名 → 同地点名 → 同天标题相似 → 标题相似
export function diffPlan(oldItems: ItineraryItemT[], plan: AiPlan): DiffEntry[] {
  const pool = oldItems.map((item) => ({ item, used: false }));
  const entries: DiffEntry[] = [];

  plan.days.forEach((day, d) => {
    day.items.forEach((newItem, idx) => {
      const title = norm(newItem.title);
      const place = norm(newItem.placeName);
      const match =
        // 优先级1: 同天 + 完全同名
        pool.find((p) => !p.used && norm(p.item.title) === title && p.item.dayIndex === d) ??
        // 优先级2: 完全同名（不同天）
        pool.find((p) => !p.used && norm(p.item.title) === title) ??
        // 优先级3: 同 placeName
        (place
          ? pool.find((p) => !p.used && norm(p.item.placeName) === place)
          : undefined) ??
        // 优先级4: 同天 + 标题相似（AI 轻微改写标题时仍能匹配）
        pool.find((p) => !p.used && p.item.dayIndex === d && titleSimilar(norm(p.item.title), title)) ??
        // 优先级5: 标题相似（不同天）
        pool.find((p) => !p.used && titleSimilar(norm(p.item.title), title));
      if (match) {
        match.used = true;
        const changes = fieldChanges(match.item, newItem, d);
        entries.push({
          key: `n-${d}-${idx}`,
          kind: changes.length > 0 ? "modified" : "unchanged",
          dayIndex: d,
          orderInDay: idx,
          newItem,
          oldItem: match.item,
          changes,
        });
      } else {
        entries.push({
          key: `n-${d}-${idx}`,
          kind: "added",
          dayIndex: d,
          orderInDay: idx,
          newItem,
          oldItem: null,
          changes: [],
        });
      }
    });
  });

  for (const p of pool) {
    if (p.used) continue;
    entries.push({
      key: `r-${p.item.id}`,
      kind: "removed",
      dayIndex: p.item.dayIndex, // 保留原天：方案缩减天数时，能看出该天将被移除
      orderInDay: 100000 + p.item.sortOrder,
      newItem: null,
      oldItem: p.item,
      changes: [],
    });
  }
  return entries;
}

// 从用户指令中识别涉及调整的字段类型
function detectAdjustFields(instruction: string): Set<string> {
  const text = instruction;
  const fields = new Set<string>();
  if (/时间|几点|早|晚|重排|错开|提前|推后|时段|开(?:始|门)|关(?:门|闭)/.test(text)) fields.add("time");
  if (/标题|名字|名称|改叫|改名/.test(text)) fields.add("title");
  if (/地点|位置|换到|搬到/.test(text)) fields.add("place");
  if (/费用|预算|多少钱|价格|花费|成本|贵|便宜/.test(text)) fields.add("cost");
  if (/备注|说明|提示|推荐理由|理由/.test(text)) fields.add("notes");
  if (/预约|预订|购票|门票/.test(text)) fields.add("booking");
  if (/顺序|前后|先.*后|调换|交换|互换|对调|对换|换.*位置|换到.*天|移到.*天|搬到.*天/.test(text)) fields.add("order");
  if (/类型|改成.*(交通|餐饮|住宿|景点|购物)/.test(text)) fields.add("type");
  if (/加.*天|减.*天|增.*天|压缩|延长|缩短|多一天|少一天|拆成|拆分|合并/.test(text)) fields.add("days");
  // 调整顺序/天数通常涉及时间变更，联动允许 time
  if (fields.has("order") || fields.has("days")) fields.add("time");
  // 未识别到明确意图时，不做回退（允许所有变更）
  if (fields.size === 0) fields.add("all");
  return fields;
}

// 从指令中识别用户指定的调整天数（返回 0-based 天索引集合）
export function detectFocusDays(instruction: string): Set<number> | null {
  // "每天"/"所有天"/"各天" 表示用户想改所有天，不做天级别过滤
  if (/每天|每一天|所有天|各天|全部天/.test(instruction)) return null;
  // 增减/拆分天数意图需要 AI 输出完整行程，不适合部分天输出模式
  if (/加.*天|减.*天|增.*天|压缩|延长|缩短|多一天|少一天|拆成|拆分|合并/.test(instruction)) return null;
  // 先把中文数字统一转为阿拉伯数字
  const text = instruction
    .replace(/十一/g, "11").replace(/十二/g, "12").replace(/十三/g, "13")
    .replace(/十四/g, "14").replace(/十五/g, "15").replace(/十/g, "10")
    .replace(/一/g, "1").replace(/二/g, "2").replace(/三/g, "3")
    .replace(/四/g, "4").replace(/五/g, "5").replace(/六/g, "6")
    .replace(/七/g, "7").replace(/八/g, "8").replace(/九/g, "9");
  const days = new Set<number>();
  let m: RegExpExecArray | null;
  // 范围匹配 "第X到Y天" / "第X至Y天" / "第X-Y天"
  const rangeRegex = /第\s*(\d+)\s*(?:到|至|-|~|—)\s*(\d+)\s*天/g;
  while ((m = rangeRegex.exec(text)) !== null) {
    const [lo, hi] = [+m[1], +m[2]].sort((a, b) => a - b);
    for (let d = lo; d <= hi; d++) days.add(d - 1);
  }
  // 单天匹配 "第X天"
  const singleRegex = /第\s*(\d+)\s*天/g;
  while ((m = singleRegex.exec(text)) !== null) {
    const num = +m[1];
    if (num >= 1) days.add(num - 1);
  }
  // "前X天"
  const prefixMatch = text.match(/前\s*(\d+)\s*天/);
  if (prefixMatch) {
    const n = +prefixMatch[1];
    for (let d = 0; d < n && d < 30; d++) days.add(d);
  }
  return days.size > 0 ? days : null;
}

// 回退 AI 擅自修改的非意图变更：天级别过滤 + 字段级回退
export function revertNonIntentFields(
  entries: DiffEntry[],
  instruction: string,
): DiffEntry[] {
  const allowed = detectAdjustFields(instruction);
  const focusDays = detectFocusDays(instruction);
  // 无天级别过滤且无字段级别过滤时，直接返回
  if (allowed.has("all") && !focusDays) return entries;
  const allowDayChange = allowed.has("order") || allowed.has("days");
  const doFieldRevert = !allowed.has("all");
  const result: DiffEntry[] = [];
  for (const e of entries) {
    // 天级别过滤：用户指定只改某些天时，不在这些天的变更全部回退
    if (focusDays) {
      const itemDay = e.oldItem ? (allowDayChange ? e.dayIndex : e.oldItem.dayIndex) : e.dayIndex;
      if (!focusDays.has(itemDay)) {
        if (e.kind === "modified" || e.kind === "removed") {
          result.push({ ...e, kind: "unchanged", changes: [] });
        }
        // added 项不在关注天：跳过（不加入结果，不会选中也不会应用）
        continue;
      }
    }
    // 字段级回退（仅有具体字段意图时）
    if (!doFieldRevert) {
      result.push(e);
      continue;
    }
    // 结构性变更过滤：用户未要求增删天数时，跳过新增项
    if (e.kind === "added" && !allowed.has("days")) {
      continue;
    }
    // 用户未要求调整顺序/天数时，删除项回退为 unchanged
    if (e.kind === "removed" && !allowDayChange) {
      result.push({ ...e, kind: "unchanged", changes: [] });
      continue;
    }
    if (e.kind !== "modified" || !e.oldItem || !e.newItem) {
      result.push(e);
      continue;
    }
    const old = e.oldItem;
    const orig = e.newItem;
    // 回退非意图字段为原值
    const reverted: AiPlanItem = {
      ...orig,
      title: allowed.has("title") ? orig.title : old.title,
      type: allowed.has("type") ? orig.type : old.type,
      startTime: allowed.has("time") ? orig.startTime : old.startTime,
      endTime: allowed.has("time") ? orig.endTime : old.endTime,
      placeName: allowed.has("place") ? orig.placeName : old.placeName,
      estimatedCost: allowed.has("cost") ? orig.estimatedCost : old.estimatedCost,
      needBooking: allowed.has("booking") ? orig.needBooking : old.needBooking,
      notes: allowed.has("notes") ? orig.notes : old.notes,
      // 坐标/地址跟随 placeName
      lng: allowed.has("place") ? orig.lng : old.lng,
      lat: allowed.has("place") ? orig.lat : old.lat,
      address: allowed.has("place") ? orig.address : old.address,
    };
    // 回退天：若用户未要求调整顺序/天数，行程项不应跨天移动
    const revertedDay = allowDayChange ? e.dayIndex : old.dayIndex;
    const changes = fieldChanges(old, reverted, revertedDay);
    if (changes.length === 0) {
      result.push({ ...e, kind: "unchanged", dayIndex: revertedDay, newItem: reverted, changes: [] });
    } else {
      result.push({ ...e, dayIndex: revertedDay, newItem: reverted, changes });
    }
  }
  return result;
}

// 按勾选结果合成最终行程项列表（保留原 id 以维持开销关联）。
// 返回 days = 应用后行程应有的天数：以方案天数为基础，未勾选的删除/跨天修改
// 需要保留在原天时自动扩展（如拒绝了「压缩天数」的删除项，则原天保留）
export function composeApplyItems(
  entries: DiffEntry[],
  selected: Set<string>,
  planDays: number,
): { items: ApplyItemPayload[]; days: number } {
  let dayCount = Math.max(1, planDays);
  for (const e of entries) {
    if ((e.kind === "removed" || e.kind === "modified") && !selected.has(e.key) && e.oldItem) {
      dayCount = Math.max(dayCount, e.oldItem.dayIndex + 1);
    }
  }

  const emitted: Draft[][] = Array.from({ length: dayCount }, () => []);
  const kept: ItineraryItemT[][] = Array.from({ length: dayCount }, () => []);

  const fromOld = (o: ItineraryItemT): Draft => ({
    id: o.id,
    type: o.type,
    title: o.title,
    startTime: o.startTime,
    endTime: o.endTime,
    placeName: o.placeName,
    lng: o.lng,
    lat: o.lat,
    address: o.address,
    estimatedCost: o.estimatedCost,
    needBooking: o.needBooking,
    notes: o.notes,
    aiGenerated: o.aiGenerated,
  });
  const fromNew = (n: AiPlanItem, id?: string): Draft => ({
    id,
    type: n.type,
    title: n.title,
    startTime: n.startTime,
    endTime: n.endTime,
    placeName: n.placeName,
    lng: n.lng,
    lat: n.lat,
    address: n.address,
    estimatedCost: n.estimatedCost,
    needBooking: n.needBooking === true,
    notes: n.notes,
    aiGenerated: true,
  });
  const clampDay = (d: number) => Math.min(Math.max(d, 0), dayCount - 1);

  const planEntries = entries
    .filter((e) => e.kind !== "removed")
    .sort((a, b) => a.dayIndex - b.dayIndex || a.orderInDay - b.orderInDay);

  for (const e of planEntries) {
    if (e.kind === "unchanged") {
      emitted[clampDay(e.dayIndex)].push(fromOld(e.oldItem!));
    } else if (e.kind === "modified") {
      if (selected.has(e.key)) {
        const draft = fromNew(e.newItem!, e.oldItem!.id);
        // 地点没变但新方案缺坐标时，继承原坐标
        if (draft.lng == null && norm(e.newItem!.placeName) === norm(e.oldItem!.placeName)) {
          draft.lng = e.oldItem!.lng;
          draft.lat = e.oldItem!.lat;
          draft.address = e.oldItem!.address;
        }
        emitted[clampDay(e.dayIndex)].push(draft);
      } else if (e.oldItem!.dayIndex === e.dayIndex) {
        emitted[clampDay(e.dayIndex)].push(fromOld(e.oldItem!));
      } else {
        kept[clampDay(e.oldItem!.dayIndex)].push(e.oldItem!);
      }
    } else if (e.kind === "added" && selected.has(e.key)) {
      emitted[clampDay(e.dayIndex)].push(fromNew(e.newItem!));
    }
  }

  for (const e of entries) {
    if (e.kind === "removed" && !selected.has(e.key)) {
      kept[clampDay(e.oldItem!.dayIndex)].push(e.oldItem!);
    }
  }

  const result: ApplyItemPayload[] = [];
  for (let d = 0; d < dayCount; d++) {
    kept[d].sort((a, b) => a.sortOrder - b.sortOrder);
    const dayList = [...emitted[d], ...kept[d].map(fromOld)];
    dayList.forEach((draft, idx) => result.push({ ...draft, dayIndex: d, sortOrder: idx }));
  }
  return { items: result, days: dayCount };
}
