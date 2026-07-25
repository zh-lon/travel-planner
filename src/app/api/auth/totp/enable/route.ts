import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { verifyTotp } from "@/lib/totp";

export const dynamic = "force-dynamic";

// 验证首个动态码，正式开启两步验证
export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  if (user.totpEnabled) {
    return NextResponse.json({ error: "两步验证已开启" }, { status: 400 });
  }
  if (!user.totpSecret) {
    return NextResponse.json({ error: "请先生成绑定二维码" }, { status: 400 });
  }
  const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!verifyTotp(user.totpSecret, code)) {
    return NextResponse.json({ error: "验证码不正确，请确认时间同步后重试" }, { status: 400 });
  }
  await prisma.user.update({ where: { id: user.id }, data: { totpEnabled: true } });
  return NextResponse.json({ ok: true });
}
