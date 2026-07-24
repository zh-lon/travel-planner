import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseTripBody } from "@/lib/trips";

export const dynamic = "force-dynamic";

export async function GET() {
  const trips = await prisma.trip.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { items: true } } },
  });
  return NextResponse.json(trips);
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = parseTripBody(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const trip = await prisma.trip.create({ data: parsed.data });
  return NextResponse.json(trip);
}
