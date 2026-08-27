import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { aiConfigFromSettings } from "@/lib/ai/generate";
import { chatStream, secondaryConfig, type ChatMessage } from "@/lib/ai/client";
import { parseJsonLoose } from "@/lib/ai/schema";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";

dayjs.locale("zh-cn");

export const dynamic = "force-dynamic";

// 把用户的自然语言旅行需求解析为结构化表单字段，用于预填 AI 规划表单
export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  const body = (await request.json().catch(() => null)) as { text?: string } | null;
  if (!body || typeof body.text !== "string" || !body.text.trim()) {
    return NextResponse.json({ error: "请输入需求描述" }, { status: 400 });
  }
  const text = body.text.trim().slice(0, 1000);

  const settings = await getSettings(user.id);
  const config = aiConfigFromSettings(settings);
  if (!config) {
    return NextResponse.json(
      { error: "尚未配置 AI 服务，请管理员到设置页填写" },
      { status: 400 },
    );
  }

  const today = dayjs().format("YYYY年M月D日 dddd");
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `你是一个旅行需求解析助手。用户会用自然语言描述旅行计划，你需要提取结构化信息并输出纯 JSON（不要任何解释文字、不要 Markdown 代码块）。
今天是 ${today}。请根据这个日期推断用户提到的相对日期（如"下周末""国庆节""下个月初"等）。

JSON 结构：
{"destination":"城市名（无则空字符串）","departure":"出发城市名（无则空字符串）","startDate":"YYYY-MM-DD（无法判断则 null）","days":3,"people":2,"budgetLevel":"经济|舒适|高端","pace":"紧凑|适中|休闲","preferences":["从以下选项中匹配：亲子、美食、暴走打卡、休闲慢节奏、历史文化、自然风光、购物、摄影、夜生活、小众路线、自驾游"],"mustVisit":["具体地点名"],"extra":"其他补充要求"}

规则：
1. 只输出 JSON，不要任何其他文字；
2. 用户未提到的字段：destination/departure 留空字符串，startDate/days/people 填 null，budgetLevel/pace 填 null，preferences/mustVisit 填空数组，extra 填空字符串；
3. 旅行缩写展开：识别常见旅行线路缩写并展开为完整城市名，用顿号"、"分隔。如"昆大丽香"→"昆明、大理、丽江、香格里拉"，"川西小环线"→"成都、四姑娘山、丹巴、色达"，"江浙沪"→"上海、杭州、苏州"等；不确定的缩写按最可能的展开；
4. destination 支持多个城市名，用顿号"、"分隔（如"昆明、大理、丽江、香格里拉"）；
5. 模糊日期处理：用户给出的结束日期含多个可能时（如"4,5号"意为4号或5号），取较晚日期作为结束日；days 为含首尾的总天数（如 9月25日到10月5日共 11 天）；用户只给出开始日期和天数时，days 直接取用户给出的天数；用户给出开始和结束日期时，days 为两者之差加一；
6. preferences 必须从给定选项中匹配，用户表达的意向映射到最接近的选项；同时可根据目的地和描述合理推断（如自然景区→"自然风光"，历史古迹→"历史文化"，美食街/小吃→"美食"，海岛/海滩→"休闲慢节奏"等），但不要过度推断；
7. mustVisit 提取用户明确提到的具体地点（景点、餐厅等）；
8. extra 收纳用户提到但不属于上述字段的信息（如"带老人小孩""不吃辣""第一天下午才到"等）；
9. days 为整数（含首尾天数），startDate 为 YYYY-MM-DD 格式字符串；
10. pace 根据用户描述判断：提到"特种兵""暴走""紧凑"等判为紧凑，提到"休闲""慢节奏""轻松"等判为休闲，未提及填 null。`,
    },
    { role: "user", content: text },
  ];

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
        send({ type: "status", text: "AI 正在解析需求…" });

        let raw = "";
        try {
          raw = await chatStream(secondaryConfig(config), messages, (delta) => {
            send({ type: "delta", text: delta });
          }, 1024, 180000);
        } catch (err) {
          send({
            type: "error",
            message: `AI 解析失败：${err instanceof Error ? err.message : String(err)}`,
          });
          return;
        }

        let parsedRaw: unknown;
        try {
          parsedRaw = parseJsonLoose(raw);
        } catch (err) {
          console.error("[parse-intent] JSON 解析失败", {
            model: config.model,
            rawLength: raw.length,
            rawPreview: raw.slice(0, 500),
            error: err instanceof Error ? err.message : String(err),
          });
          send({ type: "error", message: "需求解析失败：AI 返回格式异常，请重试" });
          return;
        }
        const parsed = parsedRaw as {
          destination?: string;
          departure?: string;
          startDate?: string | null;
          days?: number | null;
          people?: number | null;
          budgetLevel?: string | null;
          pace?: string | null;
          preferences?: string[];
          mustVisit?: string[];
          extra?: string;
        };

        // 清洗与校验
        const destination = typeof parsed.destination === "string" ? parsed.destination.trim() : "";
        const departure = typeof parsed.departure === "string" ? parsed.departure.trim() : "";
        const startDate =
          typeof parsed.startDate === "string" && parsed.startDate
            ? dayjs(parsed.startDate).isValid()
              ? dayjs(parsed.startDate).format("YYYY-MM-DD")
              : null
            : null;
        const days =
          typeof parsed.days === "number" && Number.isInteger(parsed.days) && parsed.days >= 1 && parsed.days <= 30
            ? parsed.days
            : null;
        const people =
          typeof parsed.people === "number" && Number.isInteger(parsed.people) && parsed.people >= 1 && parsed.people <= 20
            ? parsed.people
            : null;
        const validBudget = ["经济", "舒适", "高端"];
        const budgetLevel =
          typeof parsed.budgetLevel === "string" && validBudget.includes(parsed.budgetLevel)
            ? parsed.budgetLevel
            : null;
        const validPace = ["紧凑", "适中", "休闲"];
        const pace =
          typeof parsed.pace === "string" && validPace.includes(parsed.pace)
            ? parsed.pace
            : null;
        const preferences = Array.isArray(parsed.preferences)
          ? parsed.preferences.filter((x): x is string => typeof x === "string").slice(0, 10)
          : [];
        const mustVisit = Array.isArray(parsed.mustVisit)
          ? parsed.mustVisit.filter((x): x is string => typeof x === "string").slice(0, 20)
          : [];
        const extra = typeof parsed.extra === "string" ? parsed.extra.trim().slice(0, 300) : "";

        send({
          type: "result",
          parsed: {
            destination,
            departure,
            startDate,
            days,
            people,
            budgetLevel,
            pace,
            preferences,
            mustVisit,
            extra,
          },
        });
      } catch (err) {
        const isTimeout = err instanceof Error && err.name === "AbortError";
        console.error("[parse-intent] 失败", {
          isTimeout,
          errorName: err instanceof Error ? err.name : typeof err,
          errorMessage: err instanceof Error ? err.message : String(err),
          model: config.model,
          protocol: config.protocol,
          baseUrl: config.baseUrl,
          inputTextLen: text.length,
          inputTextPreview: text.slice(0, 200),
        });
        const msg = isTimeout
          ? "AI 解析超时（3 分钟无响应），请重试或直接填写表单"
          : err instanceof Error
            ? err.message
            : String(err);
        send({ type: "error", message: `需求解析失败：${msg}` });
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
