import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { EXPENSE_CATEGORY_VALUES } from "@/types/constants";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });

  const data: {
    date?: Date;
    category?: string;
    title?: string;
    amount?: number;
    payer?: string | null;
    participants?: string | null;
    itemId?: string | null;
    notes?: string | null;
  } = {};

  if ("date" in body) {
    const date = new Date(String(body.date));
    if (Number.isNaN(date.getTime())) {
      return NextResponse.json({ error: "日期不合法" }, { status: 400 });
    }
    data.date = date;
  }
  if (typeof body.category === "string" && EXPENSE_CATEGORY_VALUES.includes(body.category)) {
    data.category = body.category;
  }
  if (typeof body.title === "string" && body.title.trim()) data.title = body.title.trim();
  if (typeof body.amount === "number" && body.amount > 0) data.amount = body.amount;
  if ("payer" in body) {
    data.payer = typeof body.payer === "string" && body.payer.trim() ? body.payer.trim() : null;
  }
  if ("participants" in body) {
    const participants = Array.isArray(body.participants)
      ? body.participants.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim())
      : [];
    data.participants = participants.length > 0 ? JSON.stringify(participants) : null;
  }
  if ("itemId" in body) {
    data.itemId = typeof body.itemId === "string" && body.itemId ? body.itemId : null;
  }
  if ("notes" in body) {
    data.notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;
  }

  const expense = await prisma.expense.update({ where: { id }, data }).catch(() => null);
  if (!expense) return NextResponse.json({ error: "开销记录不存在" }, { status: 404 });
  let participants: string[] = [];
  try {
    participants = expense.participants ? JSON.parse(expense.participants) : [];
  } catch {
    participants = [];
  }
  return NextResponse.json({ ...expense, participants });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const deleted = await prisma.expense.delete({ where: { id } }).catch(() => null);
  if (!deleted) return NextResponse.json({ error: "开销记录不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
