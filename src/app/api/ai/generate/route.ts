import { NextResponse } from "next/server";
import { buildCreatePrompt, planStreamResponse, type GenerateParams } from "@/lib/ai/generate";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Partial<GenerateParams> | null;
  if (!body) return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });

  const destination = typeof body.destination === "string" ? body.destination.trim() : "";
  const days = Number(body.days);
  const startDate = typeof body.startDate === "string" ? body.startDate : "";
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
    people: typeof body.people === "number" ? body.people : undefined,
    budgetLevel: typeof body.budgetLevel === "string" ? body.budgetLevel : undefined,
    preferences: Array.isArray(body.preferences)
      ? body.preferences.filter((x): x is string => typeof x === "string")
      : undefined,
    mustVisit: Array.isArray(body.mustVisit)
      ? body.mustVisit.filter((x): x is string => typeof x === "string")
      : undefined,
    extra: typeof body.extra === "string" ? body.extra : undefined,
  };

  return planStreamResponse(async () => ({
    messages: buildCreatePrompt(params),
    expectedDays: days,
    city: destination,
  }));
}
