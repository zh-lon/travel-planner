import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, tripAccess } from "@/lib/session";
import { dayCountOf, parseTripBody } from "@/lib/trips";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const access = await tripAccess(id, user);
  if (!access) return NextResponse.json({ error: "行程不存在或无权访问" }, { status: 404 });

  const trip = await prisma.trip.findUnique({
    where: { id },
    include: {
      items: { orderBy: [{ dayIndex: "asc" }, { sortOrder: "asc" }] },
      owner: { select: { id: true, username: true, displayName: true } },
      shares: {
        include: { user: { select: { id: true, username: true, displayName: true } } },
      },
    },
  });
  if (!trip) return NextResponse.json({ error: "行程不存在" }, { status: 404 });
  return NextResponse.json({ ...trip, access: { role: access.role } });
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const access = await tripAccess(id, user);
  if (!access) return NextResponse.json({ error: "行程不存在或无权访问" }, { status: 404 });
  if (access.role !== "owner") {
    return NextResponse.json({ error: "只有行程所有者可以修改行程信息" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = parseTripBody(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  // planParams 与库中原值合并，避免部分更新时把已有规划参数冲掉
  const updateData = { ...parsed.data };
  if (updateData.planParams) {
    const old = await prisma.trip.findUnique({ where: { id }, select: { planParams: true } });
    if (old?.planParams) {
      try {
        const merged = {
          ...(JSON.parse(old.planParams) as Record<string, unknown>),
          ...(JSON.parse(updateData.planParams) as Record<string, unknown>),
        };
        updateData.planParams = JSON.stringify(merged);
      } catch {
        // JSON 解析失败时保留新传入的值
      }
    }
  }
  const trip = await prisma.trip
    .update({ where: { id }, data: updateData })
    .catch(() => null);
  if (!trip) return NextResponse.json({ error: "行程不存在" }, { status: 404 });

  // 行程天数缩短时，把越界的行程项收敛到最后一天
  const dayCount = dayCountOf(trip.startDate, trip.endDate);
  await prisma.itineraryItem.updateMany({
    where: { tripId: id, dayIndex: { gte: dayCount } },
    data: { dayIndex: dayCount - 1 },
  });

  return NextResponse.json(trip);
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const access = await tripAccess(id, user);
  if (!access) return NextResponse.json({ error: "行程不存在或无权访问" }, { status: 404 });
  if (access.role !== "owner") {
    return NextResponse.json({ error: "只有行程所有者可以删除行程" }, { status: 403 });
  }

  const deleted = await prisma.trip.delete({ where: { id } }).catch(() => null);
  if (!deleted) return NextResponse.json({ error: "行程不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
