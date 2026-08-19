import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, tripAccess } from "@/lib/session";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// 复制行程：创建相同副本（含行程项、开销、清单），独立修改
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const access = await tripAccess(id, user);
  if (!access) return NextResponse.json({ error: "行程不存在或无权访问" }, { status: 404 });
  if (access.role !== "owner") {
    return NextResponse.json({ error: "只有行程所有者可以复制行程" }, { status: 403 });
  }

  // 读取原行程全部数据
  const original = await prisma.trip.findUnique({
    where: { id },
    include: {
      items: { orderBy: [{ dayIndex: "asc" }, { sortOrder: "asc" }] },
      expenses: true,
      checklist: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!original) return NextResponse.json({ error: "行程不存在" }, { status: 404 });

  const newTitle = `${original.title}（副本）`;

  const copy = await prisma.$transaction(async (tx) => {
    // 1. 创建新行程
    const newTrip = await tx.trip.create({
      data: {
        title: newTitle,
        destination: original.destination,
        startDate: original.startDate,
        endDate: original.endDate,
        budgetTotal: original.budgetTotal,
        notes: original.notes,
        planParams: original.planParams,
        ownerId: user.id,
        researchWeb: original.researchWeb,
        researchWebAt: original.researchWebAt,
        researchXhs: original.researchXhs,
        researchXhsAt: original.researchXhsAt,
        researchAi: original.researchAi,
        researchAiAt: original.researchAiAt,
        // 不复制：shareToken、shares
      },
    });

    // 2. 复制行程项（建立旧 id → 新 id 映射，供开销关联）
    const itemIdMap = new Map<string, string>();
    for (const item of original.items) {
      const created = await tx.itineraryItem.create({
        data: {
          tripId: newTrip.id,
          dayIndex: item.dayIndex,
          sortOrder: item.sortOrder,
          type: item.type,
          title: item.title,
          startTime: item.startTime,
          endTime: item.endTime,
          placeName: item.placeName,
          lng: item.lng,
          lat: item.lat,
          address: item.address,
          estimatedCost: item.estimatedCost,
          needBooking: item.needBooking,
          notes: item.notes,
          transportMode: item.transportMode,
          aiGenerated: item.aiGenerated,
          guideInfo: item.guideInfo,
          guideAt: item.guideAt,
        },
      });
      itemIdMap.set(item.id, created.id);
    }

    // 3. 复制开销（修正 itemId 映射，批量写入）
    if (original.expenses.length > 0) {
      await tx.expense.createMany({
        data: original.expenses.map((exp) => ({
          tripId: newTrip.id,
          date: exp.date,
          category: exp.category,
          title: exp.title,
          amount: exp.amount,
          payer: exp.payer,
          participants: exp.participants,
          itemId: exp.itemId ? (itemIdMap.get(exp.itemId) ?? null) : null,
          notes: exp.notes,
        })),
      });
    }

    // 4. 复制清单（副本重置为未勾选，批量写入）
    if (original.checklist.length > 0) {
      await tx.checklistItem.createMany({
        data: original.checklist.map((cl) => ({
          tripId: newTrip.id,
          text: cl.text,
          checked: false,
          sortOrder: cl.sortOrder,
        })),
      });
    }

    return newTrip;
  });

  return NextResponse.json({ id: copy.id });
}