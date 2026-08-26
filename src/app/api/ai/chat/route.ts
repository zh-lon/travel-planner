import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { chat, chatStream, type AiConfig, type ChatMessage } from "@/lib/ai/client";
import {
  aiConfigFromSettings,
  buildAdjustFocusPrompt,
  buildAdjustPrompt,
  buildChatPrompt,
  buildConfirmPrompt,
  mergeFocusPlan,
  mergePartialPlan,
  parseConfirmResult,
  runPlanGeneration,
  sendStep,
  type SseSend,
} from "@/lib/ai/generate";
import { detectFocusDays, isMoveDayInstruction } from "@/lib/ai/diff";
import { getWorkflow, newWorkflowId, setWorkflow, type WorkflowState } from "@/lib/ai/workflow";
import { requireTripEditByChild, requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { webSearch } from "@/lib/websearch";
import type { ItineraryItemT, TripDetail } from "@/types";

export const dynamic = "force-dynamic";

// 轻量意图识别：判断用户这条消息是想「调整行程」还是「普通对话」
// 识别失败（超时/服务异常）时抛出异常，由调用方终止工作流
async function detectAdjustIntent(
  config: AiConfig,
  trip: TripDetail,
  items: ItineraryItemT[],
  message: string,
): Promise<boolean> {
  const outline = items
    .map((i) => `第${(i.dayIndex ?? 0) + 1}天 ${i.title}`)
    .join("；")
    .slice(0, 500);
  const raw = await chat(
    config,
    [
      {
        role: "system",
        content:
          "你是意图分类器。判断用户最新消息是否要求修改/调整/增删一份已有的旅行行程安排（包括增删天数、更换景点餐厅、调整顺序节奏等）。只输出 ADJUST 或 CHAT，不要其他任何文字：要求改动行程输出 ADJUST；提问、咨询、闲聊、请他人帮忙评估合理性等不直接改动行程的输出 CHAT。",
      },
      {
        role: "user",
        content: `当前行程：目的地「${trip.destination}」；现有安排：${outline || "（暂无行程项）"}\n\n用户消息：${message}`,
      },
    ],
    8,
    30000,
  );
  return /ADJUST/i.test(raw);
}

export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const body = (await request.json().catch(() => null)) as {
    tripId?: unknown;
    message?: unknown;
    history?: unknown;
    webSearch?: unknown;
    workflowId?: unknown;
    resumeFrom?: unknown;
    confirmAnswer?: unknown;
    focusDays?: unknown;
  } | null;
  const tripId = typeof body?.tripId === "string" ? body.tripId : "";
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const useWebSearch = !!body?.webSearch;
  const history: ChatMessage[] = Array.isArray(body?.history)
    ? (body!.history as Array<{ role?: unknown; content?: unknown }>)
        .filter(
          (m) =>
            (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string",
        )
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content as string }))
        .slice(-20)
    : [];
  if (!tripId) return NextResponse.json({ error: "缺少行程 ID" }, { status: 400 });
  if (!message) return NextResponse.json({ error: "请输入消息" }, { status: 400 });
  const denied = await requireTripEditByChild(user, tripId);
  if (denied) return denied;
  const confirmAnswer = typeof body?.confirmAnswer === "string" ? body.confirmAnswer.trim() : "";
  const bodyFocusDays = Array.isArray(body?.focusDays)
    ? (body!.focusDays as unknown[]).filter((d) => typeof d === "number" && (d as number) >= 0) as number[]
    : undefined;

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

  // 工作流式编排：逐步执行并通过 step 事件推送进度
  // 调整分支：理解问题 →（联网搜索）→ 生成方案 → 坐标落地 → 完成
  // 对话分支：理解问题 →（联网搜索）→ AI 回答 → 完成
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // 客户端断开时中止所有 AI 调用（双重保障：request.signal + heartbeat 兜底）
      const clientAbort = new AbortController();
      const onClientDisconnect = () => clientAbort.abort();
      request.signal.addEventListener("abort", onClientDisconnect, { once: true });
      const send: SseSend = (obj) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          // 客户端已断开，通知所有进行中的 AI 调用中止
          clientAbort.abort();
        }
      };
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

        // 续跑支持：加载工作流中间状态缓存；条件不满足时自动回退为整体重跑
        const reqWorkflowId = typeof body!.workflowId === "string" ? body!.workflowId : "";
        const resumeFrom = typeof body!.resumeFrom === "string" ? body!.resumeFrom : "";
        const cached = reqWorkflowId ? getWorkflow(reqWorkflowId) : null;
        let from: "intent" | "search" | "generate" | "coords" | "reply" | null = null;
        if (cached) {
          if (resumeFrom === "intent") from = "intent";
          else if (resumeFrom === "search") from = cached.isAdjust !== undefined ? "search" : null;
          else if (resumeFrom === "generate") from = cached.isAdjust === true && cached.messages ? "generate" : null;
          else if (resumeFrom === "coords") {
            from = cached.isAdjust === true && cached.generatedPlan ? "coords" : null;
          } else if (resumeFrom === "reply") from = cached.isAdjust === false ? "reply" : null;
        }
        const workflowId = from ? reqWorkflowId : newWorkflowId();
        const state: WorkflowState = from ? cached! : { createdAt: Date.now() };
        setWorkflow(workflowId, state);
        send({ type: "workflow", id: workflowId });

        // 步骤 1：理解问题（意图识别；失败即终止工作流；续跑时复用缓存结果）
        let isAdjust: boolean;
        if (from && from !== "intent") {
          isAdjust = state.isAdjust!;
        } else {
          sendStep(send, "intent", "理解你的问题", "start");
          try {
            isAdjust = await detectAdjustIntent(config, tripDetail, items, message);
          } catch (err) {
            const msg =
              err instanceof Error
                ? err.name === "AbortError"
                  ? "调用超时"
                  : err.message
                : String(err);
            sendStep(send, "intent", "理解你的问题", "error", msg);
            send({ type: "error", message: `意图识别失败：${msg}` });
            return;
          }
          state.isAdjust = isAdjust;
          sendStep(send, "intent", "理解你的问题", "done", isAdjust ? "识别为行程调整请求" : "识别为普通问答");
        }

        // 步骤 2：联网搜索（可选；续跑自 search 之后的步骤时复用缓存结果）
        let searchContext: string | undefined = state.searchContext;
        if (useWebSearch && (!from || from === "intent" || from === "search")) {
          const searchProvider = (settings["search.provider"] ?? "tavily").trim();
          const searchApiKey = (settings["search.apiKey"] ?? "").trim();
          if (!searchApiKey) {
            sendStep(send, "search", "联网搜索", "done", "未配置搜索 API Key，已跳过");
          } else {
            sendStep(send, "search", "联网搜索", "start");
            try {
              const results = await webSearch(searchProvider, searchApiKey, `${trip.destination} ${message}`, 8, 15000);
              if (results.length > 0) {
                searchContext = results
                  .map((r, i) => `${i + 1}. 【${r.title}】${r.content} (来源: ${r.url})`)
                  .join("\n");
                state.searchContext = searchContext;
                sendStep(send, "search", "联网搜索", "done", `获得 ${results.length} 条参考信息`);
              } else {
                sendStep(send, "search", "联网搜索", "done", "未搜索到相关信息");
              }
            } catch (err) {
              // 工作流失败即终止，不降级继续
              const msg = err instanceof Error ? err.message : "未知错误";
              sendStep(send, "search", "联网搜索", "error", msg);
              send({ type: "error", message: `联网搜索失败：${msg}` });
              return;
            }
          }
        }

        if (isAdjust) {
          // 确认步骤：指令模糊时让用户选择调整方式
          const fullInstruction = confirmAnswer
            ? `${message}（用户确认选择：${confirmAnswer}）`
            : message;
          // AI 判断的关注天（优先用 AI 结果，回退到正则）
          let focusDays: Set<number> | null = null;
          if (!confirmAnswer && (!from || from === "intent")) {
            sendStep(send, "confirm", "分析调整意图", "start");
            try {
              const confirmRaw = await chat(
                config,
                buildConfirmPrompt(tripDetail, items, message),
                200,
                30000,
              );
              const confirmResult = parseConfirmResult(confirmRaw);
              // 移动天操作需要全量输出，覆盖 AI 的 focusDays 判断
              if (isMoveDayInstruction(message)) {
                focusDays = null;
              } else {
                focusDays = confirmResult.focusDays && confirmResult.focusDays.length > 0
                  ? new Set(confirmResult.focusDays)
                  : detectFocusDays(fullInstruction, tripDetail.startDate);
              }
              // 保存 AI 意图到工作流状态（续跑/确认后重试时复用）
              state.allowedFields = confirmResult.allowedFields;
              state.stayIntent = confirmResult.stayIntent;
              if (confirmResult.need && confirmResult.questions) {
                sendStep(send, "confirm", "分析调整意图", "done", "需要用户确认");
                send({
                  type: "confirm",
                  questions: confirmResult.questions,
                  focusDays: confirmResult.focusDays,
                  allowedFields: confirmResult.allowedFields,
                  stayIntent: confirmResult.stayIntent,
                });
                return;
              }
              sendStep(send, "confirm", "分析调整意图", "done", "意图明确，无需确认");
            } catch {
              sendStep(send, "confirm", "分析调整意图", "done", "确认步骤跳过");
              focusDays = detectFocusDays(fullInstruction, tripDetail.startDate);
            }
          } else if (state.focusDays) {
            // 续跑：从工作流状态恢复
            focusDays = state.focusDays.length > 0 ? new Set(state.focusDays) : null;
          } else if (bodyFocusDays !== undefined) {
            // 前端回传的 AI focusDays（确认后重试场景）
            focusDays = bodyFocusDays.length > 0 ? new Set(bodyFocusDays) : null;
          } else {
            focusDays = detectFocusDays(fullInstruction, tripDetail.startDate);
          }
          state.focusDays = focusDays ? [...focusDays] : [];

          // 步骤 3a：生成调整方案（含校验重试与坐标落地）
          if (from === "coords") {
            sendStep(send, "generate", "生成调整方案", "done", "使用上次已生成的方案");
          } else {
            sendStep(send, "generate", "生成调整方案", "start");
          }
          let coordsStarted = false;
          // 续跑自生成之后的步骤时复用缓存的提示词；否则重新构建
          let messages: ChatMessage[];
          if (state.messages && (from === "generate" || from === "coords")) {
            messages = state.messages;
          } else {
            messages = focusDays
              ? buildAdjustFocusPrompt(tripDetail, items, fullInstruction, focusDays)
              : buildAdjustPrompt(tripDetail, items, fullInstruction);
            if (searchContext) {
              messages.push({
                role: "user",
                content: `以下是一些联网搜索到的参考信息，请结合这些数据来调整行程：\n\n${searchContext}`,
              });
            }
            state.messages = messages;
          }
          const plan = await runPlanGeneration(
            send,
            config,
            settings,
            { messages, expectedDays: focusDays?.size ?? 0, city: trip.destination },
            {
              onValidated: (p) => {
                state.generatedPlan = p;
                sendStep(send, "generate", "生成调整方案", "done", "方案已通过校验");
              },
              onCoordsStart: () => {
                coordsStarted = true;
                sendStep(send, "coords", "匹配地点坐标", "start");
              },
            },
            from === "coords"
              ? { from: "coords", plan: state.generatedPlan! }
              : undefined,
            clientAbort.signal,
          );
          if (!plan) {
            // runPlanGeneration 已推送 error 事件；按实际失败环节标记步骤
            if (coordsStarted) sendStep(send, "coords", "匹配地点坐标", "error");
            else sendStep(send, "generate", "生成调整方案", "error");
            return;
          }
          if (coordsStarted) sendStep(send, "coords", "匹配地点坐标", "done");
          sendStep(send, "complete", "完成", "done", "调整方案已就绪，请确认后应用");
          // 安全兜底：focusDays 为 null（完整输出模式）但 AI 只输出了部分天数时，
          // 用原始行程项填充缺失的天，防止应用时丢失其他天的数据
          let finalPlan: typeof plan;
          if (focusDays) {
            finalPlan = mergeFocusPlan(plan, items, focusDays);
          } else {
            const itemsDayCount = items.length > 0
              ? Math.max(...items.map((i) => i.dayIndex + 1))
              : 0;
            finalPlan = plan.days.length < itemsDayCount
              ? mergePartialPlan(plan, items)
              : plan;
          }
          send({ type: "result", plan: finalPlan, focusDays: focusDays ? [...focusDays] : [], allowedFields: state.allowedFields, stayIntent: state.stayIntent });
          return;
        }

        // 步骤 3b：AI 流式回答
        sendStep(send, "reply", "AI 正在回答", "start");
        try {
          const reply = await chatStream(
            config,
            buildChatPrompt(tripDetail, history, message, searchContext),
            (delta) => send({ type: "delta", text: delta }),
            2048,
            undefined,
            clientAbort.signal,
          );
          sendStep(send, "reply", "AI 正在回答", "done");
          sendStep(send, "complete", "完成", "done");
          send({ type: "reply", text: reply });
        } catch (err) {
          const msg =
            err instanceof Error
              ? err.name === "AbortError"
                ? "AI 调用超时（10 分钟无响应）"
                : err.message
              : String(err);
          sendStep(send, "reply", "AI 正在回答", "error");
          send({ type: "error", message: `AI 调用失败：${msg}` });
        }
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
