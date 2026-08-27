// 行程项地点攻略：GET 读缓存，POST 生成/刷新（AI，SSE 流式）
import { NextResponse } from "next/server";
import dayjs from "dayjs";
import { prisma } from "@/lib/db";
import { requireUser, tripAccess } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { aiConfigFromSettings } from "@/lib/ai/generate";
import { chatStream } from "@/lib/ai/client";
import { buildPoiGuidePrompt, parsePoiGuide } from "@/lib/ai/poiguide";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function loadItemWithAccess(request: Request, itemId: string) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const item = await prisma.itineraryItem.findUnique({
    where: { id: itemId },
    include: { trip: { select: { id: true, destination: true, startDate: true } } },
  });
  if (!item) return NextResponse.json({ error: "行程项不存在" }, { status: 404 });
  const access = await tripAccess(item.tripId, user);
  if (!access) return NextResponse.json({ error: "无权访问该行程" }, { status: 403 });
  return { item, user };
}

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const loaded = await loadItemWithAccess(request, id);
  if (loaded instanceof NextResponse) return loaded;
  const { item } = loaded;
  if (!item.guideInfo) return NextResponse.json({ ok: true, guide: null });
  try {
    return NextResponse.json({
      ok: true,
      guide: JSON.parse(item.guideInfo),
      guideAt: item.guideAt?.toISOString() ?? null,
    });
  } catch {
    return NextResponse.json({ ok: true, guide: null });
  }
}

// POST：生成（或强制刷新）攻略并缓存。读权限即可——攻略是衍生数据，不改行程内容
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const loaded = await loadItemWithAccess(request, id);
  if (loaded instanceof NextResponse) return loaded;
  const { item, user } = loaded;

  const place = (item.placeName || item.title).trim();
  if (!place) return NextResponse.json({ error: "该行程项没有地点信息" }, { status: 400 });

  const settings = await getSettings(user.id);
  const config = aiConfigFromSettings(settings);
  if (!config) {
    return NextResponse.json(
      { error: "尚未配置 AI 服务，请先到设置页填写服务地址、API Key 和模型名" },
      { status: 400 },
    );
  }

  const visitDate = dayjs(item.trip.startDate).add(item.dayIndex, "day").format("YYYY-MM-DD");

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
      // 心跳：防止首 token 前等无数据阶段被代理因空闲超时断连
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          // 客户端已断开
        }
      }, 15000);

      try {
        send({ type: "status", text: "AI 正在生成地点攻略…" });

        let raw = "";
        try {
          raw = await chatStream(
            config,
            buildPoiGuidePrompt({
              placeName: place,
              city: item.trip.destination,
              itemType: item.type,
              visitDate,
            }),
            (delta) => send({ type: "delta", text: delta }),
            2048,
            180000,
          );
        } catch (err) {
          const msg =
            err instanceof Error
              ? err.name === "AbortError"
                ? "AI 调用超时（3 分钟无响应）"
                : err.message
              : String(err);
          send({ type: "error", message: `攻略生成失败：${msg}` });
          return;
        }

        const guide = parsePoiGuide(raw);
        if (!guide) {
          send({ type: "error", message: "攻略生成失败：AI 输出无法解析，请重试" });
          return;
        }
        const guideAt = new Date();
        await prisma.itineraryItem.update({
          where: { id },
          data: { guideInfo: JSON.stringify(guide), guideAt },
        });
        send({ type: "result", guide, guideAt: guideAt.toISOString() });
      } catch (err) {
        send({
          type: "error",
          message: `攻略生成失败：${err instanceof Error ? err.message : String(err)}`,
        });
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
