import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { canEditRole, requireUser, tripAccess } from "@/lib/session";
import { createTripSnapshot, listTripSnapshots } from "@/lib/snapshot";
import type { ItineraryItemT } from "@/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// GET /api/trips/[id]/snapshots — 列出快照
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const user = await requireUser(_request);
  if (user instanceof NextResponse) return user;
  const access = await tripAccess(id, user);
  if (!access) return NextResponse.json({ error: "行程不存在或无权访问" }, { status: 404 });

  const snapshots = await listTripSnapshots(id);
  return NextResponse.json(snapshots);
}

// POST /api/trips/[id]/snapshots — 手动创建快照
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const access = await tripAccess(id, user);
  if (!access) return NextResponse.json({ error: "行程不存在或无权访问" }, { status: 404 });
  if (!canEditRole(access.role)) {
    return NextResponse.json({ error: "该行程对你是只读共享" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { label?: string } | null;
  const trip = await prisma.trip.findUnique({
    where: { id },
    include: { items: { orderBy: [{ dayIndex: "asc" }, { sortOrder: "asc" }] } },
  });
  if (!trip) return NextResponse.json({ error: "行程不存在" }, { status: 404 });

  const dayCount = Math.ceil(
    (trip.endDate.getTime() - trip.startDate.getTime()) / 86400000,
  ) + 1;

  const snapId = await createTripSnapshot(
    id,
    trip.items as ItineraryItemT[],
    dayCount,
    body?.label,
  );
  return NextResponse.json({ ok: true, id: snapId });
}