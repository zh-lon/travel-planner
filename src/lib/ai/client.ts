// AI 服务客户端：兼容 OpenAI Chat Completions、OpenAI Responses 与 Anthropic Messages 三种协议。
// 服务地址、API Key、模型名均由用户在设置页配置；请求一律由本地服务端转发，
// Key 不进入前端，也规避了浏览器直连第三方服务的 CORS 限制。

export type AiProtocol = "openai" | "openai-response" | "anthropic";

export interface AiConfig {
  protocol: AiProtocol;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens?: number; // 生成回复的 token 上限（选填，默认 8000）
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

// 工具定义（OpenAI / Anthropic 通用）
export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema 的 properties
  required?: string[];
}

// AI 返回的工具调用
export interface ToolCall {
  id: string;
  name: string;
  arguments: string; // JSON 字符串
}

// 工具执行结果
export interface ToolResult {
  toolCallId: string;
  content: string; // 序列化后的结果文本
  error?: string;
}

// chatWithTools 返回值
export interface ChatWithToolsResult {
  text: string | null;
  toolCalls: ToolCall[];
  reasoningContent?: string; // 思考模型的推理过程（如 DeepSeek-R1 的 reasoning_content）
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

// OpenAI Responses 协议：baseUrl 推荐填到版本号为止（如 https://api.openai.com/v1）
export function openAiResponsesUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (base.endsWith("/v1/responses")) return base;
  if (/\/v\d+$/.test(base)) return `${base}/responses`;
  return `${base}/v1/responses`;
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

// OpenAI Responses 协议：将 ChatMessage[] 转为 Responses API 的 input 格式
// system 消息提取为 instructions，user/assistant 保留在 input 数组中
// tool 角色消息转为 function_call_output 格式
function convertToResponsesInput(messages: ChatMessage[]): {
  instructions: string;
  input: Array<{ role?: string; content?: string; type?: string; call_id?: string; output?: string }>;
} {
  const instructions = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const input = messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      if (m.role === "tool") {
        return {
          type: "function_call_output",
          call_id: m.tool_call_id ?? "",
          output: m.content,
        };
      }
      return { role: m.role, content: m.content };
    });
  return { instructions, input };
}

// 从 Responses API 非流式响应中提取文本和工具调用
function parseResponsesOutput(data: {
  output?: Array<{
    type?: string;
    role?: string;
    content?: Array<{ type?: string; text?: string }>;
    id?: string;
    call_id?: string;
    name?: string;
    arguments?: string;
  }>;
}): { text: string; toolCalls: ToolCall[] } {
  const textParts: string[] = [];
  const toolCalls: ToolCall[] = [];
  for (const item of data.output ?? []) {
    if (item.type === "message" && item.role === "assistant") {
      for (const part of item.content ?? []) {
        if (part.type === "output_text" && part.text) {
          textParts.push(part.text);
        }
      }
    } else if (item.type === "function_call" && item.call_id && item.name) {
      toolCalls.push({
        id: item.call_id,
        name: item.name,
        arguments: item.arguments ?? "{}",
      });
    }
  }
  return { text: textParts.join(""), toolCalls };
}

