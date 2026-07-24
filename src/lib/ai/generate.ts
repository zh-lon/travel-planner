import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import { geocodeFirst } from "@/lib/geo";
import { getSettings, type SettingsMap } from "@/lib/settings";
import { chatStream, type AiConfig, type AiProtocol, type ChatMessage } from "./client";
import { parsePlan } from "./schema";
import type { AiPlan, ItineraryItemT, TripDetail } from "@/types";

dayjs.locale("zh-cn");

export function aiConfigFromSettings(settings: SettingsMap): AiConfig | null {
  const config: AiConfig = {
    protocol: (settings["ai.protocol"] || "openai") as AiProtocol,
    baseUrl: (settings["ai.baseUrl"] || "").trim(),
    apiKey: (settings["ai.apiKey"] || "").trim(),
    model: (settings["ai.model"] || "").trim(),
  };
  if (!config.baseUrl || !config.apiKey || !config.model) return null;
  return config;
}

const JSON_CONTRACT = `你只输出一个 JSON 对象，不要任何解释文字，不要 Markdown 代码块。JSON 结构如下：
{"days":[{"theme":"当天主题","items":[{"type":"SIGHT|TRANSPORT|HOTEL|FOOD|SHOPPING|OTHER","title":"标题","startTime":"09:00","endTime":"11:00","placeName":"可在高德地图搜到的准确地点名，无固定地点则填空字符串","estimatedCost":100,"notes":"一句推荐理由或实用提示"}]}]}
硬性要求：
1. days 数组长度必须严格等于行程天数，顺序即第 1..N 天；
2. 每天安排 4~7 个行程项：含重点餐饮、景点游览；首日含抵达交通与入住，末日含返程；
3. 同一天内时间从早到晚、互不重叠；相邻行程项地理位置尽量就近，动线合理；
4. placeName 用规范 POI 名称（如「宽窄巷子」「成都大熊猫繁育研究基地」），交通/自由活动等留空字符串；
5. estimatedCost 为人均预估费用（元，可为 0）；全部使用中文。`;

export interface GenerateParams {
  destination: string;
  startDate: string; // YYYY-MM-DD
  days: number;
  people?: number;
  budgetLevel?: string;
  preferences?: string[];
  mustVisit?: string[];
  extra?: string;
}

export function buildCreatePrompt(p: GenerateParams): ChatMessage[] {
  const start = dayjs(p.startDate);
  const dateDesc = `${start.format("YYYY年M月D日 dddd")}出发，共 ${p.days} 天（${start.format(
    "M月D日",
  )} 至 ${start.add(p.days - 1, "day").format("M月D日")}）`;
  const lines = [
    `请为我规划一份国内旅行行程：`,
    `- 目的地：${p.destination}`,
    `- 日期：${dateDesc}`,
    `- 人数：${p.people ?? 2} 人`,
    `- 预算档位：${p.budgetLevel ?? "舒适"}`,
  ];
  if (p.preferences?.length) lines.push(`- 偏好：${p.preferences.join("、")}`);
  if (p.mustVisit?.length) lines.push(`- 必去地点：${p.mustVisit.join("、")}`);
  if (p.extra?.trim()) lines.push(`- 补充要求：${p.extra.trim()}`);
  return [
    { role: "system", content: `你是资深的国内旅行规划师。${JSON_CONTRACT}` },
    { role: "user", content: lines.join("\n") },
  ];
}

export interface GuideParams {
  content: string;
  destination: string;
  startDate: string; // YYYY-MM-DD
  days?: number; // 不填由 AI 根据攻略判断
}

export function buildGuidePrompt(p: GuideParams): ChatMessage[] {
  const start = dayjs(p.startDate);
  const daysReq = p.days
    ? `行程天数：${p.days} 天（days 数组长度必须严格等于 ${p.days}）`
    : "行程天数：请根据攻略内容合理判断（通常 1~7 天），days 数组长度等于你判断的天数";
  return [
    {
      role: "system",
      content: `你是资深的旅行行程整理师。用户会提供一段旅行攻略文本（可能来自小红书等社交平台，含表情符号、话题标签、口语化表达）。你的任务是把攻略内容提取并整理成按天的结构化行程。${JSON_CONTRACT}
针对攻略提取的额外要求：
1. 尽量保留攻略中出现的具体店名、景点名（写入 title 与 placeName）；
2. 攻略未给出的时间与费用请按常识合理推断；
3. 攻略未按天划分时，按地理动线与游玩节奏合理分天；
4. 忽略攻略中的广告、抽奖、关注引导、无关话题标签等内容；
5. 攻略中的实用提示（如需预约、几点去人少）写入对应行程项的 notes。`,
    },
    {
      role: "user",
      content: `目的地：${p.destination}\n出发日期：${start.format("YYYY年M月D日 dddd")}\n${daysReq}\n\n攻略原文：\n${p.content}`,
    },
  ];
}

