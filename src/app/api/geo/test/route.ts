import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

// 高德 Web 服务 Key 连通性测试：用地理编码接口查询一个固定地址验证 Key 是否可用
export async function POST(request: Request) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  const body = (await request.json().catch(() => ({}))) as { webKey?: string };
  const saved = await getSettings();
  const webKey = (body.webKey || saved["amap.webKey"] || "").trim();

  if (!webKey) {
    return NextResponse.json({ ok: false, error: "请先填写高德 Web 服务 Key" });
  }

  try {
    const url = `https://restapi.amap.com/v3/geocode/geo?address=${encodeURIComponent(
      "北京市天安门",
    )}&key=${encodeURIComponent(webKey)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, { signal: controller.signal }).finally(() =>
      clearTimeout(timer),
    );
    const data = (await res.json()) as { status?: string; info?: string; infocode?: string };

    if (data.status === "1") {
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({
      ok: false,
      error: `高德返回：${data.info ?? "未知错误"}（infocode ${data.infocode ?? "?"}）`,
    });
  } catch (err) {
    const error =
      err instanceof Error
        ? err.name === "AbortError"
          ? "请求超时（10 秒）"
          : err.message
        : String(err);
    return NextResponse.json({ ok: false, error });
  }
}