// 非流式对话，返回完整文本
// timeoutMs：请求总时长上限；传 0 或负数表示不设超时（仅在确认上游不会被挂起时使用）
export async function chat(
  config: AiConfig,
  messages: ChatMessage[],
  maxTokens = 1024,
  timeoutMs = 60000,
): Promise<string> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  if (timeoutMs > 0) {
    timer = setTimeout(() => controller.abort(), timeoutMs);
  }
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

    if (config.protocol === "openai-response") {
      const { instructions, input } = convertToResponsesInput(messages);
      const res = await fetch(openAiResponsesUrl(config.baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          max_output_tokens: maxTokens,
          ...(instructions ? { instructions } : {}),
          input,
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}：${truncate(await res.text())}`);
      const data = (await res.json()) as {
        output?: Array<{
          type?: string;
          role?: string;
          content?: Array<{ type?: string; text?: string }>;
        }>;
      };
      const { text } = parseResponsesOutput(data);
      return text;
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
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    console.error("[ai/chat] 调用失败", {
      isTimeout: isAbort,
      timeoutMs,
      protocol: config.protocol,
      model: config.model,
      baseUrl: config.baseUrl,
      requestUrl:
        config.protocol === "anthropic"
          ? anthropicMessagesUrl(config.baseUrl)
          : config.protocol === "openai-response"
            ? openAiResponsesUrl(config.baseUrl)
            : openAiChatUrl(config.baseUrl),
      errorName: err instanceof Error ? err.name : typeof err,
      errorMessage: err instanceof Error ? err.message : String(err),
      errorStack: err instanceof Error ? err.stack : undefined,
    });
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// 带工具调用的非流式对话：发送消息和工具定义，AI 返回文本或工具调用
// 工具调用结果由调用方执行后通过 tool 角色消息注入对话，再次调用此函数继续
// signal：外部 AbortSignal（如客户端断开），与内部超时共同控制中止
export async function chatWithTools(
  config: AiConfig,
  messages: ChatMessage[],
  tools: ToolDef[],
  maxTokens = 4096,
  timeoutMs = 60000,
  signal?: AbortSignal,
): Promise<ChatWithToolsResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  if (timeoutMs > 0) {
    timer = setTimeout(() => controller.abort(), timeoutMs);
  }
  // 外部信号（如客户端断开）也触发中止
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener("abort", onExternalAbort, { once: true });
  try {
    if (config.protocol === "anthropic") {
      const { system, rest } = splitSystem(messages);
      const anthropicTools = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: {
          type: "object",
          properties: t.parameters,
          ...(t.required && t.required.length > 0 ? { required: t.required } : {}),
        },
      }));
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
          tools: anthropicTools,
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}：${truncate(await res.text())}`);
      const data = (await res.json()) as {
        content?: Array<{ type: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown }>;
        stop_reason?: string;
      };
      const textParts: string[] = [];
      const thinkingParts: string[] = [];
      const toolCalls: ToolCall[] = [];
      for (const block of data.content ?? []) {
        if (block.type === "text" && block.text) {
          textParts.push(block.text);
        } else if (block.type === "thinking" && block.thinking) {
          thinkingParts.push(block.thinking);
        } else if (block.type === "tool_use" && block.id && block.name) {
          toolCalls.push({
            id: block.id,
            name: block.name,
            arguments: JSON.stringify(block.input ?? {}),
          });
        }
      }
      return {
        text: textParts.length > 0 ? textParts.join("") : null,
        toolCalls,
        reasoningContent: thinkingParts.length > 0 ? thinkingParts.join("") : undefined,
      };
    }

    if (config.protocol === "openai-response") {
      const { instructions, input } = convertToResponsesInput(messages);
      const responseTools = tools.map((t) => ({
        type: "function" as const,
        name: t.name,
        description: t.description,
        parameters: {
          type: "object" as const,
          properties: t.parameters,
          ...(t.required && t.required.length > 0 ? { required: t.required } : {}),
        },
      }));
      const res = await fetch(openAiResponsesUrl(config.baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          max_output_tokens: maxTokens,
          ...(instructions ? { instructions } : {}),
          input,
          tools: responseTools,
          tool_choice: "auto",
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}：${truncate(await res.text())}`);
      const data = (await res.json()) as {
        output?: Array<{
          type?: string;
          role?: string;
          content?: Array<{ type?: string; text?: string }>;
          id?: string;
          call_id?: string;
          name?: string;
          arguments?: string;
        }>;
      };
      const { text, toolCalls } = parseResponsesOutput(data);
      return {
        text: text || null,
        toolCalls,
      };
    }

    // OpenAI 兼容协议
    const openaiTools = tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: {
          type: "object" as const,
          properties: t.parameters,
          ...(t.required && t.required.length > 0 ? { required: t.required } : {}),
        },
      },
    }));
    const res = await fetch(openAiChatUrl(config.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: maxTokens,
        messages,
        tools: openaiTools,
        tool_choice: "auto",
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}：${truncate(await res.text())}`);
    const data = (await res.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
          reasoning_content?: string;
          tool_calls?: Array<{
            id?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
      }>;
    };
    const msg = data.choices?.[0]?.message;
    const toolCalls: ToolCall[] = (msg?.tool_calls ?? [])
      .filter((tc) => tc.id && tc.function?.name)
      .map((tc) => ({
        id: tc.id!,
        name: tc.function!.name!,
        arguments: tc.function!.arguments ?? "{}",
      }));
    return {
      text: msg?.content?.trim() || null,
      toolCalls,
      reasoningContent: msg?.reasoning_content?.trim() || undefined,
    };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    console.error("[ai/chatWithTools] 调用失败", {
      isTimeout: isAbort,
      timeoutMs,
      protocol: config.protocol,
      model: config.model,
      errorName: err instanceof Error ? err.name : typeof err,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}

// 流式版带工具调用对话：与 chatWithTools 功能相同，但使用 SSE 流式传输，避免中间代理因长时间无数据触发 504 超时。
// 工具调用累积策略：OpenAI 协议的 tool_calls 在 delta 中增量传输，按 index 累积 arguments 片段；
// Anthropic 协议通过 content_block_start/content_block_delta 区分文本块和工具调用块。
// onDelta：收到文本增量时回调（思考过程、正文内容），工具调用参数不通过 onDelta 展示。
// timeoutMs 为"空闲超时"：每次收到上游数据块即重置计时器，默认 5 分钟。
export async function chatWithToolsStream(
  config: AiConfig,
  messages: ChatMessage[],
  tools: ToolDef[],
  maxTokens = 4096,
  timeoutMs = 300000,
  signal?: AbortSignal,
  onDelta?: (text: string) => void,
): Promise<ChatWithToolsResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const resetIdleTimer = () => {
    if (timer) clearTimeout(timer);
    if (timeoutMs > 0) timer = setTimeout(() => controller.abort(), timeoutMs);
  };
  resetIdleTimer();
  // 外部信号（如客户端断开）也触发中止
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener("abort", onExternalAbort, { once: true });

  const consumeSse = async (res: Response, onData: (payload: string) => void) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}：${truncate(await res.text())}`);
    if (!res.body) throw new Error("服务未返回流式响应");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) resetIdleTimer();
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
      const anthropicTools = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: {
          type: "object",
          properties: t.parameters,
          ...(t.required && t.required.length > 0 ? { required: t.required } : {}),
        },
      }));
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
          tools: anthropicTools,
        }),
        signal: controller.signal,
      });

      const textParts: string[] = [];
      const thinkingParts: string[] = [];
      // Anthropic 流式工具调用：按 content_block index 累积
      const toolCallBlocks = new Map<number, { id: string; name: string; argsJson: string }>();

      await consumeSse(res, (payload) => {
        if (!payload) return;
        try {
          const obj = JSON.parse(payload) as {
            type?: string;
            index?: number;
            delta?: { type?: string; text?: string; thinking?: string; partial_json?: string };
            content_block?: { type?: string; id?: string; name?: string };
            error?: { message?: string };
          };
          if (obj.type === "error") throw new Error(obj.error?.message ?? "AI 服务返回错误");

          if (obj.type === "content_block_start" && obj.content_block) {
            const block = obj.content_block;
            if (block.type === "tool_use" && block.id && block.name && obj.index != null) {
              toolCallBlocks.set(obj.index, { id: block.id, name: block.name, argsJson: "" });
            }
          } else if (obj.type === "content_block_delta" && obj.delta) {
            if (obj.delta.type === "text_delta" && obj.delta.text) {
              textParts.push(obj.delta.text);
              onDelta?.(obj.delta.text);
            } else if (obj.delta.type === "thinking_delta" && obj.delta.thinking) {
              thinkingParts.push(obj.delta.thinking);
              onDelta?.(obj.delta.thinking);
            } else if (obj.delta.type === "input_json_delta" && obj.delta.partial_json && obj.index != null) {
              const block = toolCallBlocks.get(obj.index);
              if (block) block.argsJson += obj.delta.partial_json;
            }
          }
        } catch (err) {
          if (err instanceof SyntaxError) return;
          throw err;
        }
      });

      const toolCalls: ToolCall[] = [...toolCallBlocks.values()].map((b) => ({
        id: b.id,
        name: b.name,
        arguments: b.argsJson || "{}",
      }));
      return {
        text: textParts.length > 0 ? textParts.join("") : null,
        toolCalls,
        reasoningContent: thinkingParts.length > 0 ? thinkingParts.join("") : undefined,
      };
    }

    if (config.protocol === "openai-response") {
      // Responses API 流式工具调用：通过事件类型累积
      const { instructions, input } = convertToResponsesInput(messages);
      const responseTools = tools.map((t) => ({
        type: "function" as const,
        name: t.name,
        description: t.description,
        parameters: {
          type: "object" as const,
          properties: t.parameters,
          ...(t.required && t.required.length > 0 ? { required: t.required } : {}),
        },
      }));
      const res = await fetch(openAiResponsesUrl(config.baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          max_output_tokens: maxTokens,
          stream: true,
          ...(instructions ? { instructions } : {}),
          input,
          tools: responseTools,
          tool_choice: "auto",
        }),
        signal: controller.signal,
      });

      const textParts: string[] = [];
      // Responses API 流式工具调用：按 call_id 累积
      const toolCallByCallId = new Map<string, { id: string; name: string; argsJson: string }>();

      await consumeSse(res, (payload) => {
        if (!payload || payload === "[DONE]") return;
        try {
          const obj = JSON.parse(payload) as {
            type?: string;
            delta?: string;
            call_id?: string;
            name?: string;
            arguments?: string;
            error?: { message?: string };
          };
          if (obj.type === "error") throw new Error(obj.error?.message ?? "AI 服务返回错误");

          if (obj.type === "response.output_text.delta" && obj.delta) {
            textParts.push(obj.delta);
            onDelta?.(obj.delta);
          } else if (obj.type === "response.function_call_arguments.delta" && obj.delta && obj.call_id) {
            const existing = toolCallByCallId.get(obj.call_id);
            if (existing) {
              existing.argsJson += obj.delta;
            } else {
              toolCallByCallId.set(obj.call_id, {
                id: obj.call_id,
                name: obj.name ?? "",
                argsJson: obj.delta,
              });
            }
          } else if (obj.type === "response.function_call_arguments.done" && obj.call_id) {
            const existing = toolCallByCallId.get(obj.call_id);
            if (existing && obj.arguments) {
              existing.argsJson = obj.arguments; // 完整替换
            }
          }
        } catch (err) {
          if (err instanceof SyntaxError) return;
          throw err;
        }
      });

      const toolCalls: ToolCall[] = [...toolCallByCallId.values()].map((b) => ({
        id: b.id,
        name: b.name,
        arguments: b.argsJson || "{}",
      }));
      return {
        text: textParts.length > 0 ? textParts.join("") : null,
        toolCalls,
      };
    }

    // OpenAI 兼容协议：流式 tool_calls 增量累积
    const openaiTools = tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: {
          type: "object" as const,
          properties: t.parameters,
          ...(t.required && t.required.length > 0 ? { required: t.required } : {}),
        },
      },
    }));
    const res = await fetch(openAiChatUrl(config.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: maxTokens,
        stream: true,
        messages,
        tools: openaiTools,
        tool_choice: "auto",
      }),
      signal: controller.signal,
    });

    const textParts: string[] = [];
    const thinkingParts: string[] = [];
    // OpenAI 流式 tool_calls：按 index 累积，arguments 分片拼接
    const toolCallAccum = new Map<number, { id: string; name: string; argsFragments: string[] }>();

    await consumeSse(res, (payload) => {
      if (!payload || payload === "[DONE]") return;
      try {
        const obj = JSON.parse(payload) as {
          choices?: Array<{
            delta?: {
              content?: string;
              reasoning_content?: string;
              tool_calls?: Array<{
                index?: number;
                id?: string;
                function?: { name?: string; arguments?: string };
              }>;
            };
          }>;
        };
        const delta = obj.choices?.[0]?.delta;
        if (!delta) return;

        if (delta.content) {
          textParts.push(delta.content);
          onDelta?.(delta.content);
        } else if (delta.reasoning_content) {
          thinkingParts.push(delta.reasoning_content);
          onDelta?.(delta.reasoning_content);
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.index == null) continue;
            const existing = toolCallAccum.get(tc.index);
            if (existing) {
              if (tc.function?.arguments) existing.argsFragments.push(tc.function.arguments);
            } else {
              toolCallAccum.set(tc.index, {
                id: tc.id ?? "",
                name: tc.function?.name ?? "",
                argsFragments: tc.function?.arguments ? [tc.function.arguments] : [],
              });
            }
            // 后补的 id/name（部分 provider 首帧不带 id）
            if (tc.id && existing && !existing.id) existing.id = tc.id;
            if (tc.function?.name && existing && !existing.name) existing.name = tc.function.name;
          }
        }
      } catch {
        // 忽略无法解析的行
      }
    });

    const toolCalls: ToolCall[] = [...toolCallAccum.values()]
      .filter((tc) => tc.id && tc.name)
      .map((tc) => ({
        id: tc.id,
        name: tc.name,
        arguments: tc.argsFragments.join("") || "{}",
      }));
    return {
      text: textParts.length > 0 ? textParts.join("") : null,
      toolCalls,
      reasoningContent: thinkingParts.length > 0 ? thinkingParts.join("") : undefined,
    };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    console.error("[ai/chatWithToolsStream] 调用失败", {
      isTimeout: isAbort,
      timeoutMs,
      protocol: config.protocol,
      model: config.model,
      errorName: err instanceof Error ? err.name : typeof err,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}

// 流式对话：onDelta 收到所有可展示的增量（含思考过程），返回值只包含正文内容
// timeoutMs 为"空闲超时"：每次收到上游数据块即重置计时器，仅当完全无数据超过该时长才中止连接；
// 传 0 或负数表示不设超时。默认 10 分钟，兼顾首 token 前的排队等待与长时间输出
// signal：外部 AbortSignal（如客户端断开），与内部超时共同控制中止
export async function chatStream(
  config: AiConfig,
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  maxTokens = 8000,
  timeoutMs = 600000,
  signal?: AbortSignal,
): Promise<string> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const resetIdleTimer = () => {
    if (timer) clearTimeout(timer);
    if (timeoutMs > 0) timer = setTimeout(() => controller.abort(), timeoutMs);
  };
  resetIdleTimer();
  // 外部信号（如客户端断开）也触发中止
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener("abort", onExternalAbort, { once: true });
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
      if (value && value.byteLength > 0) resetIdleTimer();
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

    if (config.protocol === "openai-response") {
      const { instructions, input } = convertToResponsesInput(messages);
      const res = await fetch(openAiResponsesUrl(config.baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          max_output_tokens: maxTokens,
          stream: true,
          ...(instructions ? { instructions } : {}),
          input,
        }),
        signal: controller.signal,
      });
      await consumeSse(res, (payload) => {
        if (!payload || payload === "[DONE]") return;
        try {
          const obj = JSON.parse(payload) as {
            type?: string;
            delta?: string;
            error?: { message?: string };
          };
          if (obj.type === "error") throw new Error(obj.error?.message ?? "AI 服务返回错误");
          if (obj.type === "response.output_text.delta" && obj.delta) {
            full += obj.delta;
            onDelta(obj.delta);
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
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", onExternalAbort);
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
