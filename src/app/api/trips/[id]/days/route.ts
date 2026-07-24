import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { dayCountOf } from "@/lib/trips";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const DAY_MS = 86400000;

// 天数操作：{ action: "insert" | "remove", dayIndex }
// insert：在 dayIndex 位置插入空的一天（dayIndex = dayCount 即在末尾追加），行程结束日期 +1
// remove：删除某天，该天安排并入相邻天（第 1 天并入下一天，其余并入前一天），结束日期 -1
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const trip = await prisma.trip.findUnique({ where: { id } });
  if (!trip) return NextResponse.json({ error: "行程不存在" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
    dayIndex?: unknown;
  } | null;
  const action = body?.action;
  const dayIndex = Number(body?.dayIndex);
  const dayCount = dayCountOf(trip.startDate, trip.endDate);

  if (action === "insert") {
    if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > dayCount) {
      return NextResponse.json({ error: "插入位置不合法" }, { status: 400 });
    }
    await prisma.$transaction([
      prisma.trip.update({
        where: { id },
        data: { endDate: new Date(trip.endDate.getTime() + DAY_MS) },
      }),
      prisma.itineraryItem.updateMany({
        where: { tripId: id, dayIndex: { gte: dayIndex } },
        data: { dayIndex: { increment: 1 } },
      }),
    ]);
    return NextResponse.json({ ok: true, dayCount: dayCount + 1 });
  }

  if (action === "remove") {
    if (dayCount <= 1) {
      return NextResponse.json({ error: "至少要保留一天" }, { status: 400 });
    }
    if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex >= dayCount) {
      return NextResponse.json({ error: "天数位置不合法" }, { status: 400 });
    }

    const removedItems = await prisma.itineraryItem.findMany({
      where: { tripId: id, dayIndex },
      orderBy: { sortOrder: "asc" },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ops: any[] = [];

    if (dayIndex === 0) {
      // 第 1 天并入下一天：本天条目保持最前（时间上更早），原下一天条目顺延
      const nextItems = await prisma.itineraryItem.findMany({
        where: { tripId: id, dayIndex: 1 },
        orderBy: { sortOrder: "asc" },
      });
      removedItems.forEach((item, i) =>
        ops.push(prisma.itineraryItem.update({ where: { id: item.id }, data: { sortOrder: i } })),
      );
      nextItems.forEach((item, i) =>
        ops.push(
          prisma.itineraryItem.update({
            where: { id: item.id },
            data: { dayIndex: 0, sortOrder: removedItems.length + i },
          }),
        ),
      );
      ops.push(
        prisma.itineraryItem.updateMany({
          where: { tripId: id, dayIndex: { gt: 1 } },
          data: { dayIndex: { decrement: 1 } },
        }),
      );
    } else {
      // 并入前一天尾部
      const prevMax = await prisma.itineraryItem.aggregate({
        where: { tripId: id, dayIndex: dayIndex - 1 },
        _max: { sortOrder: true },
      });
      const base = (prevMax._max.sortOrder ?? -1) + 1;
      removedItems.forEach((item, i) =>
        ops.push(
          prisma.itineraryItem.update({
            where: { id: item.id },
            data: { dayIndex: dayIndex - 1, sortOrder: base + i },
          }),
        ),
      );
      ops.push(
        prisma.itineraryItem.updateMany({
          where: { tripId: id, dayIndex: { gt: dayIndex } },
          data: { dayIndex: { decrement: 1 } },
        }),
      );
    }

    ops.push(
      prisma.trip.update({
        where: { id },
        data: { endDate: new Date(trip.endDate.getTime() - DAY_MS) },
      }),
    );
    await prisma.$transaction(ops);
    return NextResponse.json({ ok: true, dayCount: dayCount - 1 });
  }

  return NextResponse.json({ error: "未知操作" }, { status: 400 });
}
