import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AUTH_COOKIE, createToken, parsePreAuthToken } from "@/lib/auth";
import { verifyTotp } from "@/lib/totp";

export const dynamic = "force-dynamic";

// 两步登录第二步：预认证令牌 + 动态码 → 发会话
// 验证码失败限速：单 IP 连续错 5 次锁 60 秒
const failMap = new Map<string, { fails: number; lockedUntil: number }>();
const MAX_FAILS = 5;
const LOCK_MS = 60000;

function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || "local";
}

export async function POST(request: Request) {
  const ip = clientIp(request);
  const record = failMap.get(ip);
  if (record && record.lockedUntil > Date.now()) {
    const wait = Math.ceil((record.lockedUntil - Date.now()) / 1000);
    return NextResponse.json({ error: `失败次数过多，请 ${wait} 秒后重试` }, { status: 429 });
  }

  const body = (await request.json().catch(() => null)) as {
    preToken?: unknown;
    code?: unknown;
  } | null;
  const parsed = await parsePreAuthToken(
    typeof body?.preToken === "string" ? body.preToken : undefined,
  );
  if (!parsed) {
    return NextResponse.json({ error: "登录会话已过期，请重新输入密码" }, { status: 401 });
  }
  const user = await prisma.user.findUnique({ where: { id: parsed.userId } });
  if (!user || user.disabled || !user.totpEnabled || !user.totpSecret) {
    return NextResponse.json({ error: "登录状态异常，请重新登录" }, { status: 401 });
  }

  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!verifyTotp(user.totpSecret, code)) {
    const fails = (record?.fails ?? 0) + 1;
    failMap.set(ip, { fails, lockedUntil: fails >= MAX_FAILS ? Date.now() + LOCK_MS : 0 });
    await new Promise((r) => setTimeout(r, 600));
    return NextResponse.json({ error: "验证码不正确" }, { status: 401 });
  }

  failMap.delete(ip);
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
