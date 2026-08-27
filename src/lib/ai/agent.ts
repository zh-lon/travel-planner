// Agent 核心：工具定义、Agent 循环、系统提示词
// 负责编排 LLM 工具调用循环，供 /api/ai/agent 端点使用

import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import { chatWithToolsStream, type AiConfig, type ChatMessage, type ChatWithToolsResult, type ToolCall, type ToolDef } from "./client";
import { webSearch } from "@/lib/websearch";
import { searchPois } from "@/lib/geo";
import { fetchDailyWeather } from "@/lib/weather";
import { buildAdjustPrompt, buildAdjustFocusPrompt, mergeFocusPlan, mergePartialPlan, runPlanGeneration, sendStep, type SseSend } from "./generate";
import { detectFocusDays } from "./diff";
import { createTripSnapshot } from "@/lib/snapshot";
import type { ItineraryItemT, TripDetail, AiPlan } from "@/types";

dayjs.locale("zh-cn");

// ─── 工具定义 ────────────────────────────────────────────────────────────────

export const AGENT_TOOLS: ToolDef[] = [
  {
    name: "search_web",
    description: "搜索互联网获取旅行相关信息（攻略、美食推荐、交通方式、景点介绍、住宿建议等）。用于获取最新的旅行资讯和攻略。",
    parameters: {
      query: { type: "string", description: "搜索关键词，用中文表述" },
      count: { type: "number", description: "返回结果数量，默认 4，最多 8" },
    },
    required: ["query"],
  },
  {
    name: "search_pois",
    description: "在高德地图上搜索 POI 地点（景点、餐厅、酒店、商场等），获取名称、地址、坐标信息。用于查找具体地点的位置和详细信息。",
    parameters: {
      keywords: { type: "string", description: "搜索关键词，如'火锅'、'博物馆'、'五星级酒店'" },
      city: { type: "string", description: "城市名，如'大理'。不填则在全国范围搜索" },
    },
    required: ["keywords"],
  },
  {
    name: "get_weather",
    description: "获取城市未来 7 天天气预报（天气状况、最高/最低温度）。用于判断出行当天的天气情况，给出穿衣建议或行程调整建议。",
    parameters: {
      city: { type: "string", description: "城市名，如'丽江'、'成都'" },
    },
    required: ["city"],
  },
  {
    name: "get_itinerary",
    description: "获取当前行程的完整安排，包括每天的具体行程项（标题、时间、地点、类型、费用等）。在修改行程前应先调用此工具了解现有安排。",
    parameters: {},
    required: [],
  },
  {
    name: "propose_plan",
    description: "当你收集了足够的信息，决定为用户生成或调整行程方案时调用。你需要提供详细的调整指令，系统会自动生成方案、匹配坐标并展示给用户确认。调用后等待用户确认即可，不要重复调用。",
    parameters: {
      instruction: { type: "string", description: "详细描述需要如何调整行程：要改哪些天、新增/删除/修改什么内容、具体要求等。要具体明确。" },
      focus_days: { type: "array", items: { type: "number" }, description: "只调整哪些天（0-based 索引，如 [0,1] 表示第1和第2天）。空数组或不传表示调整所有天" },
    },
    required: ["instruction"],
  },
];

// ─── 工具执行上下文 ──────────────────────────────────────────────────────────

export interface AgentContext {
  trip: TripDetail;
  items: ItineraryItemT[];
  config: AiConfig;
  settings: Record<string, string>;
  onToolCall?: (toolName: string, args: Record<string, unknown>) => void;
  onToolResult?: (toolName: string, summary: string) => void;
  send: SseSend;
}

// ─── 工具执行函数 ────────────────────────────────────────────────────────────

