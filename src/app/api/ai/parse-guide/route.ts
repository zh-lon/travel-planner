import { NextResponse } from "next/server";
import { buildGuidePrompt, planStreamResponse, type GuideParams } from "@/lib/ai/generate";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

// 解析旅行攻略文本（如小红书笔记）为结构化行程
export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const body = (await request.json().catch(() => null)) as Partial<GuideParams> | null;
  if (!body) return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });

  const content = typeof body.content === "string" ? body.content.trim() : "";
  const destination = typeof body.destination === "string" ? body.destination.trim() : "";
  const startDate = typeof body.startDate === "string" ? body.startDate : "";
  const days = body.days == null ? undefined : Number(body.days);

  if (!content || content.length < 20) {
    return NextResponse.json({ error: "攻略内容太短，请粘贴完整的攻略正文" }, { status: 400 });
  }
  if (/^https?:\/\/\S+$/.test(content)) {
    return NextResponse.json(
      { error: "小红书链接需要登录才能访问，暂不支持直接解析链接。请在 App 里复制攻略正文文字后粘贴" },
      { status: 400 },
    );
  }
  if (!destination) return NextResponse.json({ error: "请填写目的地" }, { status: 400 });
  if (Number.isNaN(new Date(startDate).getTime())) {
    return NextResponse.json({ error: "出发日期不合法" }, { status: 400 });
  }
  if (days != null && (!Number.isInteger(days) || days < 1 || days > 30)) {
    return NextResponse.json({ error: "天数需在 1~30 之间" }, { status: 400 });
  }

  const params: GuideParams = {
    content: content.slice(0, 12000), // 防止超长攻略撑爆上下文
    destination,
    startDate,
    days,
  };

  return planStreamResponse(user.id, async () => ({
    messages: buildGuidePrompt(params),
    expectedDays: days ?? 0, // 0 = 天数由 AI 判断，不做强校验
    city: destination,
  }), undefined, request);
}
