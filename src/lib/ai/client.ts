// AI 服务客户端：兼容 OpenAI Chat Completions 与 Anthropic Messages 两种协议。
// 服务地址、API Key、模型名均由用户在设置页配置；请求一律由本地服务端转发，
// Key 不进入前端，也规避了浏览器直连第三方服务的 CORS 限制。

export type AiProtocol = "openai" | "anthropic";

export interface AiConfig {
  protocol: AiProtocol;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiTestResult {
  ok: boolean;
  latencyMs: number;
  reply?: string;
  error?: string;
}

function truncate(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// OpenAI 兼容协议：baseUrl 推荐填到版本号为止（如 https://api.deepseek.com/v1），
// 漏填 /v1 或多填 /chat/completions 的情况在这里兼容掉
export function openAiChatUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (base.endsWith("/chat/completions")) return base;
  if (/\/v\d+$/.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

// Anthropic 协议：baseUrl 填域名即可（如 https://api.anthropic.com）
export function anthropicMessagesUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (base.endsWith("/v1/messages")) return base;
  if (base.endsWith("/v1")) return `${base}/messages`;
  return `${base}/v1/messages`;
}

// Anthropic 协议的 system 独立于 messages
function splitSystem(messages: ChatMessage[]): {
  system: string;
  rest: { role: "user" | "assistant"; content: string }[];
} {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const rest = messages
    .filter((m): m is ChatMessage & { role: "user" | "assistant" } => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));
  return { system, rest };
}

// 非流式对话，返回完整文本
export async function chat(
  config: AiConfig,
  messages: ChatMessage[],
  maxTokens = 1024,
  timeoutMs = 60000,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (config.protocol === "anthropic") {
      const { system, rest } = splitSystem(messages);
      const res = await fetch(anthropicMessagesUrl(config.baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: maxTokens,
          ...(system ? { system } : {}),
          messages: rest,
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}：${truncate(await res.text())}`);
      const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      return (data.content ?? [])
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("");
    }

    const res = await fetch(openAiChatUrl(config.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ model: config.model, max_tokens: maxTokens, messages }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}：${truncate(await res.text())}`);
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(timer);
  }
}

// 流式对话：onDelta 收到所有可展示的增量（含思考过程），返回值只包含正文内容
export async function chatStream(
  config: AiConfig,
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  maxTokens = 8000,
  timeoutMs = 300000,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let full = "";

  const consumeSse = async (res: Response, onData: (payload: string) => void) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}：${truncate(await res.text())}`);
    if (!res.body) throw new Error("服务未返回流式响应");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("data:")) onData(trimmed.slice(5).trim());
      }
    }
  };

  try {
    if (config.protocol === "anthropic") {
      const { system, rest } = splitSystem(messages);
      const res = await fetch(anthropicMessagesUrl(config.baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: maxTokens,
          stream: true,
          ...(system ? { system } : {}),
          messages: rest,
        }),
        signal: controller.signal,
      });
      await consumeSse(res, (payload) => {
        if (!payload || payload === "[DONE]") return;
        try {
          const obj = JSON.parse(payload) as {
            type?: string;
            delta?: { type?: string; text?: string; thinking?: string };
            error?: { message?: string };
          };
          if (obj.type === "error") throw new Error(obj.error?.message ?? "AI 服务返回错误");
          if (obj.type === "content_block_delta") {
            if (obj.delta?.type === "text_delta" && obj.delta.text) {
              full += obj.delta.text;
              onDelta(obj.delta.text);
            } else if (obj.delta?.type === "thinking_delta" && obj.delta.thinking) {
              onDelta(obj.delta.thinking); // 仅展示，不计入正文
            }
          }
        } catch (err) {
          if (err instanceof SyntaxError) return; // 忽略无法解析的心跳行
          throw err;
        }
      });
      return full;
    }

    const res = await fetch(openAiChatUrl(config.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ model: config.model, max_tokens: maxTokens, stream: true, messages }),
      signal: controller.signal,
    });
    await consumeSse(res, (payload) => {
      if (!payload || payload === "[DONE]") return;
      try {
        const obj = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }>;
        };
        const delta = obj.choices?.[0]?.delta;
        if (delta?.content) {
          full += delta.content;
          onDelta(delta.content);
        } else if (delta?.reasoning_content) {
          onDelta(delta.reasoning_content); // 思考模型的推理过程，仅展示
        }
      } catch {
        // 忽略无法解析的行
      }
    });
    return full;
  } finally {
    clearTimeout(timer);
  }
}

// 连通性测试用的自然对话消息池：随机挑选，避免固定的探活文案，
// 对服务端来说与正常用户消息无异；成功与否不依赖回复内容
const TEST_PROMPTS = [
  "帮我推荐一个适合周末短途旅行的城市，一句话就好",
  "去成都玩三天，最不能错过的一件事是什么？一句话回答",
  "秋天适合去国内哪里旅行？用一句话说说",
  "旅行时怎么避开人流高峰？给我一条最实用的建议",
  "第一次带父母出去旅行，选哪种节奏的行程比较好？简短回答",
  "雨天在陌生城市有什么好玩的安排？一句话建议",
];

export async function testConnection(config: AiConfig): Promise<AiTestResult> {
  const start = Date.now();
  const prompt = TEST_PROMPTS[Math.floor(Math.random() * TEST_PROMPTS.length)];
  try {
    const reply = await chat(config, [{ role: "user", content: prompt }], 256, 30000);
    return { ok: true, latencyMs: Date.now() - start, reply: truncate(reply.trim(), 80) };
  } catch (err) {
    const error =
      err instanceof Error
        ? err.name === "AbortError"
          ? "请求超时（30 秒），请检查服务地址是否可达"
          : err.message
        : String(err);
    return { ok: false, latencyMs: Date.now() - start, error };
  }
}
