import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { chat, secondaryConfig } from "@/lib/ai/client";
import { buildAdjustFocusPrompt, buildAdjustPrompt, buildConfirmPrompt, mergeFocusPlan, mergePartialPlan, parseConfirmResult, planStreamResponse } from "@/lib/ai/generate";
import { detectFocusDays, isMoveDayInstruction } from "@/lib/ai/diff";
import { requireTripEditByChild, requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { webSearch } from "@/lib/websearch";
import type { ItineraryItemT, TripDetail } from "@/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const body = (await request.json().catch(() => null)) as {
    tripId?: unknown;
    instruction?: unknown;
    webSearch?: unknown;
    confirmAnswer?: unknown;
    focusDays?: unknown;
  } | null;
  const tripId = typeof body?.tripId === "string" ? body.tripId : "";
  const instruction = typeof body?.instruction === "string" ? body.instruction.trim() : "";
  const useWebSearch = !!body?.webSearch;
  const confirmAnswer = typeof body?.confirmAnswer === "string" ? body.confirmAnswer.trim() : "";
  const bodyFocusDays = Array.isArray(body?.focusDays)
    ? (body!.focusDays as unknown[]).filter((d) => typeof d === "number" && (d as number) >= 0) as number[]
    : undefined;
  if (!tripId) return NextResponse.json({ error: "缺少行程 ID" }, { status: 400 });
  if (!instruction) return NextResponse.json({ error: "请填写调整要求" }, { status: 400 });
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

  // 联网搜索（可选）
  let searchContext: string | undefined;
  if (useWebSearch) {
    const settings = await getSettings(user.id);
    const searchProvider = (settings["search.provider"] ?? "tavily").trim();
    const searchApiKey = (settings["search.apiKey"] ?? "").trim();
    if (searchApiKey) {
      try {
        const results = await webSearch(searchProvider, searchApiKey, `${trip.destination} ${instruction}`, 4, 15000);
        if (results.length > 0) {
          searchContext = results
            .map((r, i) => `${i + 1}. 【${r.title}】${r.content} (来源: ${r.url})`)
            .join("\n");
        }
      } catch {
        // 搜索失败静默处理，不影响 AI 生成
      }
    }
  }

  const items = tripDetail.items as ItineraryItemT[];
  const fullInstruction = confirmAnswer
    ? `${instruction}（用户确认选择：${confirmAnswer}）`
    : instruction;
  // AI 判断的关注天（优先用 AI 结果，回退到正则）
  // 使用 let：preCheck 回调中会用 AI 结果覆盖
  let focusDays: Set<number> | null;
  let aiAllowedFields: string[] | undefined;
  let aiStayIntent: { hotel: boolean; food: boolean } | undefined;
  if (confirmAnswer && bodyFocusDays !== undefined) {
    // 前端回传的 AI focusDays（确认后重试场景）
    focusDays = bodyFocusDays.length > 0 ? new Set(bodyFocusDays) : null;
  } else {
    // 初始请求或无前端回传：先用正则兑底，preCheck 中可能被 AI 结果覆盖
    focusDays = detectFocusDays(fullInstruction, tripDetail.startDate);
  }
  return planStreamResponse(
    user.id,
    async () => {
      const messages = focusDays
        ? buildAdjustFocusPrompt(tripDetail, items, fullInstruction, focusDays)
        : buildAdjustPrompt(tripDetail, items, fullInstruction);
      if (searchContext) {
        messages.push({
          role: "user",
          content: `以下是一些联网搜索到的参考信息，请结合这些信息来调整行程：\n\n${searchContext}`,
        });
      }
      return { messages, expectedDays: focusDays?.size ?? 0, city: trip.destination };
    },
    {
      // 安全兜底：focusDays 为 null 但 AI 只输出了部分天数时，用原始行程项填充缺失天
      transformPlan: (plan) => {
        if (focusDays) return mergeFocusPlan(plan, items, focusDays);
        const itemsDayCount = items.length > 0
          ? Math.max(...items.map((i) => i.dayIndex + 1))
          : 0;
        return plan.days.length < itemsDayCount ? mergePartialPlan(plan, items) : plan;
      },
      preCheck: confirmAnswer
        ? undefined
        : async (send, config) => {
            send({ type: "step", id: "confirm", label: "分析调整意图", status: "start" });
            try {
              const confirmRaw = await chat(
                secondaryConfig(config),
                buildConfirmPrompt(tripDetail, items, instruction),
                200,
                30000,
              );
              const confirmResult = parseConfirmResult(confirmRaw);
              // 移动天操作需要全量输出，覆盖 AI 的 focusDays 判断
              if (isMoveDayInstruction(instruction)) {
                focusDays = null;
              } else {
                focusDays = confirmResult.focusDays && confirmResult.focusDays.length > 0
                  ? new Set(confirmResult.focusDays)
                  : detectFocusDays(fullInstruction, tripDetail.startDate);
              }
              // 保存 AI 意图，后续 resultData 中回传前端
              aiAllowedFields = confirmResult.allowedFields;
              aiStayIntent = confirmResult.stayIntent;
              if (confirmResult.need && confirmResult.questions) {
                send({ type: "step", id: "confirm", label: "分析调整意图", status: "done", detail: "需要用户确认" });
                send({
                  type: "confirm",
                  questions: confirmResult.questions,
                  focusDays: confirmResult.focusDays,
                  allowedFields: confirmResult.allowedFields,
                  stayIntent: confirmResult.stayIntent,
                });
                return false;
              }
              send({ type: "step", id: "confirm", label: "分析调整意图", status: "done", detail: "意图明确，无需确认" });
            } catch {
              send({ type: "step", id: "confirm", label: "分析调整意图", status: "done", detail: "确认步骤跳过" });
            }
            return true;
          },
      resultData: () => ({ focusDays: focusDays ? [...focusDays] : [], allowedFields: aiAllowedFields, stayIntent: aiStayIntent }),
    },
    request,
  );
}
