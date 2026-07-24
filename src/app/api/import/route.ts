import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { EXPENSE_CATEGORY_VALUES, ITEM_TYPE_VALUES } from "@/types/constants";

export const dynamic = "force-dynamic";

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// 从 JSON 备份恢复为新行程（生成全新 id，保留行程项与开销的关联关系）
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || body.app !== "lxgh" || !body.trip) {
    return NextResponse.json({ error: "不是有效的行程备份文件" }, { status: 400 });
  }
  const rawTrip = body.trip as Record<string, unknown>;
  const title = str(rawTrip.title);
  const destination = str(rawTrip.destination);
  const startDate = new Date(String(rawTrip.startDate));
  const endDate = new Date(String(rawTrip.endDate));
  if (!title || !destination || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return NextResponse.json({ error: "备份中的行程信息不完整" }, { status: 400 });
  }

  const trip = await prisma.trip.create({
    data: {
      title: `${title}（导入）`,
      destination,
      startDate,
      endDate,
      budgetTotal: num(rawTrip.budgetTotal),
      notes: str(rawTrip.notes),
    },
  });

  // 行程项：逐条创建以建立 旧id → 新id 映射（开销关联需要）
  const idMap = new Map<string, string>();
  const rawItems = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : [];
  for (const raw of rawItems) {
    const itemTitle = str(raw.title);
    if (!itemTitle) continue;
    const created = await prisma.itineraryItem.create({
      data: {
        tripId: trip.id,
        dayIndex: Number.isInteger(raw.dayIndex) && (raw.dayIndex as number) >= 0 ? (raw.dayIndex as number) : 0,
        sortOrder: Number.isInteger(raw.sortOrder) && (raw.sortOrder as number) >= 0 ? (raw.sortOrder as number) : 0,
        type: typeof raw.type === "string" && ITEM_TYPE_VALUES.includes(raw.type) ? raw.type : "OTHER",
        title: itemTitle,
        startTime: str(raw.startTime),
        endTime: str(raw.endTime),
        placeName: str(raw.placeName),
        lng: num(raw.lng),
        lat: num(raw.lat),
        address: str(raw.address),
        estimatedCost: num(raw.estimatedCost),
        notes: str(raw.notes),
        transportMode:
          typeof raw.transportMode === "string" &&
          ["line", "driving", "walking", "riding"].includes(raw.transportMode)
            ? raw.transportMode
            : null,
        aiGenerated: raw.aiGenerated === true,
      },
    });
    if (typeof raw.id === "string") idMap.set(raw.id, created.id);
  }

  const rawExpenses = Array.isArray(body.expenses) ? (body.expenses as Record<string, unknown>[]) : [];
  for (const raw of rawExpenses) {
    const expTitle = str(raw.title);
    const amount = num(raw.amount);
    const date = new Date(String(raw.date));
    if (!expTitle || amount == null || amount <= 0 || Number.isNaN(date.getTime())) continue;
    await prisma.expense.create({
      data: {
        tripId: trip.id,
        date,
        category:
          typeof raw.category === "string" && EXPENSE_CATEGORY_VALUES.includes(raw.category)
            ? raw.category
            : "OTHER",
        title: expTitle,
        amount,
        payer: str(raw.payer),
        participants: typeof raw.participants === "string" ? raw.participants : null,
        itemId: typeof raw.itemId === "string" ? (idMap.get(raw.itemId) ?? null) : null,
        notes: str(raw.notes),
      },
    });
  }

  const rawChecklist = Array.isArray(body.checklist) ? (body.checklist as Record<string, unknown>[]) : [];
  let sortOrder = 0;
  for (const raw of rawChecklist) {
    const text = str(raw.text);
    if (!text) continue;
    await prisma.checklistItem.create({
      data: { tripId: trip.id, text, checked: raw.checked === true, sortOrder: sortOrder++ },
    });
  }

  return NextResponse.json({ id: trip.id });
}
