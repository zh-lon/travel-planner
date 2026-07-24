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
  if (norm(oldItem.notes) !== norm(newItem.notes)) {
    changes.push({ label: "备注", from: norm(oldItem.notes) || "（空）", to: norm(newItem.notes) || "（空）" });
  }
  return changes;
}

// 新旧匹配：优先 同天同名 → 同名 → 同地点名
export function diffPlan(oldItems: ItineraryItemT[], plan: AiPlan): DiffEntry[] {
  const pool = oldItems.map((item) => ({ item, used: false }));
  const entries: DiffEntry[] = [];

  plan.days.forEach((day, d) => {
    day.items.forEach((newItem, idx) => {
      const title = norm(newItem.title);
      const place = norm(newItem.placeName);
      const match =
        pool.find((p) => !p.used && norm(p.item.title) === title && p.item.dayIndex === d) ??
        pool.find((p) => !p.used && norm(p.item.title) === title) ??
        (place
          ? pool.find((p) => !p.used && norm(p.item.placeName) === place)
          : undefined);
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
