import { NextResponse } from "next/server";
import { testConnection, type AiConfig, type AiProtocol } from "@/lib/ai/client";
import { requireAdmin } from "@/lib/session";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

// 连通性测试：优先用请求体里的表单值（用户可在保存前测试），缺省回落到已保存配置
export async function POST(request: Request) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  const body = (await request.json().catch(() => ({}))) as Partial<AiConfig>;
  const saved = await getSettings(admin.id);

  const config: AiConfig = {
    protocol: (body.protocol || saved["ai.protocol"] || "openai") as AiProtocol,
    baseUrl: (body.baseUrl || saved["ai.baseUrl"] || "").trim(),
    apiKey: (body.apiKey || saved["ai.apiKey"] || "").trim(),
    model: (body.model || saved["ai.model"] || "").trim(),
  };

  if (!config.baseUrl || !config.apiKey || !config.model) {
    return NextResponse.json({
      ok: false,
      error: "请先填写服务地址、API Key 和模型名",
    });
  }

  return NextResponse.json(await testConnection(config));
}
