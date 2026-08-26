import { NextResponse } from "next/server";
import {
  aiConfigFromSettings,
  buildCreatePrompt,
  runPlanGeneration,
  sendStep,
  type GenerateParams,
  type SseSend,
} from "@/lib/ai/generate";
import { getWorkflow, newWorkflowId, setWorkflow } from "@/lib/ai/workflow";
import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { webSearch } from "@/lib/websearch";
import type { ChatMessage } from "@/lib/ai/client";

export const dynamic = "force-dynamic";

// 一键生成行程的工作流编排：
// 确认基础信息 →（可选）联网搜索参考资料 → 生成行程方案（含校验重试）→ 匹配地点坐标 → 完成
export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const body = (await request.json().catch(() => null)) as
    | (Partial<GenerateParams> & { webSearch?: unknown; workflowId?: unknown; resumeFrom?: unknown })
    | null;
  if (!body) return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });

  const destination = typeof body.destination === "string" ? body.destination.trim() : "";
  const days = Number(body.days);
  const startDate = typeof body.startDate === "string" ? body.startDate : "";
  const useWebSearch = !!body.webSearch;
  if (!destination) return NextResponse.json({ error: "目的地不能为空" }, { status: 400 });
  if (!Number.isInteger(days) || days < 1 || days > 30) {
    return NextResponse.json({ error: "天数需在 1~30 之间" }, { status: 400 });
  }
  if (Number.isNaN(new Date(startDate).getTime())) {
    return NextResponse.json({ error: "出发日期不合法" }, { status: 400 });
  }

  const params: GenerateParams = {
    destination,
    startDate,
    days,
    departure: typeof body.departure === "string" ? body.departure : undefined,
    people: typeof body.people === "number" ? body.people : undefined,
    budgetLevel: typeof body.budgetLevel === "string" ? body.budgetLevel : undefined,
    pace: typeof body.pace === "string" ? body.pace : undefined,
    preferences: Array.isArray(body.preferences)
      ? body.preferences.filter((x): x is string => typeof x === "string")
      : undefined,
    mustVisit: Array.isArray(body.mustVisit)
      ? body.mustVisit.filter((x): x is string => typeof x === "string")
      : undefined,
    extra: typeof body.extra === "string" ? body.extra : undefined,
  };

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
      // 心跳：防止代理因无数据而超时断连
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
        let from: "search" | "generate" | "coords" | null = null;
        if (cached) {
          if (resumeFrom === "search" || resumeFrom === "generate") from = cached.messages ? resumeFrom : null;
          else if (resumeFrom === "coords") from = cached.generatedPlan ? "coords" : null;
        }
        const workflowId = from ? reqWorkflowId : newWorkflowId();
        const state = from ? cached! : { createdAt: Date.now() };
        setWorkflow(workflowId, state);
        send({ type: "workflow", id: workflowId });

        // 步骤 1：确认基础信息（回显参数摘要；续跑时已完成，跳过）
        if (!from) {
          sendStep(send, "params", "确认基础信息", "start");
          const summaryParts = [`${destination} ${days} 天`];
          if (params.people) summaryParts.push(`${params.people} 人`);
          if (params.budgetLevel) summaryParts.push(`预算${params.budgetLevel}`);
          if (params.pace) summaryParts.push(`节奏${params.pace}`);
          if (params.preferences?.length) summaryParts.push(`偏好：${params.preferences.join("、")}`);
          sendStep(send, "params", "确认基础信息", "done", summaryParts.join("，"));
        }

        // 步骤 2：联网搜索参考资料（可选；续跑自 search 之后的步骤时跳过）
        const messages: ChatMessage[] = state.messages ?? buildCreatePrompt(params);
        state.messages = messages;
        if (useWebSearch && (!from || from === "search")) {
          const searchProvider = (settings["search.provider"] ?? "tavily").trim();
          const searchApiKey = (settings["search.apiKey"] ?? "").trim();
          if (!searchApiKey) {
            sendStep(send, "search", "联网搜索参考资料", "done", "未配置搜索 API Key，已跳过");
          } else {
            sendStep(send, "search", "联网搜索参考资料", "start");
            try {
              const query = `${destination} 旅游攻略 必去景点 美食推荐 ${days}天行程`;
              const results = await webSearch(searchProvider, searchApiKey, query, 8, 15000);
              if (results.length > 0) {
                const searchContext = results
                  .map((r, i) => `${i + 1}. 【${r.title}】${r.content} (来源: ${r.url})`)
                  .join("\n");
                messages.push({
                  role: "user",
                  content: `以下是一些联网搜索到的参考信息，请结合这些信息规划行程（注意甄别时效性，景点开放情况以常识判断）：\n\n${searchContext}`,
                });
                sendStep(send, "search", "联网搜索参考资料", "done", `获得 ${results.length} 条参考信息`);
              } else {
                sendStep(send, "search", "联网搜索参考资料", "done", "未搜索到相关信息");
              }
            } catch (err) {
              // 工作流失败即终止，不降级继续
              const msg = err instanceof Error ? err.message : "未知错误";
              sendStep(send, "search", "联网搜索参考资料", "error", msg);
              send({ type: "error", message: `联网搜索失败：${msg}` });
              return;
            }
          }
        }

        // 步骤 3/4：生成行程方案（含校验重试）与坐标落地
        if (from === "coords") {
          sendStep(send, "generate", "生成行程方案", "done", "使用上次已生成的方案");
        } else {
          sendStep(send, "generate", "生成行程方案", "start");
        }
        let coordsStarted = false;
        const plan = await runPlanGeneration(
          send,
          config,
          settings,
          { messages, expectedDays: days, city: destination },
          {
            onValidated: (p) => {
              state.generatedPlan = p;
              sendStep(send, "generate", "生成行程方案", "done", "方案已通过校验");
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
          else sendStep(send, "generate", "生成行程方案", "error");
          return;
        }
        if (coordsStarted) sendStep(send, "coords", "匹配地点坐标", "done");
        sendStep(send, "complete", "完成", "done", "行程方案已就绪，请预览后导入");
        send({ type: "result", plan });
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
