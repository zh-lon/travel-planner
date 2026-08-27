import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { canEditRole, requireUser, tripAccess } from "@/lib/session";
import { dayCountOf } from "@/lib/trips";
import { createTripSnapshot } from "@/lib/snapshot";
import { ITEM_TYPE_VALUES } from "@/types/constants";
import type { ItineraryItemT } from "@/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

interface IncomingItem {
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

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// AI 调整逐项应用：提交最终行程项全集——带 id 的更新（保留开销关联）、
// 不带 id 的新建、未出现的删除
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const access = await tripAccess(id, user);
  if (!access) return NextResponse.json({ error: "行程不存在或无权访问" }, { status: 404 });
  if (!canEditRole(access.role)) {
    return NextResponse.json({ error: "该行程对你是只读共享" }, { status: 403 });
  }
  const trip = access.trip;

  const body = (await request.json().catch(() => null)) as {
    items?: unknown;
    days?: unknown;
  } | null;
  if (!body || !Array.isArray(body.items)) {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  // 安全检查：提交空 items 但数据库中已有行程项时拒绝执行，防止全量删除
  const existingCount = await prisma.itineraryItem.count({ where: { tripId: id } });
  if (body.items.length === 0 && existingCount > 0) {
    return NextResponse.json(
      { error: "提交的行程项为空但已有数据，已拒绝执行以保护现有行程" },
      { status: 400 },
    );
  }

  // 支持随本次应用调整行程天数（AI 方案增减天时传入）
  const currentDayCount = dayCountOf(trip.startDate, trip.endDate);
  const daysReq = Number(body.days);
  const dayCount =
    Number.isInteger(daysReq) && daysReq >= 1 && daysReq <= 30 ? daysReq : currentDayCount;
  const items: IncomingItem[] = [];
  for (const raw of body.items as Record<string, unknown>[]) {
    if (typeof raw !== "object" || raw === null) continue;
    const title = strOrNull(raw.title);
    if (!title) continue;
    const dayIndex = Number(raw.dayIndex);
    const sortOrder = Number(raw.sortOrder);
    items.push({
      id: typeof raw.id === "string" && raw.id ? raw.id : undefined,
      dayIndex: Number.isInteger(dayIndex) ? Math.min(Math.max(dayIndex, 0), dayCount - 1) : 0,
      sortOrder: Number.isInteger(sortOrder) && sortOrder >= 0 ? sortOrder : 0,
      type: typeof raw.type === "string" && ITEM_TYPE_VALUES.includes(raw.type) ? raw.type : "OTHER",
      title,
      startTime: strOrNull(raw.startTime),
      endTime: strOrNull(raw.endTime),
      placeName: strOrNull(raw.placeName),
      lng: typeof raw.lng === "number" ? raw.lng : null,
      lat: typeof raw.lat === "number" ? raw.lat : null,
      address: strOrNull(raw.address),
      estimatedCost:
        typeof raw.estimatedCost === "number" && raw.estimatedCost >= 0 ? raw.estimatedCost : null,
      needBooking: raw.needBooking === true,
      notes: strOrNull(raw.notes),
      aiGenerated: raw.aiGenerated === true,
    });
  }

  const withId = items.filter((i): i is IncomingItem & { id: string } => !!i.id);
  const withoutId = items.filter((i) => !i.id);

  // AI 修改前自动保存快照（静默，失败不影响主流程）
  try {
    const currentItems = await prisma.itineraryItem.findMany({
      where: { tripId: id },
      orderBy: [{ dayIndex: "asc" }, { sortOrder: "asc" }],
    });
    await createTripSnapshot(id, currentItems as ItineraryItemT[], currentDayCount);
  } catch {
    // 快照创建失败不影响主流程
  }

  await prisma.$transaction([
    ...(dayCount !== currentDayCount
      ? [
          prisma.trip.update({
            where: { id },
            data: { endDate: new Date(trip.startDate.getTime() + (dayCount - 1) * 86400000) },
          }),
        ]
      : []),
    // 删除未保留的行程项（提交集之外的全部删掉）
    prisma.itineraryItem.deleteMany({
      where: { tripId: id, id: { notIn: withId.map((i) => i.id) } },
    }),
    ...withId.map((item) =>
      prisma.itineraryItem.updateMany({
        where: { id: item.id, tripId: id },
        data: {
          dayIndex: item.dayIndex,
          sortOrder: item.sortOrder,
          type: item.type,
          title: item.title,
          startTime: item.startTime,
          endTime: item.endTime,
          placeName: item.placeName,
          lng: item.lng,
          lat: item.lat,
          address: item.address,
          estimatedCost: item.estimatedCost,
          needBooking: item.needBooking,
          notes: item.notes,
          aiGenerated: item.aiGenerated,
        },
      }),
    ),
    ...(withoutId.length > 0
      ? [
          prisma.itineraryItem.createMany({
            data: withoutId.map((item) => ({ ...item, tripId: id })),
          }),
        ]
      : []),
  ]);

  return NextResponse.json({ ok: true, total: items.length });
}
