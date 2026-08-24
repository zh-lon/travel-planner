// 独立方案自检：让 AI 审查现有行程的动线顺路程度与时段合理性，不合格自动微调
// SSE 流式返回：status / step / delta / result / error
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireTripEditByChild, requireUser } from "@/lib/session";
import { dayCountOf } from "@/lib/trips";
import { getSettings } from "@/lib/settings";
import { aiConfigFromSettings, selfCheckPlan, sendStep, type SseSend } from "@/lib/ai/generate";
import type { AiPlan, AiPlanItem, ItineraryItemT, TripDetail } from "@/types";

export const dynamic = "force-dynamic";

// 将数据库中的行程项转换为 AiPlan 格式供 selfCheckPlan 使用
function itemsToPlan(items: ItineraryItemT[], dayCount: number): AiPlan {
  const days = Array.from({ length: dayCount }, (_, d) => {
    const dayItems = items
      .filter((i) => i.dayIndex === d)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((i): AiPlanItem => ({
        type: i.type,
        title: i.title,
        startTime: i.startTime,
        endTime: i.endTime,
        placeName: i.placeName,
        city: null,
        estimatedCost: i.estimatedCost,
        needBooking: i.needBooking,
        notes: i.notes,
        lng: i.lng,
        lat: i.lat,
        address: i.address,
      }));
    return { theme: null, items: dayItems };
  });
  return { days };
}

export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const body = (await request.json().catch(() => null)) as { tripId?: unknown } | null;
  const tripId = typeof body?.tripId === "string" ? body.tripId : "";
  if (!tripId) return NextResponse.json({ error: "缺少行程 ID" }, { status: 400 });
  const denied = await requireTripEditByChild(user, tripId);
  if (denied) return denied;

  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: { items: { orderBy: [{ dayIndex: "asc" }, { sortOrder: "asc" }] } },
  });
  if (!trip) return NextResponse.json({ error: "行程不存在" }, { status: 404 });

  const tripDetail = {
    ...trip,
    startDate: trip.startDate.toISOString(),
    endDate: trip.endDate.toISOString(),
  } as unknown as TripDetail;
  const items = tripDetail.items as ItineraryItemT[];
  const dayCount = dayCountOf(trip.startDate, trip.endDate);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send: SseSend = (obj) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          // 客户端已断开
        }
      };
      // 心跳：防止代理因无数据而超时断连
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          // 客户端已断开
        }
      }, 15000);
      try {
        if (items.length === 0) {
          send({ type: "error", message: "行程还没有任何行程项，先安排几项再来自检" });
          return;
        }

        const settings = await getSettings();
        const config = aiConfigFromSettings(settings);
        if (!config) {
          send({ type: "error", message: "尚未配置 AI 服务，请先到设置页填写服务地址、API Key 和模型名" });
          return;
        }

        sendStep(send, "selfcheck", "方案自检", "start");
        send({ type: "status", text: "正在自检方案（顺路程度/时段合理性）…" });

        const plan = itemsToPlan(items, dayCount);
        let checked: { plan: AiPlan; summary: string };
        try {
          checked = await selfCheckPlan(config, plan, {
            expectedDays: dayCount,
            city: trip.destination,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          sendStep(send, "selfcheck", "方案自检", "error", msg);
          send({ type: "error", message: `方案自检失败：${msg}` });
          return;
        }
        sendStep(send, "selfcheck", "方案自检", "done", checked.summary);
        send({ type: "result", plan: checked.plan, summary: checked.summary });
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
