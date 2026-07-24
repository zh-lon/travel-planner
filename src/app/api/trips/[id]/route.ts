import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { dayCountOf, parseTripBody } from "@/lib/trips";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const trip = await prisma.trip.findUnique({
    where: { id },
    include: { items: { orderBy: [{ dayIndex: "asc" }, { sortOrder: "asc" }] } },
  });
  if (!trip) return NextResponse.json({ error: "行程不存在" }, { status: 404 });
  return NextResponse.json(trip);
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = parseTripBody(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const trip = await prisma.trip
    .update({ where: { id }, data: parsed.data })
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

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const deleted = await prisma.trip.delete({ where: { id } }).catch(() => null);
  if (!deleted) return NextResponse.json({ error: "行程不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