async function executeSearchWeb(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<string> {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) return "错误：缺少搜索关键词";
  const count = typeof args.count === "number" && args.count > 0 && args.count <= 8
    ? args.count
    : 4;
  const searchProvider = (ctx.settings["search.provider"] ?? "tavily").trim();
  const searchApiKey = (ctx.settings["search.apiKey"] ?? "").trim();
  if (!searchApiKey) return "错误：未配置搜索 API Key，请先在设置中配置";
  try {
    const results = await webSearch(searchProvider, searchApiKey, query, count, 15000);
    if (results.length === 0) return "未搜索到相关结果";
    return results
      .map((r, i) => `${i + 1}. 【${r.title}】${r.content}（来源：${r.url}）`)
      .join("\n\n");
  } catch (err) {
    return `搜索失败：${err instanceof Error ? err.message : String(err)}`;
  }
}

async function executeSearchPois(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<string> {
  const keywords = typeof args.keywords === "string" ? args.keywords.trim() : "";
  if (!keywords) return "错误：缺少搜索关键词";
  const city = typeof args.city === "string" ? args.city.trim() : undefined;
  const webKey = (ctx.settings["amap.webKey"] || "").trim();
  if (!webKey) return "错误：未配置高德地图 Web 服务 Key，请先在设置中配置";
  try {
    const pois = await searchPois(webKey, keywords, city, 8);
    if (pois.length === 0) return `未在${city ? `「${city}」` : "全国"}找到与「${keywords}」相关的 POI`;
    return pois
      .map((p, i) => {
        const parts = [`${i + 1}. ${p.name}`];
        if (p.address) parts.push(`地址：${p.address}`);
        parts.push(`坐标：${p.lng.toFixed(4)}, ${p.lat.toFixed(4)}`);
        return parts.join("\n");
      })
      .join("\n\n");
  } catch (err) {
    return `POI 搜索失败：${err instanceof Error ? err.message : String(err)}`;
  }
}

async function executeGetWeather(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<string> {
  const city = typeof args.city === "string" ? args.city.trim() : "";
  if (!city) return "错误：缺少城市名";
  const result = await fetchDailyWeather(city, ctx.settings);
  if (!result.ok) {
    if (result.disabled) return "错误：未配置和风天气服务，请先在设置中配置";
    return `天气查询失败：${result.error ?? "未知错误"}`;
  }
  return result.daily
    .map((d) => `${d.date}：${d.text}，${d.tempMin}°C ~ ${d.tempMax}°C`)
    .join("\n");
}

async function executeGetItinerary(
  _args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<string> {
  const { trip, items } = ctx;
  const dayCount = dayjs(trip.endDate).diff(dayjs(trip.startDate), "day") + 1;
  const lines: string[] = [
    `目的地：${trip.destination}`,
    `日期：${dayjs(trip.startDate).format("YYYY年M月D日")} 至 ${dayjs(trip.endDate).format("YYYY年M月D日")}，共 ${dayCount} 天`,
    "",
  ];
  for (let d = 0; d < dayCount; d++) {
    const date = dayjs(trip.startDate).add(d, "day").format("M月D日");
    const dayItems = items
      .filter((i) => i.dayIndex === d)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    lines.push(`第${d + 1}天（${date}）：`);
    if (dayItems.length === 0) {
      lines.push("  （暂无安排）");
    } else {
      for (const item of dayItems) {
        const time = item.startTime ? `${item.startTime}${item.endTime ? `-${item.endTime}` : ""}` : "";
        const place = item.placeName ? ` @ ${item.placeName}` : "";
        const cost = item.estimatedCost ? ` ¥${item.estimatedCost}` : "";
        lines.push(`  ${time} ${item.title}${place} [${item.type}]${cost}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ─── 工具调度 ────────────────────────────────────────────────────────────────

export async function executeTool(
  toolCall: ToolCall,
  ctx: AgentContext,
  signal?: AbortSignal,
): Promise<string> {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(toolCall.arguments);
  } catch {
    return "错误：工具参数 JSON 解析失败";
  }
  ctx.onToolCall?.(toolCall.name, args);

  let result: string;
  switch (toolCall.name) {
    case "search_web":
      result = await executeSearchWeb(args, ctx);
      break;
    case "search_pois":
      result = await executeSearchPois(args, ctx);
      break;
    case "get_weather":
      result = await executeGetWeather(args, ctx);
      break;
    case "get_itinerary":
      result = await executeGetItinerary(args, ctx);
      break;
    default:
      result = `错误：未知工具 ${toolCall.name}`;
  }

  const summary = result.length > 200 ? `${result.slice(0, 200)}…` : result;
  ctx.onToolResult?.(toolCall.name, summary);
  return result;
}

// ─── Agent 循环 ──────────────────────────────────────────────────────────────

export interface AgentCallbacks {
  onToolCall?: (toolName: string, args: Record<string, unknown>) => void;
  onToolResult?: (toolName: string, summary: string) => void;
  onThinking?: (text: string) => void;
  onDelta?: (text: string) => void;
  onStatus?: (text: string) => void;
  // Agent 状态变更时回调，用于路由层缓存到 workflow（支持断点续跑）
  onStateChange?: (messages: ChatMessage[], iteration: number) => void;
}

export interface AgentResult {
  type: "reply" | "plan";
  text?: string;
  plan?: AiPlan;
  focusDays?: number[];
  instruction?: string;
}

const MAX_AGENT_ITERATIONS = 8;
const MAX_AI_RETRIES = 3;
const RETRY_DELAY_MS = 3000;

// 带自动重试的 chatWithToolsStream 包装：使用流式调用避免中间代理 504 超时
// 仅对临时性错误（网络/服务端 5xx）重试，AbortError 和 4xx 错误不重试
async function chatWithRetry(
  config: AiConfig,
  messages: ChatMessage[],
  tools: ToolDef[],
  maxTokens: number,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  onStatus: ((text: string) => void) | undefined,
  onDelta: ((text: string) => void) | undefined,
): Promise<ChatWithToolsResult> {
  for (let attempt = 0; attempt <= MAX_AI_RETRIES; attempt++) {
    try {
      return await chatWithToolsStream(config, messages, tools, maxTokens, timeoutMs, signal, onDelta);
    } catch (err) {
      // 客户端已断开，不重试
      if (signal?.aborted || (err instanceof Error && err.name === "AbortError")) throw err;
      // 4xx 错误（参数/认证问题）不重试
      if (err instanceof Error && /HTTP 4\d{2}/.test(err.message)) throw err;
      if (attempt === MAX_AI_RETRIES) throw err;
      const delay = RETRY_DELAY_MS * (attempt + 1); // 递增延迟：3s, 6s, 9s
      onStatus?.(`AI 调用失败，${delay / 1000}秒后重试（${attempt + 1}/${MAX_AI_RETRIES}）…`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("unreachable");
}

// 构建 Agent 系统提示词
function buildAgentSystemPrompt(ctx: AgentContext): string {
  const { trip, items } = ctx;
  const dayCount = dayjs(trip.endDate).diff(dayjs(trip.startDate), "day") + 1;
  const dateRange = `${dayjs(trip.startDate).format("YYYY年M月D日")} 至 ${dayjs(trip.endDate).format("YYYY年M月D日")}`;
  const itemCount = items.length;
  const hasItems = itemCount > 0;

  return `你是一个专业的旅行规划 Agent，名叫"旅行助手"。你正在帮助用户规划一趟旅行：目的地「${trip.destination}」，${dayCount} 天（${dateRange}），当前已有 ${itemCount} 个行程项。

⚠️ 核心规则（必须遵守）：
1. **行程修改必须用 propose_plan**：任何行程内容的修改、完善、新增，都必须通过调用 propose_plan 工具完成。绝对不要在文字回复中生成行程表格或行程内容！
2. **propose_plan 是唯一出口**：你收集信息后，将所有需求整理成一段详细的 instruction，调用 propose_plan 即可。系统会自动生成方案、匹配坐标并展示给用户确认。
3. **先了解再行动**：修改行程前先调用 get_itinerary。用户已给出详细地点/美食时，信任用户提供的信息，无需逐个搜索验证。
4. **搜索克制**：每次对话最多调用 3 次 search_pois/search_web。只搜索用户没提供具体信息的关键地点。
5. **快速决策**：收集足够信息后（1-2 轮工具调用），立即调用 propose_plan，不要拖延。
6. **文字回复仅用于闲聊**：只有用户纯闲聊、问候或询问非行程修改问题时，才用文字回复。
7. **中文交流**，语气亲切自然。
${hasItems ? `\n当前行程概要（详细内容请用 get_itinerary 工具获取）：\n${items.slice(0, 20).map((i) => `第${(i.dayIndex ?? 0) + 1}天 ${i.startTime ?? ""} ${i.title}${i.placeName ? ` @ ${i.placeName}` : ""}`).join("\n")}${items.length > 20 ? `\n... 共 ${items.length} 项` : ""}` : ""}`;
}

export async function runAgent(
  ctx: AgentContext,
  message: string,
  history: ChatMessage[],
  callbacks: AgentCallbacks = {},
  signal?: AbortSignal,
  resume?: { messages: ChatMessage[]; iteration: number },
): Promise<AgentResult> {
  let messages: ChatMessage[];
  let startIter: number;

  if (resume) {
    // 从缓存状态续跑
    messages = resume.messages;
    startIter = resume.iteration;
    callbacks.onStatus?.("从上次中断处继续…");
  } else {
    messages = [
      { role: "system", content: buildAgentSystemPrompt(ctx) },
      ...history.slice(-12),
      { role: "user", content: message },
    ];
    startIter = 0;
  }

  for (let iter = startIter; iter < MAX_AGENT_ITERATIONS; iter++) {
    // 客户端已断开，立即终止
    if (signal?.aborted) throw new DOMException("客户端已断开", "AbortError");

    const result = await chatWithRetry(ctx.config, messages, AGENT_TOOLS, 16384, 120000, signal, callbacks.onStatus, callbacks.onDelta);

    // 传递思考过程（reasoning_content）给上层
    if (result.reasoningContent) {
      callbacks.onThinking?.(result.reasoningContent);
    }

    // AI 返回了文本回复（无工具调用）
    if (result.text && result.toolCalls.length === 0) {
      // 首轮若无工具调用，直接使用用户消息作为指令触发 propose_plan
      // 避免模型跳过工具调用直接闲聊
      if (iter === 0 && message) {
        callbacks.onStatus?.("正在生成行程方案…");
        return {
          type: "plan",
          instruction: message,
          focusDays: undefined,
        };
      }
      return { type: "reply", text: result.text };
    }

    // AI 调用了 propose_plan（触发方案生成，由路由层处理）
    const proposePlanCall = result.toolCalls.find((tc) => tc.name === "propose_plan");
    if (proposePlanCall) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(proposePlanCall.arguments); } catch { /* ignore */ }
      const instruction = typeof args.instruction === "string" ? args.instruction : message;
      const focusDays = Array.isArray(args.focus_days)
        ? args.focus_days.filter((d: unknown) => typeof d === "number") as number[]
        : undefined;
      ctx.onToolCall?.("propose_plan", args);
      return {
        type: "plan",
        instruction,
        focusDays,
      };
    }

    // AI 调用了其他工具
    if (result.toolCalls.length > 0) {
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: result.text ?? "",
        tool_calls: result.toolCalls,
      };
      messages.push(assistantMsg);

      // 限制每轮最多执行 3 个搜索类工具，防止模型过度搜索
      let searchCount = 0;
      const MAX_SEARCH_PER_ROUND = 3;
      for (const tc of result.toolCalls) {
        if (tc.name === "search_pois" || tc.name === "search_web") {
          searchCount++;
          if (searchCount > MAX_SEARCH_PER_ROUND) {
            messages.push({
              role: "tool",
              content: `已跳过：每轮最多 ${MAX_SEARCH_PER_ROUND} 个搜索工具，请直接调用 propose_plan 生成方案`,
              tool_call_id: tc.id,
            });
            continue;
          }
        }
        const toolResult = await executeTool(tc, ctx, signal);
        messages.push({
          role: "tool",
          content: toolResult,
          tool_call_id: tc.id,
        });
      }
      // 如果本轮执行了搜索工具，主动提示模型调用 propose_plan
      if (searchCount > 0) {
        messages.push({
          role: "user",
          content: `⚠️ 重要指令：你已收集到足够的信息。现在必须立即调用 propose_plan 工具来生成方案。不要输出任何文字回复，不要生成行程表格。只输出 <tool_call> 块调用 propose_plan。`,
        });
      }
      // 保存当前状态到 workflow，支持断点续跑
      callbacks.onStateChange?.(messages, iter + 1);
      continue;
    }

    return { type: "reply", text: "抱歉，AI 未能生成有效的回复，请重试。" };
  }

  // 达到最大迭代次数
  const finalResult = await chatWithRetry(
    ctx.config,
    [
      ...messages,
      { role: "user", content: "请基于以上收集的信息，直接给出最终回复（不要调用工具）。" },
    ],
    [],
    2048,
    60000,
    signal,
    callbacks.onStatus,
    callbacks.onDelta,
  );
  return { type: "reply", text: finalResult.text ?? "抱歉，处理超时，请重试。" };
}

// ─── propose_plan 工具的处理（在 Agent 循环外，由路由层调用） ──────────────

export async function executeProposePlan(
  ctx: AgentContext,
  instruction: string,
  focusDays: number[] | undefined,
  resume?: { from: "coords"; plan: AiPlan },
  onPlanGenerated?: (plan: AiPlan) => void,
  signal?: AbortSignal,
): Promise<{ plan: AiPlan | null; focusDays: number[] }> {
  const { trip, items, config, settings, send } = ctx;
  const tripDetail = trip;
  if (!instruction) {
    sendStep(send, "generate", "生成调整方案", "error", "缺少调整指令");
    return { plan: null, focusDays: [] };
  }
  const fullInstruction = instruction.trim();

  let focusDaysSet: Set<number> | null = null;
  if (focusDays && focusDays.length > 0) {
    focusDaysSet = new Set(focusDays.filter((d) => d >= 0));
  }
  // Agent 模式下，如果未指定 focus_days，尝试从 instruction 中检测日期
  // 这可以大幅缩减 prompt 大小（仅发送关注天的行程项），避免 GLM 模型因 prompt 过长产生大量推理
  if (!focusDaysSet && fullInstruction) {
    const detected = detectFocusDays(fullInstruction, tripDetail.startDate);
    if (detected && detected.size > 0) {
      focusDaysSet = detected;
    }
  }
  const focusDaysArr = focusDaysSet ? [...focusDaysSet] : [];

  // Agent 修改前自动保存快照（静默，失败不影响主流程）
  try {
    const dayCount = dayjs(tripDetail.endDate).diff(dayjs(tripDetail.startDate), "day") + 1;
    await createTripSnapshot(tripDetail.id, items, dayCount);
  } catch {
    // 快照创建失败不影响主流程
  }

  sendStep(send, "generate", "生成调整方案", "start");
  const messages = focusDaysSet
    ? buildAdjustFocusPrompt(tripDetail, items, fullInstruction, focusDaysSet)
    : buildAdjustPrompt(tripDetail, items, fullInstruction);

  const plan = await runPlanGeneration(
    send,
    config,
    settings,
    { messages, expectedDays: focusDaysSet?.size ?? 0, city: trip.destination },
    {
      onValidated: (p) => {
        onPlanGenerated?.(p);
        sendStep(send, "generate", "生成调整方案", "done", "方案已通过校验");
      },
      onCoordsStart: () => {
        sendStep(send, "coords", "匹配地点坐标", "start");
      },
    },
    resume,
    signal,
  );

  if (!plan) {
    return { plan: null, focusDays: focusDaysArr };
  }

  sendStep(send, "coords", "匹配地点坐标", "done");
  sendStep(send, "complete", "完成", "done", "调整方案已就绪，请确认后应用");

  // 安全兜底：合并非关注天的数据
  let finalPlan: AiPlan;
  if (focusDaysSet) {
    finalPlan = mergeFocusPlan(plan, items, focusDaysSet);
  } else {
    const itemsDayCount = items.length > 0
      ? Math.max(...items.map((i) => i.dayIndex + 1))
      : 0;
    finalPlan = plan.days.length < itemsDayCount
      ? mergePartialPlan(plan, items)
      : plan;
  }

  return { plan: finalPlan, focusDays: focusDaysArr };
}