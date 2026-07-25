import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { canEditRole, requireUser, tripAccess } from "@/lib/session";
import { ITEM_TYPE_VALUES } from "@/types/constants";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

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

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });

  const dayCount =
    Math.round((trip.endDate.getTime() - trip.startDate.getTime()) / 86400000) + 1;
  const dayIndex = Number(body.dayIndex);
  if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex >= dayCount) {
    return NextResponse.json({ error: "天数超出行程范围" }, { status: 400 });
  }
  const type = typeof body.type === "string" && ITEM_TYPE_VALUES.includes(body.type) ? body.type : null;
  if (!type) return NextResponse.json({ error: "行程项类型不合法" }, { status: 400 });
  if (typeof body.title !== "string" || !body.title.trim()) {
    return NextResponse.json({ error: "标题不能为空" }, { status: 400 });
  }

  const max = await prisma.itineraryItem.aggregate({
    where: { tripId: id, dayIndex },
    _max: { sortOrder: true },
  });

  const item = await prisma.itineraryItem.create({
    data: {
      tripId: id,
      dayIndex,
      sortOrder: (max._max.sortOrder ?? -1) + 1,
      type,
      title: body.title.trim(),
      startTime: strOrNull(body.startTime),
      endTime: strOrNull(body.endTime),
      placeName: strOrNull(body.placeName),
      lng: typeof body.lng === "number" ? body.lng : null,
      lat: typeof body.lat === "number" ? body.lat : null,
      address: strOrNull(body.address),
      estimatedCost:
        typeof body.estimatedCost === "number" && body.estimatedCost >= 0
          ? body.estimatedCost
          : null,
      notes: strOrNull(body.notes),
    },
  });
  return NextResponse.json(item);
}
