import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { dayCountOf } from "@/lib/trips";
import { ITEM_TYPE_VALUES } from "@/types/constants";

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
  const trip = await prisma.trip.findUnique({ where: { id } });
  if (!trip) return NextResponse.json({ error: "行程不存在" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { items?: unknown } | null;
  if (!body || !Array.isArray(body.items)) {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const dayCount = dayCountOf(trip.startDate, trip.endDate);
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
      notes: strOrNull(raw.notes),
      aiGenerated: raw.aiGenerated === true,
    });
  }

  const withId = items.filter((i): i is IncomingItem & { id: string } => !!i.id);
  const withoutId = items.filter((i) => !i.id);

  await prisma.$transaction([
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
