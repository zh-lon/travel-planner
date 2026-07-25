import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { canEditRole, requireUser, tripAccess } from "@/lib/session";
import { EXPENSE_CATEGORY_VALUES } from "@/types/constants";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

function parseParticipants(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const access = await tripAccess(id, user);
  if (!access) return NextResponse.json({ error: "行程不存在或无权访问" }, { status: 404 });

  const rows = await prisma.expense.findMany({
    where: { tripId: id },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  return NextResponse.json(rows.map((row) => ({ ...row, participants: parseParticipants(row.participants) })));
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const access = await tripAccess(id, user);
  if (!access) return NextResponse.json({ error: "行程不存在或无权访问" }, { status: 404 });
  if (!canEditRole(access.role)) {
    return NextResponse.json({ error: "该行程对你是只读共享" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });

  const date = new Date(String(body.date));
  if (Number.isNaN(date.getTime())) return NextResponse.json({ error: "日期不合法" }, { status: 400 });
  if (typeof body.title !== "string" || !body.title.trim()) {
    return NextResponse.json({ error: "标题不能为空" }, { status: 400 });
  }
  if (typeof body.amount !== "number" || !(body.amount > 0)) {
    return NextResponse.json({ error: "金额必须大于 0" }, { status: 400 });
  }
  const category =
    typeof body.category === "string" && EXPENSE_CATEGORY_VALUES.includes(body.category)
      ? body.category
      : "OTHER";
  const participants = Array.isArray(body.participants)
    ? body.participants.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim())
    : [];

  let itemId: string | null = null;
  if (typeof body.itemId === "string" && body.itemId) {
    const item = await prisma.itineraryItem.findFirst({ where: { id: body.itemId, tripId: id } });
    itemId = item ? item.id : null;
  }

  const expense = await prisma.expense.create({
    data: {
      tripId: id,
      date,
      category,
      title: body.title.trim(),
      amount: body.amount,
      payer: typeof body.payer === "string" && body.payer.trim() ? body.payer.trim() : null,
      participants: participants.length > 0 ? JSON.stringify(participants) : null,
      itemId,
      notes: typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null,
    },
  });
  return NextResponse.json({ ...expense, participants });
}
