import { createHash, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { AUTH_COOKIE, authEnabled, authPassword, createToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

// 登录失败限速：单 IP 连续失败 5 次锁定 60 秒（内存记录，重启即清）
const failMap = new Map<string, { fails: number; lockedUntil: number }>();
const MAX_FAILS = 5;
const LOCK_MS = 60000;

function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || "local";
}

function passwordMatches(input: string): boolean {
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(authPassword()).digest();
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!authEnabled()) {
    return NextResponse.json({ error: "未启用登录认证" }, { status: 400 });
  }

  const ip = clientIp(request);
  const record = failMap.get(ip);
  if (record && record.lockedUntil > Date.now()) {
    const wait = Math.ceil((record.lockedUntil - Date.now()) / 1000);
    return NextResponse.json({ error: `失败次数过多，请 ${wait} 秒后重试` }, { status: 429 });
  }

  const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
  const password = typeof body?.password === "string" ? body.password : "";

  if (!password || !passwordMatches(password)) {
    const fails = (record?.fails ?? 0) + 1;
    failMap.set(ip, {
      fails,
      lockedUntil: fails >= MAX_FAILS ? Date.now() + LOCK_MS : 0,
    });
    await new Promise((r) => setTimeout(r, 600)); // 拖慢爆破
    return NextResponse.json({ error: "密码错误" }, { status: 401 });
  }

  failMap.delete(ip);
  const token = await createToken(30);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 86400,
  });
  return res;
}
