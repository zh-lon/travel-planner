import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, tripAccess } from "@/lib/session";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// 读取 PoiExplorer 缓存
export async function GET(request: Request, { params }: Params) {
  const { id: tripId } = await params;
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  const access = await tripAccess(tripId, user);
  if (!access) return NextResponse.json({ error: "行程不存在或无权访问" }, { status: 404 });

  try {
    const cache = await prisma.poiExplorerCache.findUnique({
      where: { tripId_userId: { tripId, userId: user.id } },
    });
    return NextResponse.json({ ok: true, data: cache?.data ?? null });
  } catch {
    return NextResponse.json({ ok: true, data: null });
  }
}

// 保存 PoiExplorer 缓存
export async function PUT(request: Request, { params }: Params) {
  const { id: tripId } = await params;
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  const access = await tripAccess(tripId, user);
  if (!access) return NextResponse.json({ error: "行程不存在或无权访问" }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { data?: string };
  if (!body.data || typeof body.data !== "string") {
    return NextResponse.json({ error: "缺少 data 字段" }, { status: 400 });
  }

  // 校验 JSON 合法性
  try {
    JSON.parse(body.data);
  } catch {
    return NextResponse.json({ error: "data 不是合法 JSON" }, { status: 400 });
  }

  try {
    await prisma.poiExplorerCache.upsert({
      where: { tripId_userId: { tripId, userId: user.id } },
      create: { tripId, userId: user.id, data: body.data },
      update: { data: body.data },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "保存失败" }, { status: 500 });
  }
}