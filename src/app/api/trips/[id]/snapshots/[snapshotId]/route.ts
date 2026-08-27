import { NextResponse } from "next/server";
import { canEditRole, requireUser, tripAccess } from "@/lib/session";
import { deleteSnapshot, getSnapshotData, renameSnapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; snapshotId: string }> };

// GET /api/trips/[id]/snapshots/[snapshotId] — 获取快照详情（行程数据）
export async function GET(request: Request, { params }: Params) {
  const { id, snapshotId } = await params;
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const access = await tripAccess(id, user);
  if (!access) return NextResponse.json({ error: "行程不存在或无权访问" }, { status: 404 });

  const data = await getSnapshotData(snapshotId);
  if (!data || data.tripId !== id) {
    return NextResponse.json({ error: "快照不存在" }, { status: 404 });
  }
  return NextResponse.json(data);
}

// DELETE /api/trips/[id]/snapshots/[snapshotId] — 删除快照
export async function DELETE(request: Request, { params }: Params) {
  const { id, snapshotId } = await params;
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const access = await tripAccess(id, user);
  if (!access) return NextResponse.json({ error: "行程不存在或无权访问" }, { status: 404 });
  if (!canEditRole(access.role)) {
    return NextResponse.json({ error: "该行程对你是只读共享" }, { status: 403 });
  }

  const ok = await deleteSnapshot(id, snapshotId);
  if (!ok) return NextResponse.json({ error: "快照不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

// PATCH /api/trips/[id]/snapshots/[snapshotId] — 重命名快照
export async function PATCH(request: Request, { params }: Params) {
  const { id, snapshotId } = await params;
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const access = await tripAccess(id, user);
  if (!access) return NextResponse.json({ error: "行程不存在或无权访问" }, { status: 404 });
  if (!canEditRole(access.role)) {
    return NextResponse.json({ error: "该行程对你是只读共享" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { label?: string } | null;
  if (!body || typeof body.label !== "string" || !body.label.trim()) {
    return NextResponse.json({ error: "标签不能为空" }, { status: 400 });
  }

  const ok = await renameSnapshot(id, snapshotId, body.label.trim());
  if (!ok) return NextResponse.json({ error: "快照不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}