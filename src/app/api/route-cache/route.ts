import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// 路线规划缓存：纯坐标数据，不含用户敏感信息。
// 认证说明：middleware 已对 /api/* 强制校验令牌，此处 requireUser 仅做二次确认（一致风格）。
// cacheKey 格式：`${mode}|${lng},${lat}|${lng},${lat}`，使用 ";" 作为多 key 分隔符（key 内含 "," 和 "|"）。

// GET /api/route-cache?keys=k1;k2;k3 — 批量读取缓存
export async function GET(request: Request) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  const keysParam = new URL(request.url).searchParams.get("keys") ?? "";
  const keys = keysParam
    .split(";")
    .map((k) => k.trim())
    .filter(Boolean);
  if (keys.length === 0) return NextResponse.json({ routes: {} });

  const rows = await prisma.routeCache.findMany({
    where: { cacheKey: { in: keys } },
    select: { cacheKey: true, data: true },
  });
  const routes: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      routes[row.cacheKey] = JSON.parse(row.data);
    } catch {
      /* 数据损坏，跳过该条 */
    }
  }
  return NextResponse.json({ routes });
}

// PUT /api/route-cache — 批量写入（upsert）缓存
// Body: { routes: Record<string, SegRoute | null> }
export async function PUT(request: Request) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  const body = (await request.json().catch(() => null)) as { routes?: Record<string, unknown> } | null;
  if (!body?.routes || typeof body.routes !== "object") {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const entries = Object.entries(body.routes);
  if (entries.length === 0) return NextResponse.json({ ok: true });

  await Promise.all(
    entries.map(([key, value]) =>
      prisma.routeCache.upsert({
        where: { cacheKey: key },
        create: { cacheKey: key, data: JSON.stringify(value ?? null) },
        update: { data: JSON.stringify(value ?? null) },
      }),
    ),
  );
  return NextResponse.json({ ok: true });
}

// DELETE /api/route-cache?key=... — 删除单条缓存（重试规划时清除失败记录）
export async function DELETE(request: Request) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (!key) return NextResponse.json({ error: "缺少 key 参数" }, { status: 400 });

  await prisma.routeCache.deleteMany({ where: { cacheKey: key } });
  return NextResponse.json({ ok: true });
}
