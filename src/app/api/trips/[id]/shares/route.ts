import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, tripAccess } from "@/lib/session";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// 行程共享管理（仅所有者/管理员）
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const access = await tripAccess(id, user);
  if (!access || access.role !== "owner") {
    return NextResponse.json({ error: "只有行程所有者可以管理共享" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    where: {
      disabled: false,
      id: { notIn: [user.id, access.trip.ownerId ?? ""].filter(Boolean) },
    },
    select: { id: true, username: true, displayName: true },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({
    users,
    shares: access.trip.shares.map((s) => ({ userId: s.userId, canEdit: s.canEdit })),
  });
}

// body: { userId, canEdit: boolean | null }  canEdit=null 表示取消共享
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const access = await tripAccess(id, user);
  if (!access || access.role !== "owner") {
    return NextResponse.json({ error: "只有行程所有者可以管理共享" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    userId?: unknown;
    canEdit?: unknown;
  } | null;
  const userId = typeof body?.userId === "string" ? body.userId : "";
  if (!userId) return NextResponse.json({ error: "缺少用户 ID" }, { status: 400 });
  if (userId === access.trip.ownerId) {
    return NextResponse.json({ error: "不能共享给行程所有者本人" }, { status: 400 });
  }
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) return NextResponse.json({ error: "用户不存在" }, { status: 404 });

  if (body?.canEdit === null) {
    await prisma.tripShare.deleteMany({ where: { tripId: id, userId } });
    return NextResponse.json({ ok: true, removed: true });
  }
  const canEdit = body?.canEdit === true;
  await prisma.tripShare.upsert({
    where: { tripId_userId: { tripId: id, userId } },
    update: { canEdit },
    create: { tripId: id, userId, canEdit },
  });
  return NextResponse.json({ ok: true });
}
