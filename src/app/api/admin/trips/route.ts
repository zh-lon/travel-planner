import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

// 管理员查看全部行程
export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  const trips = await prisma.trip.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      owner: { select: { id: true, username: true, displayName: true } },
      _count: { select: { items: true, shares: true, expenses: true } },
    },
  });
  return NextResponse.json(trips);
}
