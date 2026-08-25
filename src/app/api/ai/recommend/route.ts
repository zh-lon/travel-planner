import { NextResponse } from "next/server";
import { chatStream, type ChatMessage } from "@/lib/ai/client";
import { aiConfigFromSettings } from "@/lib/ai/generate";
import { geocodeFirst } from "@/lib/geo";
import { aiVerifyGeocodeBatch } from "@/lib/ai/geo-verify";
import type { GeoVerifyItem } from "@/lib/ai/geo-verify";
import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { parseJsonLoose } from "@/lib/ai/schema";

export const dynamic = "force-dynamic";

interface RecommendItem {
  name: string;
  type: string;
  city: string | null;
  description: string;
  reason: string;
  suggestedDuration: string | null;
  ticketPrice: string | null;
  tips: string | null;
  lng: number | null;
  lat: number | null;
  address: string | null;
}

const CATEGORY_MAP: Record<string, { label: string; type: string }> = {
  sight: { label: "景点", type: "SIGHT" },
  food: { label: "餐饮", type: "FOOD" },
  hotel: { label: "住宿", type: "HOTEL" },
  shopping: { label: "购物", type: "SHOPPING" },
};

export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  const body = (await request.json().catch(() => null)) as {
    destination?: string;
    category?: string;
    keywords?: string;
  } | null;

  if (!body?.destination?.trim()) {
    return NextResponse.json({ error: "目的地不能为空" }, { status: 400 });
  }

  const destination = body.destination.trim();
  const category = body.category ?? "sight";
  const keywords = body.keywords?.trim() ?? "";
  const catInfo = CATEGORY_MAP[category] ?? CATEGORY_MAP.sight;

  const settings = await getSettings();
  const config = aiConfigFromSettings(settings);
  if (!config) {
    return NextResponse.json({ error: "未配置 AI 服务，请到设置页填写" }, { status: 400 });
  }

  const webKey = settings["amap.webKey"] ?? "";

  const kwHint = keywords ? `用户关注：${keywords}。` : "";

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `你是专业旅行顾问。根据目的地和类型，尽可能多地推荐值得去的地方，多多益善。
要求：
1. 只推荐真实存在、有代表性的地点，不要编造；
2. 优先推荐当地特色、口碑好的，尽量覆盖更多地点；
3. 如果目的地含多个城市（如"昆明、大理、丽江、香格里拉"），从各城市均衡推荐，覆盖全程；
4. city 填写该地点所在的城市名（如"昆明"、"大理"），单城市目的地也需填写；
5. description 是一句话介绍，reason 是推荐理由（为什么值得去）；
6. suggestedDuration 填建议游玩时长（如"2-3小时"），不确定填 null；
7. ticketPrice 填门票信息（如"免费"、"成人80元"），不确定填 null；
8. tips 填实用提示（如"建议早上避开人流"），不确定填 null；
9. name 用正式名称，便于在地图上搜索到。

你只输出一个 JSON 数组，不要任何解释文字，不要 Markdown 代码块。数组元素结构：
{"name":"地点名","city":"所在城市","description":"一句话介绍","reason":"推荐理由","suggestedDuration":"建议时长或null","ticketPrice":"门票或null","tips":"提示或null"}
全部使用中文。`,
    },
    {
      role: "user",
      content: `目的地：${destination}。请推荐${catInfo.label}类的地点。${kwHint}`,
    },
  ];

  try {
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
        // 心跳：防止首 token 前/地理编码等无数据阶段被代理因空闲超时断连
        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
          } catch {
            // 客户端已断开
          }
        }, 15000);

        try {
          send({ type: "status", text: "AI 正在分析推荐…" });

          let fullText = "";
          try {
            fullText = await chatStream(config, messages, (delta) => {
              send({ type: "delta", text: delta });
            }, 8192, 600000);
          } catch (err) {
            send({
              type: "error",
              message: `AI 推荐失败：${err instanceof Error ? err.message : String(err)}`,
            });
            return;
          }

          let arr: unknown;
          try {
            arr = parseJsonLoose(fullText);
          } catch (err) {
            console.error("[ai/recommend] JSON 解析失败", {
              destination,
              category,
              keywords,
              model: config.model,
              rawLength: fullText.length,
              rawPreview: fullText.slice(0, 500),
              error: err instanceof Error ? err.message : String(err),
            });
            send({ type: "error", message: "AI 返回格式异常，请重试" });
            return;
          }
          if (!Array.isArray(arr)) {
            console.error("[ai/recommend] AI 返回不是数组", {
              destination,
              category,
              keywords,
              model: config.model,
              actualType: typeof arr,
              rawPreview: fullText.slice(0, 500),
            });
            send({ type: "error", message: "AI 返回格式异常，请重试" });
            return;
          }

          const items: RecommendItem[] = [];
          for (const item of arr) {
            const obj = item as Record<string, unknown>;
            const name = typeof obj.name === "string" ? obj.name.trim() : "";
            if (!name) continue;
            items.push({
              name,
              type: catInfo.type,
              city: typeof obj.city === "string" && obj.city !== "null" ? obj.city.trim() : null,
              description: typeof obj.description === "string" ? obj.description.trim() : "",
              reason: typeof obj.reason === "string" ? obj.reason.trim() : "",
              suggestedDuration: typeof obj.suggestedDuration === "string" && obj.suggestedDuration !== "null" ? obj.suggestedDuration.trim() : null,
              ticketPrice: typeof obj.ticketPrice === "string" && obj.ticketPrice !== "null" ? obj.ticketPrice.trim() : null,
              tips: typeof obj.tips === "string" && obj.tips !== "null" ? obj.tips.trim() : null,
              lng: null,
              lat: null,
              address: null,
            });
          }

          // 并行地理编码
          if (webKey && items.length > 0) {
            send({ type: "status", text: `正在获取 ${Math.min(items.length, 20)} 个地点的坐标…` });
            const geocodeTasks = items.slice(0, 20).map(async (item) => {
              const searchCity = item.city ?? destination;
              const poi = await geocodeFirst(webKey, item.name, searchCity);
              if (poi) {
                item.lng = poi.lng;
                item.lat = poi.lat;
                item.address = poi.address ?? poi.district;
              }
            });
            await Promise.allSettled(geocodeTasks);
          }

          // AI 验证定位结果
          if (config && items.length > 0) {
            send({ type: "status", text: "AI 正在验证坐标是否准确…" });
            await aiVerifyGeocodeBatch(items as GeoVerifyItem[], destination, webKey, config);
          }

          send({ type: "result", items });
        } catch (err) {
          const msg = err instanceof Error && err.name === "AbortError"
            ? "AI 推荐超时，请重试"
            : err instanceof Error ? err.message : String(err);
          send({ type: "error", message: msg });
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
  } catch (err) {
    const msg = err instanceof Error && err.name === "AbortError"
      ? "AI 推荐超时，请重试"
      : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
