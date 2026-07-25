import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { generateTotpSecret, otpauthUri } from "@/lib/totp";

export const dynamic = "force-dynamic";

// 开始绑定两步验证：生成密钥（未验证前不生效），返回扫码链接
export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  if (user.totpEnabled) {
    return NextResponse.json({ error: "两步验证已开启，如需重新绑定请先关闭" }, { status: 400 });
  }
  const secret = generateTotpSecret();
  await prisma.user.update({
    where: { id: user.id },
    data: { totpSecret: secret, totpEnabled: false },
  });
  return NextResponse.json({ secret, uri: otpauthUri(user.username, secret) });
}
