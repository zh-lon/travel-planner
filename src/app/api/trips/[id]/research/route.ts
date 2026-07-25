import { NextResponse } from "next/server";
import dayjs from "dayjs";
import { prisma } from "@/lib/db";
import { aiConfigFromSettings } from "@/lib/ai/generate";
import { chatStream, type ChatMessage } from "@/lib/ai/client";
import { canEditRole, requireUser, tripAccess } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { webSearch, type WebSearchResult } from "@/lib/websearch";
import { dayCountOf } from "@/lib/trips";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const MAX_SPOT_QUERIES = 8; // 控制搜索配额与上下文长度

// 联网攻略研究：搜索目的地攻略 + 各景点评价 → AI 总结（SSE 流式）→ 存档到行程
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const access = await tripAccess(id, user);
  if (!access) return NextResponse.json({ error: "行程不存在或无权访问" }, { status: 404 });
  if (!canEditRole(access.role)) {
    return NextResponse.json({ error: "该行程对你是只读共享" }, { status: 403 });
  }
  const trip = access.trip;

  const settings = await getSettings();
  const provider = (settings["search.provider"] || "tavily").trim();
  const searchKey = (settings["search.apiKey"] || "").trim();
  if (!searchKey) {
    return NextResponse.json(
      { error: "尚未配置联网搜索服务，请管理员到设置页填写搜索 API Key" },
      { status: 400 },
    );
  }
  const aiConfig = aiConfigFromSettings(settings);
  if (!aiConfig) {
    return NextResponse.json({ error: "尚未配置 AI 服务，请管理员到设置页填写" }, { status: 400 });
  }

  const items = await prisma.itineraryItem.findMany({
    where: { tripId: id },
    orderBy: [{ dayIndex: "asc" }, { sortOrder: "asc" }],
  });
  // 资料来源：综合网页（默认）或仅小红书（搜索引擎收录的笔记标题与摘要）
  const body = (await request.json().catch(() => ({}))) as { source?: unknown };
  const sourceMode = body.source === "xhs" ? "xhs" : "web";
  const domain = sourceMode === "xhs" ? "xiaohongshu.com" : undefined;
  const sourceLabel = sourceMode === "xhs" ? "小红书笔记（搜索引擎收录）" : "综合网页搜索";
  // 需要查评价的地点：景点/餐饮类，去重
  const spotNames: string[] = [];
  for (const item of items) {
    const name = (item.placeName || (item.type === "SIGHT" ? item.title : "")).trim();
    if (!name) continue;
    if (!["SIGHT", "FOOD"].includes(item.type)) continue;
    if (!spotNames.includes(name)) spotNames.push(name);
  }
  const truncatedSpots = spotNames.length > MAX_SPOT_QUERIES;
  const spots = spotNames.slice(0, MAX_SPOT_QUERIES);

  const queries: { label: string; query: string }[] = [
    { label: "总体攻略", query: `${trip.destination} 旅游攻略 避坑 建议` },
    ...spots.map((name) => ({ label: name, query: `${trip.destination} ${name} 评价 攻略 怎么样` })),
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          // 客户端已断开
        }
      };
      try {
        // 1. 逐条搜索
        const sources: WebSearchResult[] = [];
        const sections: string[] = [];
        for (let i = 0; i < queries.length; i++) {
          const { label, query } = queries[i];
          send({ type: "status", text: `正在搜索（${i + 1}/${queries.length}）：${label}${sourceMode === "xhs" ? "（小红书）" : ""}` });
          try {
            const results = await webSearch(provider, searchKey, query, 4, 15000, domain);
            if (results.length === 0) continue;
            const lines = results.map((result) => {
              sources.push(result);
              const idx = sources.length;
              return `[${idx}] ${result.title}\n${result.content}`;
            });
            sections.push(`### 查询「${query}」的资料：\n${lines.join("\n\n")}`);
          } catch (err) {
            send({
              type: "status",
              text: `「${label}」搜索失败，已跳过（${err instanceof Error ? err.message : "未知错误"}）`,
            });
          }
        }
        if (sources.length === 0) {
          send({ type: "error", message: "所有搜索都没有返回结果，请检查搜索服务配置" });
          return;
        }
        if (truncatedSpots) {
          send({ type: "status", text: `地点较多，本次仅研究前 ${MAX_SPOT_QUERIES} 个景点/餐饮` });
        }

        // 2. AI 总结
        send({ type: "status", text: `资料收集完成（${sources.length} 条），正在总结…` });
        const dayCount = dayCountOf(trip.startDate, trip.endDate);
        const messages: ChatMessage[] = [
          {
            role: "system",
            content: `你是旅行研究助理。请基于用户提供的网络搜索资料，为其行程整理一份实用的中文参考总结（Markdown 格式）。
要求：
1. 结构：先「## 总体参考」（交通、住宿区域、最佳时间、预算、避坑等，资料里有什么写什么）；然后「## 各地点参考」，每个地点一个小节（### 地点名），概括网友评价的亮点、槽点/避坑、建议游玩时长、门票/预约提示；最后「## 实用提示」列零散但有用的信息。
2. 只依据资料内容总结，资料没提到的不要编造；观点有冲突时并列说明。
3. 引用来源用 [编号] 标注在相应句子后，编号与资料一致；不要自己编造链接。
4. 语言简洁实用，去掉营销腔和无信息量的话。${sourceMode === "xhs" ? "\n5. 本次资料主要来自小红书笔记的标题与摘要片段（受登录墙限制可能不完整），标题本身往往包含关键信息（如「避雷」「必去」），请合理利用但不要过度推断。" : ""}`,
          },
          {
            role: "user",
            content: `我的行程：${trip.destination}，${dayjs(trip.startDate).format("YYYY年M月D日")}出发，共 ${dayCount} 天。\n涉及地点：${spots.join("、") || "（暂无具体地点）"}\n\n以下是搜索到的资料：\n\n${sections.join("\n\n")}`,
          },
        ];

        let summary = "";
        try {
          summary = await chatStream(aiConfig, messages, (delta) => send({ type: "delta", text: delta }), 6000);
        } catch (err) {
          send({
            type: "error",
            message: `AI 总结失败：${err instanceof Error ? err.message : String(err)}`,
          });
          return;
        }

        // 3. 追加真实来源列表并存档
        const sourceList = sources
          .map((s, i) => `${i + 1}. [${s.title.replace(/[\[\]]/g, "")}](${s.url})`)
          .join("\n");
        const finalSummary = `> 资料来源：${sourceLabel}\n\n${summary.trim()}\n\n## 参考来源\n${sourceList}`;
        const researchAt = new Date();
        await prisma.trip.update({
          where: { id },
          data: { researchSummary: finalSummary, researchAt },
        });
        send({ type: "result", summary: finalSummary, researchAt: researchAt.toISOString() });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        try {
          controller.close();
        } catch {
          // 已关闭
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
    },
  });
}

// 删除已保存的研究结果
export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const access = await tripAccess(id, user);
  if (!access) return NextResponse.json({ error: "行程不存在或无权访问" }, { status: 404 });
  if (!canEditRole(access.role)) {
    return NextResponse.json({ error: "该行程对你是只读共享" }, { status: 403 });
  }
  await prisma.trip.update({
    where: { id },
    data: { researchSummary: null, researchAt: null },
  });
  return NextResponse.json({ ok: true });
}
