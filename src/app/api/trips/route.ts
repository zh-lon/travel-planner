import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { parseTripBody } from "@/lib/trips";

export const dynamic = "force-dynamic";

// 列表：本人拥有的 + 共享给本人的行程
export async function GET(request: Request) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  const trips = await prisma.trip.findMany({
    where: { OR: [{ ownerId: user.id }, { shares: { some: { userId: user.id } } }] },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { items: true } },
      owner: { select: { id: true, username: true, displayName: true } },
      shares: { where: { userId: user.id }, select: { canEdit: true } },
      items: {
        where: { placeName: { not: null } },
        select: { placeName: true },
      },
    },
  });

  return NextResponse.json(
    trips.map(({ shares, items, ...trip }) => ({
      ...trip,
      places: [...new Set(items.map((i) => i.placeName).filter(Boolean))].slice(0, 8),
      access:
        trip.ownerId === user.id || trip.ownerId === null
          ? { role: "owner" }
          : { role: shares[0]?.canEdit ? "edit" : "read" },
    })),
  );
}

export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = parseTripBody(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const trip = await prisma.trip.create({ data: { ...parsed.data, ownerId: user.id } });
  return NextResponse.json(trip);
}
