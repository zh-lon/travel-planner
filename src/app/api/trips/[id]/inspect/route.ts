// 出发前行程体检：规则检查 + 天气 + AI 审查，SSE 流式返回
import { NextResponse } from "next/server";
import dayjs from "dayjs";
import { prisma } from "@/lib/db";
import { requireUser, tripAccess } from "@/lib/session";
import { dayCountOf } from "@/lib/trips";
import { getSettings } from "@/lib/settings";
import { fetchDailyWeather } from "@/lib/weather";
import { aiConfigFromSettings } from "@/lib/ai/generate";
import { chatStream } from "@/lib/ai/client";
import {
  buildInspectPrompt,
  parseAiFindings,
  runRuleChecks,
  runWeatherChecks,
  type InspectFinding,
} from "@/lib/ai/inspect";
import type { ItineraryItemT } from "@/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const access = await tripAccess(id, user);
  if (!access) return NextResponse.json({ error: "行程不存在或无权访问" }, { status: 404 });
  const trip = access.trip;

  const rawItems = await prisma.itineraryItem.findMany({
    where: { tripId: id },
    orderBy: [{ dayIndex: "asc" }, { sortOrder: "asc" }],
  });
  const items = rawItems as unknown as ItineraryItemT[];
  const dayCount = dayCountOf(trip.startDate, trip.endDate);
  // 用本地时区取日期（toISOString 是 UTC，会差一天）
  const startDate = dayjs(trip.startDate).format("YYYY-MM-DD");

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
        const notes: string[] = [];
        if (items.length === 0) {
          send({ type: "result", findings: [], notes: ["行程还没有任何行程项，先安排几项再来体检"] });
          return;
        }

        // 1. 规则检查（即时）
        send({ type: "status", text: "正在进行规则检查…" });
        const findings: InspectFinding[] = runRuleChecks(items, dayCount);
        send({ type: "findings", findings });

        // 2. 天气检查（仅覆盖未来 7 天）
        send({ type: "status", text: "正在检查天气风险…" });
        const wx = await fetchDailyWeather(trip.destination);
        if (wx.ok) {
          const wxFindings = runWeatherChecks(items, startDate, dayCount, wx.daily);
          findings.push(...wxFindings);
          if (wxFindings.length) send({ type: "findings", findings: wxFindings });
          const lastDate = wx.daily[wx.daily.length - 1]?.date;
          if (lastDate && startDate > lastDate) {
            notes.push("行程日期超出 7 天预报范围，天气检查暂不可用，建议出发前一周再体检一次");
          }
        } else if (wx.disabled) {
          notes.push("未配置和风天气，已跳过天气检查");
        } else {
          notes.push(`天气查询失败（${wx.error ?? "未知错误"}），已跳过天气检查`);
        }

        // 3. AI 审查（开放时间/闭馆/节奏），未配置则跳过
        const settings = await getSettings();
        const config = aiConfigFromSettings(settings);
        if (config) {
          send({ type: "status", text: "AI 正在审查开放时间与节奏…" });
          try {
            const raw = await chatStream(
              config,
              buildInspectPrompt(trip.destination, startDate, dayCount, items),
              (delta) => send({ type: "delta", text: delta }),
              config.maxTokens,
            );
            const aiFindings = parseAiFindings(raw, items);
            if (aiFindings) {
              findings.push(...aiFindings);
              if (aiFindings.length) send({ type: "findings", findings: aiFindings });
            } else {
              notes.push("AI 审查输出无法解析，本次仅包含规则检查结果");
            }
          } catch (err) {
            notes.push(
              `AI 审查失败（${err instanceof Error ? err.message : String(err)}），本次仅包含规则检查结果`,
            );
          }
        } else {
          notes.push("尚未配置 AI 服务，已跳过开放时间与节奏审查");
        }

        send({ type: "result", findings, notes });
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
