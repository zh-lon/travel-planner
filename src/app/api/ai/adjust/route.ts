import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildAdjustPrompt, planStreamResponse } from "@/lib/ai/generate";
import { dayCountOf } from "@/lib/trips";
import type { ItineraryItemT, TripDetail } from "@/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    tripId?: unknown;
    instruction?: unknown;
  } | null;
  const tripId = typeof body?.tripId === "string" ? body.tripId : "";
  const instruction = typeof body?.instruction === "string" ? body.instruction.trim() : "";
  if (!tripId) return NextResponse.json({ error: "缺少行程 ID" }, { status: 400 });
  if (!instruction) return NextResponse.json({ error: "请填写调整要求" }, { status: 400 });

  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: { items: { orderBy: [{ dayIndex: "asc" }, { sortOrder: "asc" }] } },
  });
  if (!trip) return NextResponse.json({ error: "行程不存在" }, { status: 404 });

  const tripDetail = {
    ...trip,
    startDate: trip.startDate.toISOString(),
    endDate: trip.endDate.toISOString(),
  } as unknown as TripDetail;

  return planStreamResponse(async () => ({
    messages: buildAdjustPrompt(tripDetail, tripDetail.items as ItineraryItemT[], instruction),
    expectedDays: dayCountOf(trip.startDate, trip.endDate),
    city: trip.destination,
  }));
}
