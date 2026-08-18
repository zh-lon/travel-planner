import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { aiPlanSchema } from "@/lib/ai/schema";
import { requireUser } from "@/lib/session";
import { parseTripBody } from "@/lib/trips";
import { ITEM_TYPE_VALUES } from "@/types/constants";
import type { AiPlan } from "@/types";

export const dynamic = "force-dynamic";

// 把 AI 方案导入为新行程
export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });

  const parsedTrip = parseTripBody(body);
  if ("error" in parsedTrip) {
    return NextResponse.json({ error: parsedTrip.error }, { status: 400 });
  }
  const planCheck = aiPlanSchema.safeParse(body.plan);
  if (!planCheck.success) {
    return NextResponse.json({ error: "行程方案数据不合法" }, { status: 400 });
  }
  const plan = body.plan as AiPlan;

  const trip = await prisma.trip.create({ data: { ...parsedTrip.data, ownerId: user.id } });
  const itemsData = plan.days.flatMap((day, dayIndex) =>
    day.items.map((item, idx) => ({
      tripId: trip.id,
      dayIndex,
      sortOrder: idx,
      type: ITEM_TYPE_VALUES.includes(item.type) ? item.type : "OTHER",
      title: item.title,
      startTime: item.startTime,
      endTime: item.endTime,
      placeName: item.placeName,
      lng: item.lng,
      lat: item.lat,
      address: item.address,
      estimatedCost: item.estimatedCost,
      needBooking: item.needBooking === true,
      notes: item.notes,
      aiGenerated: true,
    })),
  );
  if (itemsData.length > 0) {
    await prisma.itineraryItem.createMany({ data: itemsData });
  }
  return NextResponse.json({ id: trip.id, itemCount: itemsData.length });
}
