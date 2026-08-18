import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { chat } from "@/lib/ai/client";
import { buildAdjustFocusPrompt, buildAdjustPrompt, buildConfirmPrompt, mergeFocusPlan, parseConfirmResult, planStreamResponse } from "@/lib/ai/generate";
import { detectFocusDays } from "@/lib/ai/diff";
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
  } | null;
  const tripId = typeof body?.tripId === "string" ? body.tripId : "";
  const instruction = typeof body?.instruction === "string" ? body.instruction.trim() : "";
  const useWebSearch = !!body?.webSearch;
  const confirmAnswer = typeof body?.confirmAnswer === "string" ? body.confirmAnswer.trim() : "";
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
    const settings = await getSettings();
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
  const focusDays = detectFocusDays(fullInstruction);
  return planStreamResponse(
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
      transformPlan: (plan) =>
        focusDays ? mergeFocusPlan(plan, items, focusDays) : plan,
      preCheck: confirmAnswer
        ? undefined
        : async (send, config) => {
            send({ type: "step", id: "confirm", label: "分析调整意图", status: "start" });
            try {
              const confirmRaw = await chat(
                config,
                buildConfirmPrompt(tripDetail, items, instruction),
                200,
                30000,
              );
              const confirmResult = parseConfirmResult(confirmRaw);
              if (confirmResult.need && confirmResult.questions) {
                send({ type: "step", id: "confirm", label: "分析调整意图", status: "done", detail: "需要用户确认" });
                send({
                  type: "confirm",
                  questions: confirmResult.questions,
                });
                return false;
              }
              send({ type: "step", id: "confirm", label: "分析调整意图", status: "done", detail: "意图明确，无需确认" });
            } catch {
              send({ type: "step", id: "confirm", label: "分析调整意图", status: "done", detail: "确认步骤跳过" });
            }
            return true;
          },
    },
  );
}
