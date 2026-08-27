// 行程快照：AI 修改前自动保存版本，支持恢复
import dayjs from "dayjs";
import { prisma } from "@/lib/db";
import type { ItineraryItemT } from "@/types";

// 快照数据结构（精简版：只保留行程项的核心字段）
export interface SnapshotItem {
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
  transportMode: string | null;
  aiGenerated: boolean;
}

export interface SnapshotData {
  tripId: string;
  dayCount: number;
  items: SnapshotItem[];
  createdAt: string;
}

// 从完整行程项提取快照数据（精简字段，降低存储开销）
function toSnapshotItems(items: ItineraryItemT[]): SnapshotItem[] {
  return items.map((i) => ({
    dayIndex: i.dayIndex,
    sortOrder: i.sortOrder,
    type: i.type,
    title: i.title,
    startTime: i.startTime,
    endTime: i.endTime,
    placeName: i.placeName,
    lng: i.lng,
    lat: i.lat,
    address: i.address,
    estimatedCost: i.estimatedCost,
    needBooking: i.needBooking,
    notes: i.notes,
    transportMode: i.transportMode ?? null,
    aiGenerated: i.aiGenerated,
  }));
}

// 创建行程快照（在 AI 修改前调用）
export async function createTripSnapshot(
  tripId: string,
  items: ItineraryItemT[],
  dayCount: number,
  label?: string,
): Promise<string> {
  const snapLabel = label ?? `AI 调整前 - ${dayjs().format("MM-DD HH:mm")}`;
  const data: SnapshotData = {
    tripId,
    dayCount,
    items: toSnapshotItems(items),
    createdAt: new Date().toISOString(),
  };
  const snap = await prisma.tripSnapshot.create({
    data: {
      tripId,
      label: snapLabel,
      data: JSON.stringify(data),
    },
  });
  return snap.id;
}

// 列出行程的所有快照（按时间倒序）
export async function listTripSnapshots(tripId: string) {
  return prisma.tripSnapshot.findMany({
    where: { tripId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      label: true,
      createdAt: true,
    },
  });
}

// 获取单个快照的完整数据
export async function getSnapshotData(snapshotId: string): Promise<SnapshotData | null> {
  const snap = await prisma.tripSnapshot.findUnique({
    where: { id: snapshotId },
    select: { data: true, tripId: true },
  });
  if (!snap) return null;
  try {
    return JSON.parse(snap.data) as SnapshotData;
  } catch {
    return null;
  }
}

// 从快照恢复行程（删除当前所有行程项，用快照数据重建）
export async function restoreFromSnapshot(
  tripId: string,
  snapshotId: string,
): Promise<{ ok: boolean; dayCount: number; itemCount: number }> {
  const snapData = await getSnapshotData(snapshotId);
  if (!snapData || snapData.tripId !== tripId) {
    throw new Error("快照不存在或不属于此行程");
  }

  const { dayCount, items } = snapData;

  await prisma.$transaction(async (tx) => {
    // 删除当前所有行程项
    await tx.itineraryItem.deleteMany({ where: { tripId } });

    // 用快照数据重建
    if (items.length > 0) {
      await tx.itineraryItem.createMany({
        data: items.map((item) => ({ ...item, tripId })),
      });
    }

    // 恢复行程天数
    const trip = await tx.trip.findUnique({ where: { id: tripId }, select: { startDate: true } });
    if (trip) {
      await tx.trip.update({
        where: { id: tripId },
        data: {
          endDate: new Date(trip.startDate.getTime() + (dayCount - 1) * 86400000),
        },
      });
    }
  });

  return { ok: true, dayCount, itemCount: items.length };
}

// 删除单个快照
export async function deleteSnapshot(tripId: string, snapshotId: string): Promise<boolean> {
  const snap = await prisma.tripSnapshot.findUnique({
    where: { id: snapshotId },
    select: { tripId: true },
  });
  if (!snap || snap.tripId !== tripId) return false;
  await prisma.tripSnapshot.delete({ where: { id: snapshotId } });
  return true;
}

// 重命名快照
export async function renameSnapshot(
  tripId: string,
  snapshotId: string,
  label: string,
): Promise<boolean> {
  const snap = await prisma.tripSnapshot.findUnique({
    where: { id: snapshotId },
    select: { tripId: true },
  });
  if (!snap || snap.tripId !== tripId) return false;
  await prisma.tripSnapshot.update({
    where: { id: snapshotId },
    data: { label },
  });
  return true;
}