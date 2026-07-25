import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AUTH_COOKIE, createToken } from "@/lib/auth";
import { hashPassword } from "@/lib/password";

export const dynamic = "force-dynamic";

// 首次初始化：仅当系统中还没有任何用户时可用。
// 创建管理员账号，并把历史无归属的行程认领到该账号名下。
export async function POST(request: Request) {
  const count = await prisma.user.count();
  if (count > 0) {
    return NextResponse.json({ error: "系统已初始化，请直接登录" }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as {
    username?: unknown;
    password?: unknown;
    displayName?: unknown;
  } | null;
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const displayName =
    typeof body?.displayName === "string" && body.displayName.trim()
      ? body.displayName.trim()
      : null;

  if (!/^[a-zA-Z0-9_-]{2,32}$/.test(username)) {
    return NextResponse.json({ error: "用户名需为 2~32 位字母/数字/下划线/短横线" }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "密码至少 6 位" }, { status: 400 });
  }

  const user = await prisma.user.create({
    data: { username, passwordHash: hashPassword(password), displayName, isAdmin: true },
  });
  // 认领历史数据
  await prisma.trip.updateMany({ where: { ownerId: null }, data: { ownerId: user.id } });

  const token = await createToken(user.id, 30);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 86400,
  });
  return res;
}
