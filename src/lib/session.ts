// 服务端会话与鉴权助手（Node 运行时，可访问数据库）
import { NextResponse } from "next/server";
import type { Trip, TripShare, User } from "@prisma/client";
import { parseToken, tokenFromCookieHeader } from "./auth";
import { prisma } from "./db";

export async function currentUser(request: Request): Promise<User | null> {
  const token = tokenFromCookieHeader(request.headers.get("cookie"));
  const parsed = await parseToken(token);
  if (!parsed) return null;
  const user = await prisma.user.findUnique({ where: { id: parsed.userId } });
  if (!user || user.disabled) return null;
  return user;
}

export async function requireUser(request: Request): Promise<User | NextResponse> {
  const user = await currentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  return user;
}

export async function requireAdmin(request: Request): Promise<User | NextResponse> {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  if (!user.isAdmin) return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });
  return user;
}

export type TripRole = "owner" | "edit" | "read";

export interface TripAccess {
  trip: Trip & { shares: TripShare[] };
  role: TripRole;
}

// 行程访问权限：所有者/管理员 = owner；被共享 = edit（可编辑）/ read（只读）
export async function tripAccess(tripId: string, user: User): Promise<TripAccess | null> {
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, include: { shares: true } });
  if (!trip) return null;
  if (user.isAdmin || trip.ownerId === user.id || trip.ownerId === null) {
    return { trip, role: "owner" };
  }
  const share = trip.shares.find((s) => s.userId === user.id);
  if (!share) return null;
  return { trip, role: share.canEdit ? "edit" : "read" };
}

export function canEditRole(role: TripRole): boolean {
  return role === "owner" || role === "edit";
}

// [id] 直达路由（行程项/开销/清单）鉴权：返回错误 Response 或 null（通过）
export async function requireTripEditByChild(
  user: User,
  tripId: string,
): Promise<NextResponse | null> {
  const access = await tripAccess(tripId, user);
  if (!access) return NextResponse.json({ error: "无权访问该行程" }, { status: 403 });
  if (!canEditRole(access.role)) {
    return NextResponse.json({ error: "该行程对你是只读共享" }, { status: 403 });
  }
  return null;
}

export function publicUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    isAdmin: user.isAdmin,
  };
}
