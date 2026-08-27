import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

// 登录用户可获取的公共前端配置（仅地图渲染所需的 JS Key，不含任何服务端密钥）
export async function GET(request: Request) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const settings = await getSettings(user.id);
  return NextResponse.json({
    amapJsKey: settings["amap.jsKey"] ?? "",
    amapSecurityCode: settings["amap.securityCode"] ?? "",
  });
}
