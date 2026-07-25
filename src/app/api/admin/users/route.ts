import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { requireAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { trips: true } } },
  });
  return NextResponse.json(
    users.map(({ passwordHash: _hash, ...user }) => user),
  );
}

// 管理员创建用户（系统不开放注册）
export async function POST(request: Request) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;

  const body = (await request.json().catch(() => null)) as {
    username?: unknown;
    password?: unknown;
    displayName?: unknown;
    isAdmin?: unknown;
  } | null;
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!/^[a-zA-Z0-9_-]{2,32}$/.test(username)) {
    return NextResponse.json({ error: "用户名需为 2~32 位字母/数字/下划线/短横线" }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "密码至少 6 位" }, { status: 400 });
  }
  const exists = await prisma.user.findUnique({ where: { username } });
  if (exists) return NextResponse.json({ error: "用户名已存在" }, { status: 400 });

  const user = await prisma.user.create({
    data: {
      username,
      passwordHash: hashPassword(password),
      displayName:
        typeof body?.displayName === "string" && body.displayName.trim()
          ? body.displayName.trim()
          : null,
      isAdmin: body?.isAdmin === true,
    },
  });
  const { passwordHash: _hash, ...safe } = user;
  return NextResponse.json(safe);
}
