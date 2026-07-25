import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireTripEditByChild, requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// 拖拽后批量持久化行程项的天序与排序
export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const denied = await requireTripEditByChild(user, id);
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as {
    items?: Array<{ id?: unknown; dayIndex?: unknown; sortOrder?: unknown }>;
  } | null;
  if (!body || !Array.isArray(body.items)) {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const updates = body.items.filter(
    (item): item is { id: string; dayIndex: number; sortOrder: number } =>
      typeof item.id === "string" &&
      Number.isInteger(item.dayIndex) &&
      (item.dayIndex as number) >= 0 &&
      Number.isInteger(item.sortOrder) &&
      (item.sortOrder as number) >= 0,
  );

  // updateMany 以 tripId 限定范围，防止改到其他行程的数据
  await prisma.$transaction(
    updates.map((item) =>
      prisma.itineraryItem.updateMany({
        where: { id: item.id, tripId: id },
        data: { dayIndex: item.dayIndex, sortOrder: item.sortOrder },
      }),
    ),
  );

  return NextResponse.json({ ok: true, updated: updates.length });
}
