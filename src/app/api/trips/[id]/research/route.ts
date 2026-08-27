import { NextResponse } from "next/server";
import dayjs from "dayjs";
import { prisma } from "@/lib/db";
import { aiConfigFromSettings } from "@/lib/ai/generate";
import { chatStream, secondaryConfig, type ChatMessage } from "@/lib/ai/client";
import { canEditRole, requireUser, tripAccess } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { webSearch, type WebSearchResult } from "@/lib/websearch";
import { dayCountOf } from "@/lib/trips";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const MAX_AI_QUERIES = 12; // AI 规划搜索策略时最多生成的查询条数

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

  const settings = await getSettings(user.id);
  const aiConfig = aiConfigFromSettings(settings);
  if (!aiConfig) {
    return NextResponse.json({ error: "尚未配置 AI 服务，请管理员到设置页填写" }, { status: 400 });
  }

  // 资料来源：综合网页（默认）、仅小红书、AI 直搜（跳过搜索引擎）
  const body = (await request.json().catch(() => ({}))) as { source?: unknown };
  const sourceMode = body.source === "xhs" ? "xhs" : body.source === "ai" ? "ai" : "web";
  const needSearch = sourceMode !== "ai";
  const provider = needSearch ? (settings["search.provider"] || "tavily").trim() : "";
  const searchKey = needSearch ? (settings["search.apiKey"] || "").trim() : "";
  if (needSearch && !searchKey) {
    return NextResponse.json(
      { error: "尚未配置联网搜索服务，请管理员到设置页填写搜索 API Key" },
      { status: 400 },
    );
  }
  const domains = sourceMode === "xhs" ? ["xiaohongshu.com"] : undefined;
  const sourceLabel = sourceMode === "xhs" ? "小红书笔记（搜索引擎收录）" : sourceMode === "ai" ? "AI 联网搜索" : "综合网页搜索";
  const dayCount = dayCountOf(trip.startDate, trip.endDate);

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
      // 心跳：每 15 秒发一个 SSE 注释，防止代理因无数据而超时断连
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          // 客户端已断开
        }
      }, 15000);
      try {
        if (sourceMode === "ai") {
          // AI 直搜模式：由 AI 自行联网搜索攻略，无需调用外部搜索 API
          send({ type: "status", text: "AI 正在联网搜索攻略…" });
          const aiMessages: ChatMessage[] = [
            {
              role: "system",
              content: `你是旅行研究助理。请**联网搜索**用户行程涉及的目的地综合攻略信息，整理成一份实用的中文参考总结（Markdown 格式）。
要求：
1. 联网搜索以下内容：
   - 目的地整体攻略（交通串联、住宿区域、最佳时间、预算、避坑、天气穿搭等）
   - 行程路线的合理性和优化建议
2. 结构：先「## 总体参考」；然后「## 实用提示」；最后「## 参考来源」附上链接。
3. 引用来源用 [编号] 标注在相应句子后。
4. 信息尽量准确实用，观点有冲突时并列说明；语言简洁，去掉营销腔。`,
            },
            {
              role: "user",
              content: `我的行程：${trip.destination}，${dayjs(trip.startDate).format("YYYY年M月D日")}出发，共 ${dayCount} 天。

请联网搜索以上目的地的综合攻略信息，整理成参考报告。`,
            },
          ];
          let summary = "";
          try {
            summary = await chatStream(aiConfig, aiMessages, (delta) => send({ type: "delta", text: delta }), 6000);
          } catch (err) {
            send({
              type: "error",
              message: `AI 总结失败：${err instanceof Error ? err.message : String(err)}`,
            });
            return;
          }
          const finalSummary = `> 资料来源：AI 联网搜索（仅供参考）\n\n${summary.trim()}`;
          const researchAt = new Date();
          await prisma.trip.update({
            where: { id },
            data: { researchAi: finalSummary, researchAiAt: researchAt },
          });
          send({ type: "result", summary: finalSummary, researchAt: researchAt.toISOString() });
          return;
        }

        // 0. AI 规划搜索策略：根据行程上下文生成精准的搜索查询
        send({ type: "status", text: "AI 正在分析行程，规划搜索策略…" });
        let queries: { label: string; query: string }[] = [];
        try {
          const planMessages: ChatMessage[] = [
            {
              role: "system",
              content: `你是旅行搜索策略专家。根据用户行程，规划一组高价值的搜索查询，用于后续联网搜索和 AI 总结。
输出 JSON 数组，每个元素包含 label 和 query 字段：
- label: 简短中文描述（如"昆大丽串联路线"、"大理住宿推荐"）
- query: 搜索关键词（中文，精准具体，可包含季节/月份、交通方式、住宿区域、预算、避坑等实用维度）

规则：
1. 只生成综合攻略类查询，不需要单独地点查询：
   - 若目的地为多城市组合路线（如"昆明、大理、丽江、香格里拉"），首条必须搜索该组合路线的完整攻略（如"昆大丽香 11天 路线攻略 交通串联 住宿安排"），再搜索城际交通方式（如"昆明到大理 丽江到香格里拉 交通方式 自驾"）、住宿推荐、季节注意事项等
   - 若为单城市，搜索目的地+季节+住宿+交通+避坑等维度
2. 总数不超过 ${MAX_AI_QUERIES} 条
3. 只输出 JSON 数组，不要其他文字`,
            },
            {
              role: "user",
              content: `行程：${trip.destination}，${dayjs(trip.startDate).format("YYYY年M月D日")}出发，共 ${dayCount} 天。
搜索来源：${sourceLabel}`,
            },
          ];
          // 流式生成（delta 为中间 JSON 规划，不转发给前端，避免混入最终总结文本）
          const rawPlan = await chatStream(secondaryConfig(aiConfig), planMessages, () => {}, 1024, 30000);
          const jsonStr = rawPlan.trim().replace(/```json\s*|\s*```/g, "");
          const parsed = JSON.parse(jsonStr) as unknown;
          if (Array.isArray(parsed)) {
            queries = parsed
              .filter(
                (q: unknown) =>
                  typeof q === "object" &&
                  q !== null &&
                  typeof (q as Record<string, unknown>).query === "string" &&
                  ((q as Record<string, unknown>).query as string).trim().length > 0,
              )
              .map((q: unknown) => {
                const obj = q as Record<string, unknown>;
                return {
                  label: (typeof obj.label === "string" ? obj.label : obj.query) as string,
                  query: (obj.query as string).trim(),
                };
              });
          }
        } catch (err) {
          console.warn("[research] AI 规划搜索策略失败，回退到机械查询", err);
        }
        // 回退：AI 规划失败时使用机械查询
        if (queries.length === 0) {
          queries = [
            { label: "综合攻略", query: `${trip.destination} 旅游攻略 交通 住宿 避坑 建议` },
          ];
        }

        // 1. 逐条搜索（博查限流 ~1 QPS，请求间延迟 300ms）
        const sources: WebSearchResult[] = [];
        const sections: string[] = [];
        for (let i = 0; i < queries.length; i++) {
          const { label, query } = queries[i];
          if (i > 0) await new Promise((r) => setTimeout(r, 300));
          send({ type: "status", text: `正在搜索（${i + 1}/${queries.length}）：${label}${sourceMode === "xhs" ? "（小红书）" : ""}` });
          try {
            const results = await webSearch(provider, searchKey, query, 4, 15000, domains);
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

        // 2. AI 总结
        send({ type: "status", text: `资料收集完成（${sources.length} 条），正在总结…` });
        const messages: ChatMessage[] = [
          {
            role: "system",
            content: `你是旅行研究助理。请基于用户提供的网络搜索资料，为其行程整理一份实用的中文参考总结（Markdown 格式）。
要求：
1. 结构：先「## 总体参考」（交通、住宿区域、最佳时间、预算、避坑等，资料里有什么写什么）；最后「## 实用提示」列零散但有用的信息。
2. 只依据资料内容总结，资料没提到的不要编造；观点有冲突时并列说明。
3. 引用来源用 [编号] 标注在相应句子后，编号与资料一致；不要自己编造链接。
4. 语言简洁实用，去掉营销腔和无信息量的话。${sourceMode === "xhs" ? "\n5. 本次资料主要来自小红书笔记的标题与摘要片段（受登录墙限制可能不完整），标题本身往往包含关键信息（如「避雷」「必去」），请合理利用但不要过度推断。" : ""}`,
          },
          {
            role: "user",
            content: `我的行程：${trip.destination}，${dayjs(trip.startDate).format("YYYY年M月D日")}出发，共 ${dayCount} 天。

以下是搜索到的资料：

${sections.join("\n\n")}`,
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
        const updateData: Record<string, unknown> = {};
        if (sourceMode === "xhs") {
          updateData.researchXhs = finalSummary;
          updateData.researchXhsAt = researchAt;
        } else {
          updateData.researchWeb = finalSummary;
          updateData.researchWebAt = researchAt;
        }
        await prisma.trip.update({
          where: { id },
          data: updateData as { researchWeb?: string; researchWebAt?: Date; researchXhs?: string; researchXhsAt?: Date },
        });
        send({ type: "result", summary: finalSummary, researchAt: researchAt.toISOString() });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        clearInterval(heartbeat);
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
    data: { researchWeb: null, researchWebAt: null, researchXhs: null, researchXhsAt: null, researchAi: null, researchAiAt: null },
  });
  return NextResponse.json({ ok: true });
}
