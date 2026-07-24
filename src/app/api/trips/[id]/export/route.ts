import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// 导出整个行程（含日程、开销、清单）为 JSON 备份文件
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const trip = await prisma.trip.findUnique({
    where: { id },
    include: {
      items: { orderBy: [{ dayIndex: "asc" }, { sortOrder: "asc" }] },
      expenses: { orderBy: [{ date: "asc" }, { createdAt: "asc" }] },
      checklist: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
    },
  });
  if (!trip) {
    return new Response(JSON.stringify({ error: "行程不存在" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  const { items, expenses, checklist, ...tripFields } = trip;
  const payload = {
    app: "lxgh",
    version: 1,
    exportedAt: new Date().toISOString(),
    trip: tripFields,
    items,
    expenses,
    checklist,
  };

  const filename = encodeURIComponent(`${trip.title}-备份.json`);
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename*=UTF-8''${filename}`,
    },
  });
}
