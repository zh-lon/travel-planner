import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { webSearch } from "@/lib/websearch";

export const dynamic = "force-dynamic";

// 联网搜索连通性测试（管理员，设置页用）：优先用表单值，回落到已保存配置
export async function POST(request: Request) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;

  const body = (await request.json().catch(() => ({}))) as {
    provider?: string;
    apiKey?: string;
  };
  const saved = await getSettings(admin.id);
  const provider = (body.provider || saved["search.provider"] || "tavily").trim();
  const apiKey = (body.apiKey || saved["search.apiKey"] || "").trim();
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "请先填写搜索 API Key" });
  }

  const start = Date.now();
  try {
    const results = await webSearch(provider, apiKey, "成都 旅游攻略", 2);
    if (results.length === 0) {
      return NextResponse.json({ ok: false, error: "搜索成功但没有返回结果" });
    }
    return NextResponse.json({
      ok: true,
      latencyMs: Date.now() - start,
      sample: results[0].title,
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
