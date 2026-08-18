// 客户端 SSE 读取工具：POST 请求 + 逐事件回调
export interface SseEventData {
  type: "status" | "delta" | "result" | "error" | "findings" | "reply" | "step" | "workflow" | "confirm";
  text?: string;
  message?: string;
  plan?: unknown;
  summary?: string;
  researchAt?: string;
  findings?: unknown;
  notes?: string[];
  reply?: string;
  proposal?: unknown;
  overview?: unknown;
  items?: unknown;
  parsed?: unknown;
  guide?: unknown;
  guideAt?: string;
  // 工作流步骤事件字段
  id?: string;
  label?: string;
  status?: "start" | "done" | "error";
  detail?: string;
  // 确认事件字段（AI 要求用户逐个回答问题）
  questions?: Array<{ question: string; options: Array<{ label: string; desc: string }> }>;
}

export async function postSse(
  url: string,
  body: unknown,
  onEvent: (event: SseEventData) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok || !contentType.includes("text/event-stream")) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `请求失败（HTTP ${res.status}）`);
  }
  if (!res.body) throw new Error("服务未返回流式响应");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of chunk.split("\n")) {
        if (line.startsWith("data: ")) {
          try {
            onEvent(JSON.parse(line.slice(6)) as SseEventData);
          } catch {
            // 忽略坏行
          }
        }
      }
    }
  }
}
