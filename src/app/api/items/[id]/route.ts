import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireTripEditByChild, requireUser } from "@/lib/session";
import { ITEM_TYPE_VALUES } from "@/types/constants";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// 区分「记录不存在」(P2025 → 404) 和其他数据库错误 (→ 500，带真实原因)
function dbError(err: unknown): NextResponse {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
    return NextResponse.json({ error: "行程项不存在" }, { status: 404 });
  }
  console.error("[items] 数据库操作失败:", err);
  const detail = err instanceof Error ? err.message.slice(0, 200) : String(err);
  return NextResponse.json({ error: `数据库操作失败：${detail}` }, { status: 500 });
}

const TRANSPORT_MODES = ["line", "driving", "walking", "riding"];

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const existing = await prisma.itineraryItem.findUnique({
    where: { id },
    select: { tripId: true },
  });
  if (!existing) return NextResponse.json({ error: "行程项不存在" }, { status: 404 });
  const denied = await requireTripEditByChild(user, existing.tripId);
  if (denied) return denied;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });

  const data: {
    type?: string;
    title?: string;
    startTime?: string | null;
    endTime?: string | null;
    placeName?: string | null;
    lng?: number | null;
    lat?: number | null;
    address?: string | null;
    estimatedCost?: number | null;
    notes?: string | null;
    transportMode?: string | null;
  } = {};

  if (typeof body.type === "string" && ITEM_TYPE_VALUES.includes(body.type)) {
    data.type = body.type;
  }
  if (typeof body.title === "string" && body.title.trim()) {
    data.title = body.title.trim();
  }
  if ("startTime" in body) data.startTime = strOrNull(body.startTime);
  if ("endTime" in body) data.endTime = strOrNull(body.endTime);
  if ("placeName" in body) data.placeName = strOrNull(body.placeName);
  if ("lng" in body) data.lng = typeof body.lng === "number" ? body.lng : null;
  if ("lat" in body) data.lat = typeof body.lat === "number" ? body.lat : null;
  if ("address" in body) data.address = strOrNull(body.address);
  if ("notes" in body) data.notes = strOrNull(body.notes);
  if ("transportMode" in body) {
    data.transportMode =
      typeof body.transportMode === "string" && TRANSPORT_MODES.includes(body.transportMode)
        ? body.transportMode
        : null;
  }
  if ("estimatedCost" in body) {
    data.estimatedCost =
      typeof body.estimatedCost === "number" && body.estimatedCost >= 0
        ? body.estimatedCost
        : null;
  }

  try {
    const item = await prisma.itineraryItem.update({ where: { id }, data });
    return NextResponse.json(item);
  } catch (err) {
    return dbError(err);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const existing = await prisma.itineraryItem.findUnique({
    where: { id },
    select: { tripId: true },
  });
  if (!existing) return NextResponse.json({ error: "行程项不存在" }, { status: 404 });
  const denied = await requireTripEditByChild(user, existing.tripId);
  if (denied) return denied;

  try {
    await prisma.itineraryItem.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return dbError(err);
  }
}
