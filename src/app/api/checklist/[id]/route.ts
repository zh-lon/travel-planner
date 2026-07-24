import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    text?: unknown;
    checked?: unknown;
  } | null;
  if (!body) return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });

  const data: { text?: string; checked?: boolean } = {};
  if (typeof body.text === "string" && body.text.trim()) data.text = body.text.trim();
  if (typeof body.checked === "boolean") data.checked = body.checked;

  const item = await prisma.checklistItem.update({ where: { id }, data }).catch(() => null);
  if (!item) return NextResponse.json({ error: "条目不存在" }, { status: 404 });
  return NextResponse.json(item);
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const deleted = await prisma.checklistItem.delete({ where: { id } }).catch(() => null);
  if (!deleted) return NextResponse.json({ error: "条目不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
