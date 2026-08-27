import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { chatStream, type ChatMessage } from "@/lib/ai/client";
import { aiConfigFromSettings, sendStep, type SseSend } from "@/lib/ai/generate";
import { runAgent, executeProposePlan, type AgentContext } from "@/lib/ai/agent";
import { getWorkflow, newWorkflowId, setWorkflow } from "@/lib/ai/workflow";
import { requireTripEditByChild, requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import type { ItineraryItemT, TripDetail } from "@/types";

export const dynamic = "force-dynamic";

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
  } | null;

  const tripId = typeof body?.tripId === "string" ? body.tripId : "";
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const history: ChatMessage[] = Array.isArray(body?.history)
    ? (body!.history as Array<{ role?: unknown; content?: unknown }>)
        .filter(
          (m) =>
            (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string",
        )
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content as string }))
        .slice(-20)
    : [];

  const reqWorkflowId = typeof body?.workflowId === "string" ? body.workflowId : "";
  const resumeFrom = typeof body?.resumeFrom === "string" ? body.resumeFrom : "";

  if (!tripId) return NextResponse.json({ error: "缺少行程 ID" }, { status: 400 });
  if (!message) return NextResponse.json({ error: "请输入消息" }, { status: 400 });

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

      let workflowId = "";
      try {
        const settings = await getSettings(user.id);
        const config = aiConfigFromSettings(settings);
        if (!config) {
          send({ type: "error", message: "尚未配置 AI 服务，请先到设置页填写服务地址、API Key 和模型名" });
          return;
        }

        const ctx: AgentContext = {
          trip: tripDetail,
          items,
          config,
          settings: settings as Record<string, string>,
          send,
          onToolCall: (toolName, args) => {
            send({
              type: "tool_call",
              tool: toolName,
              args,
            });
          },
          onToolResult: (toolName, summary) => {
            send({
              type: "tool_result",
              tool: toolName,
              summary,
            });
          },
        };

        // Agent 续跑支持：创建/恢复工作流缓存
        const cached = reqWorkflowId ? getWorkflow(reqWorkflowId) : null;
        // 如果已进入 plan 阶段但用户请求续跑 agent，直接跳到 plan 生成
        const skipToPlan = cached && resumeFrom === "agent" && cached.agentPlanPhase;
        const agentResume = !skipToPlan && cached && resumeFrom === "agent" && cached.agentMessages
          ? { messages: cached.agentMessages, iteration: cached.agentIteration ?? 0 }
          : undefined;
        workflowId = (agentResume || skipToPlan) ? reqWorkflowId : newWorkflowId();
        if (!agentResume && !skipToPlan && !cached) {
          setWorkflow(workflowId, { createdAt: Date.now() });
        }
        send({ type: "workflow", id: workflowId });

        let agentResult: { type: "reply" | "plan"; text?: string; instruction?: string; focusDays?: number[] };
        if (skipToPlan) {
          // 直接从 plan 阶段续跑
          if (!cached!.agentInstruction) {
            console.error("[agent] 续跑失败：agentInstruction 已过期", { workflowId });
            send({ type: "error", message: "续跑信息已过期，请重新开始" });
            return;
          }
          agentResult = {
            type: "plan",
            instruction: cached!.agentInstruction,
            focusDays: cached!.agentFocusDays,
          };
        } else {
          // 运行 Agent 循环
          send({ type: "status", text: "Agent 正在思考…" });
          agentResult = await runAgent(ctx, message, history, {
            onToolCall: ctx.onToolCall,
            onToolResult: ctx.onToolResult,
            onThinking: (text) => send({ type: "thinking", text }),
            onStatus: (text) => send({ type: "status", text }),
            onStateChange: (messages, iteration) => {
              const wf = getWorkflow(workflowId);
              if (wf) {
                wf.agentMessages = messages;
                wf.agentIteration = iteration;
                setWorkflow(workflowId, wf);
              }
            },
          }, clientAbort.signal, agentResume);
        }

        if (agentResult.type === "plan") {
          // Agent 决定生成方案（或由 reply 转换而来）
          send({ type: "status", text: "Agent 正在生成行程方案…" });
          // 标记已进入 plan 阶段，续跑时可跳过 agent 循环
          const wf0 = getWorkflow(workflowId);
          if (wf0) {
            wf0.agentPlanPhase = true;
            wf0.agentInstruction = agentResult.instruction;
            wf0.agentFocusDays = agentResult.focusDays;
            setWorkflow(workflowId, wf0);
          }
          // 续跑支持：从坐标匹配阶段续跑（复用已有的 plan 缓存）
          // skipToPlan 时若已有 generatedPlan，直接跳过方案生成阶段
          const resume = cached && (resumeFrom === "coords" || skipToPlan) && cached.generatedPlan
            ? { from: "coords" as const, plan: cached.generatedPlan }
            : undefined;
          if (!resume) {
            const wf1 = getWorkflow(workflowId);
            if (wf1) {
              wf1.agentPlanPhase = true;
              wf1.createdAt = Date.now();
              setWorkflow(workflowId, wf1);
            } else {
              setWorkflow(workflowId, { createdAt: Date.now(), agentPlanPhase: true });
            }
          }
          send({ type: "workflow", id: workflowId });
          const { plan, focusDays } = await executeProposePlan(
            ctx,
            agentResult.instruction!,
            agentResult.focusDays,
            resume,
            (generatedPlan) => {
              // 保存生成的方案到工作流缓存，支持续跑
              const wf = getWorkflow(workflowId);
              if (wf) {
                wf.generatedPlan = generatedPlan;
                setWorkflow(workflowId, wf);
              }
            },
            clientAbort.signal,
          );

          if (!plan) {
            // runPlanGeneration 已推送 error 事件，此处仅记录服务端日志
            console.error("[agent] plan 阶段失败", { workflowId, instruction: agentResult.instruction });
            return;
          }

          send({ type: "result", plan, focusDays, allowedFields: ["all"], stayIntent: { hotel: false, food: false } });
        } else {
          // Agent 返回文本回复，直接使用用户消息触发 propose_plan
          send({ type: "status", text: "Agent 正在生成行程方案…" });
          agentResult = { type: "plan", instruction: message, focusDays: undefined };
          // 递归调用 plan 处理... 直接内联处理
          const wf0 = getWorkflow(workflowId);
          if (wf0) {
            wf0.agentPlanPhase = true;
            wf0.agentInstruction = message;
            setWorkflow(workflowId, wf0);
          }
          send({ type: "workflow", id: workflowId });
          const { plan: fallbackPlan, focusDays: fallbackFocusDays } = await executeProposePlan(
            ctx,
            message,
            undefined,
            undefined,
            (generatedPlan) => {
              const wf = getWorkflow(workflowId);
              if (wf) {
                wf.generatedPlan = generatedPlan;
                setWorkflow(workflowId, wf);
              }
            },
            clientAbort.signal,
          );
          if (!fallbackPlan) {
            // runPlanGeneration 已推送 error 事件，此处仅记录服务端日志
            console.error("[agent] plan 阶段失败（reply 回退）", { workflowId, message });
            return;
          }
          send({ type: "result", plan: fallbackPlan, focusDays: fallbackFocusDays, allowedFields: ["all"], stayIntent: { hotel: false, food: false } });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isAbort = err instanceof Error && (err.name === "AbortError" || err.name === "DOMException");
        console.error("[agent] 工作流失败", {
          workflowId,
          resumeFrom,
          isAbort,
          errorName: err instanceof Error ? err.name : typeof err,
          errorMessage: msg,
        });
        // 发送带 workflowId 的错误事件，前端可据此显示"继续"按钮
        send({ type: "error", message: isAbort ? "连接已中断" : msg, workflowId: workflowId || undefined });
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