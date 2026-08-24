// 工作流中间状态内存缓存：支持工作流失败后从失败步骤续跑
// 缓存在服务端进程内存中，带 TTL 自动清理；缓存失效时调用方应回退为整体重跑
import type { AiPlan } from "@/types";
import type { ChatMessage } from "./client";

export interface WorkflowState {
  createdAt: number;
  // 生成用提示词消息（已包含联网搜索参考信息）
  messages?: ChatMessage[];
  // 联网搜索到的参考信息（对话问答分支使用）
  searchContext?: string;
  // 意图识别结果（chat 工作流）
  isAdjust?: boolean;
  // 生成并通过校验的方案（坐标匹配前）
  generatedPlan?: AiPlan;
  // AI 判断的关注天（0-based），续跑时复用
  focusDays?: number[];
}

const store = new Map<string, WorkflowState>();
const TTL_MS = 30 * 60 * 1000;

export function newWorkflowId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getWorkflow(id: string): WorkflowState | null {
  prune();
  return store.get(id) ?? null;
}

export function setWorkflow(id: string, state: WorkflowState): void {
  store.set(id, state);
}

function prune(): void {
  const now = Date.now();
  for (const [key, value] of store) {
    if (now - value.createdAt > TTL_MS) store.delete(key);
  }
}
