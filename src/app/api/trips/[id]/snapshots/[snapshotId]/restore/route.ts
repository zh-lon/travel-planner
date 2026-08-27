import { NextResponse } from "next/server";
import { canEditRole, requireUser, tripAccess } from "@/lib/session";
import { restoreFromSnapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; snapshotId: string }> };

// POST /api/trips/[id]/snapshots/[snapshotId]/restore — 从快照恢复
export async function POST(request: Request, { params }: Params) {
  const { id, snapshotId } = await params;
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const access = await tripAccess(id, user);
  if (!access) return NextResponse.json({ error: "行程不存在或无权访问" }, { status: 404 });
  if (!canEditRole(access.role)) {
    return NextResponse.json({ error: "该行程对你是只读共享" }, { status: 403 });
  }

  try {
    const result = await restoreFromSnapshot(id, snapshotId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "恢复失败" },
      { status: 400 },
    );
  }
}