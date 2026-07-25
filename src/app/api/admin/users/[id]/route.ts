import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { requireAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// 管理员更新用户：昵称/管理员/禁用/重置密码
export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;

  const body = (await request.json().catch(() => null)) as {
    displayName?: unknown;
    isAdmin?: unknown;
    disabled?: unknown;
    password?: unknown;
  } | null;
  if (!body) return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });

  // 防自锁：不能禁用/取消自己的管理员身份
  if (id === admin.id && (body.disabled === true || body.isAdmin === false)) {
    return NextResponse.json({ error: "不能禁用或降级自己的账号" }, { status: 400 });
  }

  const data: {
    displayName?: string | null;
    isAdmin?: boolean;
    disabled?: boolean;
    passwordHash?: string;
  } = {};
  if ("displayName" in body) {
    data.displayName =
      typeof body.displayName === "string" && body.displayName.trim()
        ? body.displayName.trim()
        : null;
  }
  if (typeof body.isAdmin === "boolean") data.isAdmin = body.isAdmin;
  if (typeof body.disabled === "boolean") data.disabled = body.disabled;
  if (typeof body.password === "string" && body.password) {
    if (body.password.length < 6) {
      return NextResponse.json({ error: "密码至少 6 位" }, { status: 400 });
    }
    data.passwordHash = hashPassword(body.password);
  }

  const user = await prisma.user.update({ where: { id }, data }).catch(() => null);
  if (!user) return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  const { passwordHash: _hash, ...safe } = user;
  return NextResponse.json(safe);
}

// 管理员删除用户（其名下行程与共享一并删除）
export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  if (id === admin.id) {
    return NextResponse.json({ error: "不能删除自己的账号" }, { status: 400 });
  }
  const deleted = await prisma.user.delete({ where: { id } }).catch(() => null);
  if (!deleted) return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