export function buildAdjustPrompt(trip: TripDetail, items: ItineraryItemT[], instruction: string): ChatMessage[] {  const dayCount = dayjs(trip.endDate).diff(dayjs(trip.startDate), "day") + 1;
  const current = {
    days: Array.from({ length: dayCount }, (_, d) => ({
      items: items
        .filter((i) => i.dayIndex === d)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((i) => ({
          type: i.type,
          title: i.title,
          startTime: i.startTime ?? "",
          endTime: i.endTime ?? "",
          placeName: i.placeName ?? "",
          estimatedCost: i.estimatedCost ?? 0,
          notes: i.notes ?? "",
        })),
    })),
  };
  return [
    {
      role: "system",
      content: `你是资深的国内旅行规划师。你将收到一份现有行程和调整要求，请输出调整后的完整行程——必须完整输出所有天的所有行程项（未被要求改动的内容原样保留），不要只输出改动部分。若调整要求明确要求增加或减少天数（如「多加一天」「压缩成两天」），days 数组长度按要求变化；否则 days 数组长度必须与现有行程天数保持一致。${JSON_CONTRACT}`,
    },
    {
      role: "user",
      content: `目的地：${trip.destination}；行程 ${dayCount} 天，${dayjs(trip.startDate).format(
        "YYYY年M月D日",
      )}出发。\n\n现有行程 JSON：\n${JSON.stringify(current)}\n\n调整要求：${instruction.trim()}`,
    },
  ];
}

// SSE 事件：status（进度提示）/ delta（流式文本）/ result（最终方案）/ error
export function planStreamResponse(
  build: (settings: SettingsMap) => Promise<{ messages: ChatMessage[]; expectedDays: number; city: string }>,
): Response {
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
        const settings = await getSettings();
        const config = aiConfigFromSettings(settings);
        if (!config) {
          send({ type: "error", message: "尚未配置 AI 服务，请先到设置页填写服务地址、API Key 和模型名" });
          return;
        }
        const { messages, expectedDays, city } = await build(settings);
        const convo: ChatMessage[] = [...messages];
        let plan: AiPlan | null = null;
        const MAX_ATTEMPTS = 3;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS && !plan; attempt++) {
          send({
            type: "status",
            text: attempt === 1 ? "正在生成行程…" : `输出校验未通过，正在重试（第 ${attempt - 1} 次）…`,
          });
          let raw = "";
          try {
            raw = await chatStream(config, convo, (delta) => send({ type: "delta", text: delta }));
          } catch (err) {
            const msg =
              err instanceof Error
                ? err.name === "AbortError"
                  ? "AI 调用超时（5 分钟）"
                  : err.message
                : String(err);
            send({ type: "error", message: `AI 调用失败：${msg}` });
            return;
          }
          const result = parsePlan(raw, expectedDays, attempt === MAX_ATTEMPTS);
          if ("plan" in result) {
            plan = result.plan;
          } else {
            convo.push({ role: "assistant", content: raw });
            convo.push({
              role: "user",
              content: `你上一次的输出未通过校验：${result.error}。请重新输出完全符合要求的纯 JSON，不要任何其他文字。`,
            });
            send({ type: "status", text: `校验失败：${result.error}` });
          }
        }

        if (!plan) {
          send({ type: "error", message: "多次尝试后仍无法得到合法的行程 JSON，建议更换能力更强的模型后重试" });
          return;
        }

        // 坐标落地：批量用高德 POI 搜索匹配（同名去重，串行控制 QPS）
        const webKey = (settings["amap.webKey"] || "").trim();
        if (webKey) {
          send({ type: "status", text: "正在匹配地点坐标…" });
          const cache = new Map<string, Awaited<ReturnType<typeof geocodeFirst>>>();
          for (const day of plan.days) {
            for (const item of day.items) {
              const name = item.placeName?.trim();
              if (!name) continue;
              if (!cache.has(name)) {
                cache.set(name, await geocodeFirst(webKey, name, city));
              }
              const poi = cache.get(name) ?? null;
              if (poi) {
                item.lng = poi.lng;
                item.lat = poi.lat;
                item.address = poi.address ?? poi.district ?? null;
              }
            }
          }
        } else {
          send({ type: "status", text: "未配置高德 Web 服务 Key，已跳过坐标匹配" });
        }

        send({ type: "result", plan });
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
