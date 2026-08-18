// 随身行程手册在线分享码管理（所有者）：
// POST 生成/返回分享码（regenerate=true 强制换新）；DELETE 停用分享码
import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { requireUser, tripAccess } from "@/lib/session";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

function newToken(): string {
  return randomBytes(12).toString("base64url");
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const access = await tripAccess(id, user);
  if (!access) return NextResponse.json({ error: "行程不存在或无权访问" }, { status: 404 });
  if (access.role !== "owner") {
    return NextResponse.json({ error: "只有行程所有者可以管理分享码" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { regenerate?: boolean } | null;
  const regenerate = !!body?.regenerate;

  if (!regenerate && access.trip.shareToken) {
    return NextResponse.json({ shareToken: access.trip.shareToken, shareTokenAt: access.trip.shareTokenAt });
  }

  // 生成唯一 token（极小概率冲突时重试）
  for (let i = 0; i < 3; i++) {
    const token = newToken();
    const updated = await prisma.trip
      .update({
        where: { id },
        data: { shareToken: token, shareTokenAt: new Date() },
      })
      .catch(() => null);
    if (updated) {
      return NextResponse.json({ shareToken: updated.shareToken, shareTokenAt: updated.shareTokenAt });
    }
  }
  return NextResponse.json({ error: "生成分享码失败，请重试" }, { status: 500 });
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const access = await tripAccess(id, user);
  if (!access) return NextResponse.json({ error: "行程不存在或无权访问" }, { status: 404 });
  if (access.role !== "owner") {
    return NextResponse.json({ error: "只有行程所有者可以管理分享码" }, { status: 403 });
  }

  await prisma.trip.update({
    where: { id },
    data: { shareToken: null, shareTokenAt: null },
  });
  return NextResponse.json({ ok: true });
}
