import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const items = await prisma.checklistItem.findMany({
    where: { tripId: id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return NextResponse.json(items);
}

// 支持单条 {text} 或批量 {texts: []}
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const trip = await prisma.trip.findUnique({ where: { id } });
  if (!trip) return NextResponse.json({ error: "行程不存在" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as {
    text?: unknown;
    texts?: unknown;
  } | null;
  const texts: string[] = [];
  if (typeof body?.text === "string" && body.text.trim()) texts.push(body.text.trim());
  if (Array.isArray(body?.texts)) {
    for (const t of body.texts) {
      if (typeof t === "string" && t.trim()) texts.push(t.trim());
    }
  }
  if (texts.length === 0) return NextResponse.json({ error: "内容不能为空" }, { status: 400 });

  const max = await prisma.checklistItem.aggregate({
    where: { tripId: id },
    _max: { sortOrder: true },
  });
  let sortOrder = (max._max.sortOrder ?? -1) + 1;

  // 去重：先去掉本批内重复，再去掉与现有条目重复的文本
  const existing = new Set(
    (await prisma.checklistItem.findMany({ where: { tripId: id }, select: { text: true } })).map(
      (x) => x.text,
    ),
  );
  const fresh = [...new Set(texts)].filter((t) => !existing.has(t));

  const created = await prisma.$transaction(
    fresh.map((text) =>
      prisma.checklistItem.create({ data: { tripId: id, text, sortOrder: sortOrder++ } }),
    ),
  );
  return NextResponse.json(created);
}
