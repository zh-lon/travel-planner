// 随身行程手册在线查看（免登录）：凭分享码直接返回自包含 HTML 手册
// 二维码指向本路由，手机扫码即可打开；也可加 ?json=1 获取原始数据
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { tripToHtmlGuide } from "@/lib/export";
import type { TripDetail } from "@/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

async function findTripByToken(token: string) {
  if (!token) return null;
  return prisma.trip.findUnique({
    where: { shareToken: token },
    include: { items: { orderBy: [{ dayIndex: "asc" }, { sortOrder: "asc" }] } },
  });
}

export async function GET(request: Request, { params }: Params) {
  const { token } = await params;
  const trip = await findTripByToken(token);
  if (!trip) {
    return new NextResponse("分享链接无效或已被停用", {
      status: 404,
      headers: { "content-type": "text/plain;charset=utf-8" },
    });
  }

  // NextResponse.json 会把 Date 序列化为 ISO 字符串，与前端 TripDetail 类型一致
  const detail = JSON.parse(
    JSON.stringify({
      id: trip.id,
      title: trip.title,
      destination: trip.destination,
      startDate: trip.startDate,
      endDate: trip.endDate,
      budgetTotal: trip.budgetTotal,
      notes: trip.notes,
      ownerId: trip.ownerId,
      items: trip.items,
    }),
  ) as TripDetail;

  if (new URL(request.url).searchParams.get("json") === "1") {
    return NextResponse.json(detail);
  }

  return new NextResponse(tripToHtmlGuide(detail), {
    headers: {
      "content-type": "text/html;charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
