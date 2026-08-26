// AI 共同创作：单轮对话 → 聊天回复 +（可选）当天行程提议，SSE 流式
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { aiConfigFromSettings, matchPlanCoords } from "@/lib/ai/generate";
import { chatStream, type ChatMessage } from "@/lib/ai/client";
import { webSearch } from "@/lib/websearch";

// 平台域名映射
const PLATFORM_DOMAINS: Record<string, { label: string; domains?: string[] }> = {
  all: { label: "全网" },
  xiaohongshu: { label: "小红书", domains: ["xiaohongshu.com"] },
  mafengwo: { label: "马蜂窝", domains: ["mafengwo.cn"] },
  ctrip: { label: "携程", domains: ["ctrip.com"] },
  dianping: { label: "大众点评", domains: ["dianping.com"] },
  qunar: { label: "去哪儿", domains: ["qunar.com"] },
  fliggy: { label: "飞猪", domains: ["fliggy.com"] },
};
import {
  buildCoplanPrompt,
  buildOverviewPrompt,
  parseCoplanReply,
  parseOverviewReply,
  type CoplanParams,
  type OverviewSegment,
} from "@/lib/ai/coplan";
import type { AiPlanDay, AiPlanItem } from "@/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  const body = (await request.json().catch(() => null)) as Partial<CoplanParams & { mode?: string; webSearch?: boolean; searchPlatform?: string }> | null;
  const mode = body?.mode === "overview" ? "overview" : "day";
  const useWebSearch = !!body?.webSearch;
  const searchPlatform = typeof body?.searchPlatform === "string" ? body.searchPlatform : "all";
  const destination = typeof body?.destination === "string" ? body.destination.trim() : "";
  const startDate = typeof body?.startDate === "string" ? body.startDate : "";
  const days = Number(body?.days);
  if (
    !destination ||
    !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
    !Number.isInteger(days) ||
    days < 1 ||
    days > 30
  ) {
    return NextResponse.json({ error: "请求参数不完整或不合法" }, { status: 400 });
  }
  const focusDay = mode === "day" ? Number(body?.focusDay) : 0;
  if (mode === "day" && (!Number.isInteger(focusDay) || focusDay < 0 || focusDay >= days)) {
    return NextResponse.json({ error: "请求参数不完整或不合法" }, { status: 400 });
  }
  const messages = Array.isArray(body?.messages)
    ? body.messages
        .filter(
          (m): m is { role: "user" | "assistant"; content: string } =>
            !!m &&
            (m.role === "user" || m.role === "assistant") &&
            typeof m.content === "string" &&
            !!m.content.trim(),
        )
        .slice(-30)
    : [];
  if (mode === "day" && messages.length === 0) {
    return NextResponse.json({ error: "缺少对话内容" }, { status: 400 });
  }
  const confirmedDays =
    mode === "day" && Array.isArray(body?.confirmedDays)
      ? (body.confirmedDays as { dayIndex: number; items: AiPlanItem[] }[]).filter(
          (d) => d && Number.isInteger(d.dayIndex) && Array.isArray(d.items),
        )
      : [];

  const params: CoplanParams = { destination, startDate, days, focusDay, confirmedDays, messages };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // 客户端断开时中止所有 AI 调用（双重保障：request.signal + heartbeat 兜底）
      const clientAbort = new AbortController();
      const onClientDisconnect = () => clientAbort.abort();
      request.signal.addEventListener("abort", onClientDisconnect, { once: true });
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          // 客户端已断开，通知所有进行中的 AI 调用中止
          clientAbort.abort();
        }
      };
      // 心跳：每 15 秒发一个 SSE 注释，防止代理因无数据而超时断连
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          // 客户端已断开
          clientAbort.abort();
        }
      }, 15000);
      try {
        const settings = await getSettings();
        const config = aiConfigFromSettings(settings);
        if (!config) {
          send({ type: "error", message: "尚未配置 AI 服务，请先到设置页填写服务地址、API Key 和模型名" });
          return;
        }

        // 联网搜索（可选）
        let searchContext: string | undefined;
        if (useWebSearch) {
          const searchProvider = (settings["search.provider"] ?? "tavily").trim();
          const searchApiKey = (settings["search.apiKey"] ?? "").trim();
          if (!searchApiKey) {
            send({ type: "status", text: "未配置联网搜索 API Key，跳过搜索" });
          } else {
            const platformInfo = PLATFORM_DOMAINS[searchPlatform] ?? PLATFORM_DOMAINS.all;
            send({ type: "status", text: `正在联网搜索${platformInfo.domains ? `（${platformInfo.label}）` : ""}参考信息…` });
            // 构建搜索查询
            const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
            const query = mode === "overview"
              ? `${destination} 旅游攻略 行程安排`
              : `${destination} ${lastUserMsg?.content ?? ""}`.trim();
            const domains = platformInfo.domains;
            try {
              const results = await webSearch(searchProvider, searchApiKey, query, 6, 15000, domains);
              if (results.length > 0) {
                searchContext = results
                  .map((r, i) => `${i + 1}. 【${r.title}】${r.content} (来源: ${r.url})`)
                  .join("\n");
                send({ type: "status", text: `搜索到 ${results.length} 条参考信息` });
              } else {
                send({ type: "status", text: "搜索未返回结果，仅凭 AI 知识生成" });
              }
            } catch (err) {
              send({ type: "status", text: `联网搜索失败：${err instanceof Error ? err.message : "未知错误"}，仅凭 AI 知识生成` });
            }
          }
        }

        const convo: ChatMessage[] =
          mode === "overview"
            ? buildOverviewPrompt({ destination, startDate, days, messages, searchContext })
            : buildCoplanPrompt({ ...params, searchContext });
        let reply = "";
        let day: AiPlanDay | null = null;
        let overviewSegments: OverviewSegment[] | null = null;
        let ok = false;
        const MAX_ATTEMPTS = 2;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS && !ok; attempt++) {
          send({ type: "status", text: attempt === 1 ? (mode === "overview" ? "正在生成行程概览…" : "AI 正在思考…") : "输出校验未通过，正在重试…" });
          let raw = "";
          try {
            raw = await chatStream(config, convo, (delta) => send({ type: "delta", text: delta }), config.maxTokens, undefined, clientAbort.signal);
          } catch (err) {
            const msg =
              err instanceof Error
                ? err.name === "AbortError"
                  ? "AI 调用超时（10 分钟无响应）"
                  : err.message
                : String(err);
            send({ type: "error", message: `AI 调用失败：${msg}` });
            return;
          }
          if (mode === "overview") {
            const parsed = parseOverviewReply(raw);
            if ("error" in parsed) {
              convo.push({ role: "assistant", content: raw });
              convo.push({
                role: "user",
                content: `你上一次的输出未通过校验：${parsed.error}。请重新输出完全符合要求的纯 JSON，不要任何其他文字。`,
              });
              send({ type: "status", text: `校验失败：${parsed.error}` });
            } else {
              reply = parsed.reply;
              overviewSegments = parsed.overview;
              ok = true;
            }
          } else {
            const parsed = parseCoplanReply(raw);
            if ("error" in parsed) {
              convo.push({ role: "assistant", content: raw });
              convo.push({
                role: "user",
                content: `你上一次的输出未通过校验：${parsed.error}。请重新输出完全符合要求的纯 JSON，不要任何其他文字。`,
              });
              send({ type: "status", text: `校验失败：${parsed.error}` });
            } else {
              reply = parsed.reply;
              day = parsed.day;
              ok = true;
            }
          }
        }
        if (!ok) {
          send({ type: "error", message: "多次尝试后仍无法得到合法输出，建议更换能力更强的模型后重试" });
          return;
        }

        // 提议坐标落地（仅 day 模式）
        if (day) {
          const webKey = (settings["amap.webKey"] || "").trim();
          if (webKey) {
            send({ type: "status", text: "正在匹配地点坐标…" });
            await matchPlanCoords({ days: [day] }, webKey, destination, undefined, undefined, clientAbort.signal);
          }
        }

        send({
          type: "result",
          reply,
          proposal: day ? { dayIndex: focusDay, theme: day.theme, items: day.items } : null,
          overview: mode === "overview" ? overviewSegments : undefined,
        });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        clearInterval(heartbeat);
        request.signal.removeEventListener("abort", onClientDisconnect);
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
