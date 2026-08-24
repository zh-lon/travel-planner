"use client";

// AI 助手面板（行程页右侧）：对话式助手 —— 可自然问答/咨询，识别到调整需求时走 diff 勾选应用流程
import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Input, Modal, Space, Switch, Tag, Typography } from "antd";
import {
  CloseCircleFilled,
  DoubleRightOutlined,
  GlobalOutlined,
  ReloadOutlined,
  RobotOutlined,
  SendOutlined,
  UserOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import AiDiffPreview from "@/components/AiDiffPreview";
import WorkflowSteps, { type WorkflowStepItem } from "@/components/WorkflowSteps";
import { composeApplyItems, diffPlan, revertNonIntentFields } from "@/lib/ai/diff";
import { postSse } from "@/lib/sse-client";
import type { AiPlan, TripDetail } from "@/types";

interface Props {
  trip: TripDetail;
  collapsed: boolean;
  onCollapsedChange: (next: boolean) => void;
  onApplied: () => void;
}

type Phase = "idle" | "generating" | "preview";

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

const QUICK_PROMPTS = [
  "这里有什么必吃的美食？",
  "出行前需要准备什么？",
  "当地有哪些值得去的景点？",
  "节奏放慢，每天少排一个点",
  "把顺路的景点排到同一天",
  "加一天，去周边古镇",
];

export default function AiAssistantPanel({ trip, collapsed, onCollapsedChange, onApplied }: Props) {
  const { message } = App.useApp();
  const [phase, setPhase] = useState<Phase>("idle");
  const [inputValue, setInputValue] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [steps, setSteps] = useState<WorkflowStepItem[]>([]);
  const [streamText, setStreamText] = useState("");
  const [status, setStatus] = useState("");
  const [plan, setPlan] = useState<AiPlan | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const [errorInfo, setErrorInfo] = useState<string | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  const [adjustInstruction, setAdjustInstruction] = useState("");
  const [confirmData, setConfirmData] = useState<{
    questions: Array<{ question: string; options: Array<{ label: string; desc: string }> }>;
    currentIdx: number;
    answers: string[];
    msg: string;
    focusDays?: number[]; // AI 判断的关注天，回传后端
  } | null>(null);
  const [customAnswer, setCustomAnswer] = useState("");
  const [aiFocusDays, setAiFocusDays] = useState<number[] | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const failedMsgRef = useRef<string>("");
  const workflowIdRef = useRef<string>("");
  const failedStepRef = useRef<string>("");

  const entries = useMemo(
    () => (plan
      ? revertNonIntentFields(
          diffPlan(trip.items, plan),
          adjustInstruction,
          aiFocusDays !== null ? new Set(aiFocusDays) : null,
        )
      : []),
    [plan, trip.items, adjustInstruction, aiFocusDays],
  );

  useEffect(() => {
    // 默认勾选 added 和 modified，不勾选 removed ——
    // 防止用户不细看就全量应用，导致非意图的大量删除
    setSelected(new Set(entries.filter((e) => e.kind === "added" || e.kind === "modified").map((e) => e.key)));
  }, [entries]);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [streamText, status, phase, messages, steps]);

  // 组件卸载时中断进行中的请求
  useEffect(() => () => abortRef.current?.abort(), []);

  const handleSend = async (
    text?: string,
    addUserBubble = true,
    resume?: { workflowId: string; from: string },
    keepSteps = false,
    confirmAnswer?: string,
    focusDays?: number[],
  ) => {
    const msg = (text ?? inputValue).trim();
    if (!msg) {
      message.warning("先输入想问的问题或调整要求");
      return;
    }
    if (phase === "generating") return;
    if (!text) setInputValue("");
    if (addUserBubble) setMessages((prev) => [...prev, { role: "user", content: msg }]);
    failedMsgRef.current = msg;
    failedStepRef.current = "";
    setErrorInfo(null);

    setPhase("generating");
    if (!keepSteps) setSteps([]);
    setStreamText("");
    setStatus("正在启动工作流…");
    setPlan(null);

    // 失败统一处理：保留步骤条现场，在对话区展示失败气泡供重试
    const failWith = (errMsg: string) => {
      setErrorInfo(errMsg);
      setStreamText("");
      setPhase("idle");
    };

    const history = messages.slice(-12).map((m) => ({ role: m.role, content: m.content }));
    const controller = new AbortController();
    abortRef.current = controller;
    let full = "";
    let gotTerminal = false;
    try {
      await postSse(
        "/api/ai/chat",
        {
          tripId: trip.id,
          message: msg,
          history,
          webSearch,
          ...(resume ? { workflowId: resume.workflowId, resumeFrom: resume.from } : {}),
          ...(confirmAnswer ? { confirmAnswer } : {}),
          ...(confirmAnswer && focusDays ? { focusDays } : {}),
        },
        (event) => {
          if (event.type === "workflow" && event.id) workflowIdRef.current = String(event.id);
          else if (event.type === "step" && event.id) {
            const entry: WorkflowStepItem = {
              id: event.id,
              label: event.label ?? event.id,
              status: event.status === "start" ? "running" : event.status === "error" ? "error" : "done",
              detail: event.detail,
            };
            if (event.status === "error") failedStepRef.current = entry.id;
            setSteps((prev) => {
              const idx = prev.findIndex((s) => s.id === entry.id);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = entry;
                return next;
              }
              return [...prev, entry];
            });
          } else if (event.type === "delta" && event.text) {
            full += event.text;
            setStreamText(full);
          } else if (event.type === "status" && event.text) setStatus(event.text);
          else if (event.type === "reply") {
            gotTerminal = true;
            const reply = (event.text ?? "").trim();
            if (reply) setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
            setStreamText("");
            setPhase("idle");
          } else if (event.type === "result" && event.plan) {
            gotTerminal = true;
            setPlan(event.plan as AiPlan);
            // 空数组视为 null（AI 返回 [] 表示"所有天"，不做天级别过滤）
            setAiFocusDays(Array.isArray(event.focusDays) && event.focusDays.length > 0 ? event.focusDays : null);
            setAdjustInstruction(confirmAnswer ? `${msg}（用户确认选择：${confirmAnswer}）` : msg);
            setStreamText("");
            setDiffOpen(true);
            setPhase("preview");
          } else if (event.type === "confirm") {
            gotTerminal = true;
            setConfirmData({
              questions: event.questions ?? [],
              currentIdx: 0,
              answers: [],
              msg,
              focusDays: Array.isArray(event.focusDays) ? event.focusDays : undefined,
            });
            setStreamText("");
            setPhase("idle");
          } else if (event.type === "error") {
            gotTerminal = true;
            failWith(event.message ?? "AI 调用失败");
          }
        },
        controller.signal,
      );
      // 流正常结束但未收到终止事件（兜底：把已流式的文本落入消息列表）
      if (!gotTerminal) {
        const trimmed = full.trim();
        if (trimmed) {
          setMessages((prev) => [...prev, { role: "assistant", content: trimmed }]);
          setStreamText("");
          setPhase("idle");
        } else {
          failWith("连接中断，未收到回复，请检查 AI 服务配置后重试");
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        failWith(err instanceof Error ? err.message : "调用失败，请重试");
      } else {
        setStreamText("");
        setPhase("idle");
      }
    }
  };

  // 重试：优先从失败步骤续跑（携带 workflowId + resumeFrom），无法续跑时整体重发
  const handleRetry = () => {
    if (!failedMsgRef.current) return;
    if (workflowIdRef.current && failedStepRef.current) {
      handleSend(
        failedMsgRef.current,
        false,
        { workflowId: workflowIdRef.current, from: failedStepRef.current },
        true,
      );
    } else {
      handleSend(failedMsgRef.current, false);
    }
  };

  const handleConfirmSelect = (label: string) => {
    const data = confirmData;
    if (!data) return;
    const newAnswers = [...data.answers, label];
    const nextIdx = data.currentIdx + 1;
    setCustomAnswer("");
    if (nextIdx >= data.questions.length) {
      // 全部回答完，拼接答案发回后端
      const answersStr = data.questions
        .map((q, i) => `${q.question}：${newAnswers[i]}`)
        .join("；");
      setConfirmData(null);
      handleSend(data.msg, false, undefined, false, answersStr, data.focusDays);
      return;
    }
    setConfirmData({ ...data, currentIdx: nextIdx, answers: newAnswers });
  };

  const canResumeRetry = !!workflowIdRef.current && steps.some((s) => s.status === "error");

  const selectedCount = entries.filter((e) => e.kind !== "unchanged" && selected.has(e.key)).length;
  const changedCount = entries.filter((e) => e.kind !== "unchanged").length;

  const handleApply = async () => {
    if (!plan || selectedCount === 0) return;
    // 安全检查：entries 必须包含足够原始项，防止 diff/revert 逻辑异常导致全量删除
    const oldItemCount = trip.items.length;
    const entriesWithOld = entries.filter((e) => e.oldItem).length;
    if (oldItemCount > 0 && entriesWithOld === 0) {
      message.error("对比数据异常（原始项全部丢失），已阻止应用以保护数据，请重新生成方案");
      return;
    }
    setApplying(true);
    try {
      const { items, days } = composeApplyItems(entries, selected, plan.days.length);
      const res = await fetch(`/api/trips/${trip.id}/apply-items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items, days }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error);
      message.success(`已应用 ${selectedCount} 项变更`);
      // 行程已变更，清空历史对话避免旧上下文误导 AI
      setMessages([
        { role: "assistant", content: `已按方案应用 ${selectedCount} 项变更，行程已更新。还需要继续调整吗？` },
      ]);
      setPlan(null);
      setPhase("idle");
      setDiffOpen(false);
      setInputValue("");
      onApplied();
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : "应用失败");
    } finally {
      setApplying(false);
    }
  };

  const handleCancel = () => {
    setPlan(null);
    setPhase("idle");
    setDiffOpen(false);
  };

  // 折叠状态
  if (collapsed) {
    return (
      <div
        className="ai-panel-rail"
        onClick={() => onCollapsedChange(false)}
        style={{
          width: 46,
          flexShrink: 0,
          background: "linear-gradient(180deg, #0d9488, #0891b2)",
          borderRadius: 12,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          paddingTop: 18,
          gap: 10,
          cursor: "pointer",
          color: "#fff",
          boxShadow: "0 4px 16px rgba(13, 148, 136, 0.25)",
          transition: "box-shadow 0.2s, transform 0.2s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.boxShadow = "0 6px 20px rgba(13, 148, 136, 0.35)";
          e.currentTarget.style.transform = "translateY(-1px)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.boxShadow = "0 4px 16px rgba(13, 148, 136, 0.25)";
          e.currentTarget.style.transform = "translateY(0)";
        }}
        title="展开 AI 助手"
      >
        <RobotOutlined style={{ fontSize: 20 }} />
        <span className="ai-panel-rail-text" style={{ writingMode: "vertical-lr", letterSpacing: 4, fontSize: 12, fontWeight: 600 }}>AI 助手</span>
      </div>
    );
  }

  // 聊天区域气泡样式
  const bubbleStyle = (role: "user" | "assistant"): React.CSSProperties => ({
    maxWidth: "90%",
    padding: "10px 14px",
    borderRadius: role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
    marginBottom: 10,
    alignSelf: role === "user" ? "flex-end" : "flex-start",
    background: role === "user" ? "linear-gradient(135deg, #0d9488, #0891b2)" : "#f5f5f5",
    color: role === "user" ? "#fff" : "#333",
    fontSize: 13,
    lineHeight: "20px",
    wordBreak: "break-word",
    boxShadow: role === "user"
      ? "0 2px 8px rgba(13, 148, 136, 0.2)"
      : "0 1px 2px rgba(0,0,0,0.06)",
  });

  // AI 回复按 Markdown 渲染（列表、加粗等）
  const renderMarkdown = (content: string) => (
    <div className="ai-chat-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );

  return (
    <div
      className="ai-panel"
      style={{
        width: 380,
        flexShrink: 0,
        background: "#fff",
        borderRadius: 12,
        border: "1px solid rgba(0, 0, 0, 0.06)",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
      }}
    >
      {/* 头部 */}
      <div
        style={{
          padding: "12px 14px",
          borderBottom: "1px solid #f5f5f5",
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "linear-gradient(135deg, rgba(99,102,241,0.06), rgba(139,92,246,0.06))",
          borderRadius: "12px 12px 0 0",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            borderRadius: 8,
            background: "linear-gradient(135deg, #0d9488, #0891b2)",
            color: "#fff",
            boxShadow: "0 2px 8px rgba(13, 148, 136, 0.25)",
          }}
        >
          <RobotOutlined style={{ fontSize: 15 }} />
        </span>
        <div style={{ flex: 1, lineHeight: 1.3 }}>
          <Typography.Text strong style={{ fontSize: 14, display: "block" }}>
            AI 助手
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            问答咨询 · 按需调整行程
          </Typography.Text>
        </div>
        <Button
          type="text"
          size="small"
          icon={<DoubleRightOutlined />}
          onClick={() => onCollapsedChange(true)}
          title="收起"
        />
      </div>

      {/* 消息区域 */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "14px",
          display: "flex",
          flexDirection: "column",
          background: "#fafbfc",
        }}
      >
        {/* 欢迎消息 */}
        {messages.length === 0 && phase !== "preview" && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={bubbleStyle("assistant")}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>👋 你好！我是你的旅行 AI 助手</div>
              <div style={{ color: "#666", fontSize: 12 }}>
                关于这趟行程有任何问题都可以问我，比如美食、交通、注意事项；想改动行程时，直接说出调整要求，我会生成方案供你确认。
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "0 4px", marginBottom: 10 }}>
              {QUICK_PROMPTS.map((q) => (
                <Tag
                  key={q}
                  style={{
                    cursor: "pointer",
                    marginRight: 0,
                    borderRadius: 16,
                    padding: "2px 10px",
                    borderColor: "#e0e0e0",
                    background: "#fff",
                    transition: "all 0.2s",
                    fontSize: 12,
                  }}
                  onClick={() => handleSend(q)}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "#0d9488";
                    e.currentTarget.style.color = "#0d9488";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "#e0e0e0";
                    e.currentTarget.style.color = "";
                  }}
                >
                  {q}
                </Tag>
              ))}
            </div>
          </div>
        )}

        {/* 历史消息 */}
        {messages.map((m, i) => (
          <div key={i} style={bubbleStyle(m.role)}>
            {m.role === "user" ? (
              <>
                <UserOutlined style={{ marginRight: 6 }} />
                {m.content}
              </>
            ) : (
              renderMarkdown(m.content)
            )}
          </div>
        ))}

        {/* 生成中：工作流步骤条 */}
        {phase === "generating" && (
          <div style={bubbleStyle("assistant")}>
            <div style={{ fontWeight: 600, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
              <RobotOutlined style={{ fontSize: 13 }} />
              <span>AI 正在逐步处理…</span>
            </div>
            {steps.length > 0 ? (
              <WorkflowSteps steps={steps} />
            ) : (
              <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>{status || "AI 思考中…"}</div>
            )}
            {steps.length > 0 && status && (
              <div style={{ fontSize: 11, color: "#999", marginBottom: 4 }}>{status}</div>
            )}
            {streamText && (
              <div
                style={{
                  margin: "8px 0 0",
                  fontSize: 12,
                  color: "#555",
                  maxHeight: 220,
                  overflowY: "auto",
                }}
              >
                {renderMarkdown(streamText)}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
              <Button
                size="small"
                onClick={() => {
                  abortRef.current?.abort();
                  setStreamText("");
                  setPhase("idle");
                }}
              >
                取消
              </Button>
            </div>
          </div>
        )}

        {/* 确认选项卡片：AI 要求用户逐个回答问题 */}
        {confirmData && phase !== "generating" && (() => {
          const q = confirmData.questions[confirmData.currentIdx];
          if (!q) return null;
          const total = confirmData.questions.length;
          return (
          <div style={bubbleStyle("assistant")}>
            {total > 1 && (
              <div style={{ fontSize: 11, color: "#999", marginBottom: 6 }}>
                问题 {confirmData.currentIdx + 1}/{total}
              </div>
            )}
            <div style={{ fontWeight: 600, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
              <RobotOutlined style={{ fontSize: 13 }} />
              <span style={{ wordBreak: "break-word" }}>{q.question}</span>
            </div>
            <Space direction="vertical" style={{ display: "flex", width: "100%" }}>
              {q.options.map((opt) => (
                <Button
                  key={opt.label}
                  block
                  style={{ textAlign: "left", height: "auto", padding: "8px 12px", whiteSpace: "normal" }}
                  onClick={() => handleConfirmSelect(opt.label)}
                >
                  <div style={{ fontWeight: 500, wordBreak: "break-word" }}>{opt.label}</div>
                  {opt.desc && <div style={{ fontSize: 11, color: "#999", wordBreak: "break-word", marginTop: 2 }}>{opt.desc}</div>}
                </Button>
              ))}
            </Space>
            <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
              <Input
                placeholder="或输入你的回答…"
                value={customAnswer}
                onChange={(e) => setCustomAnswer(e.target.value)}
                onPressEnter={() => {
                  if (customAnswer.trim()) {
                    handleConfirmSelect(customAnswer.trim());
                  }
                }}
                style={{ flex: 1, fontSize: 13 }}
              />
              <Button size="small" type="primary" onClick={() => {
                if (customAnswer.trim()) {
                  handleConfirmSelect(customAnswer.trim());
                }
              }}>
                发送
              </Button>
            </div>
          </div>
          );
        })()}

        {/* 调用失败：失败提示 + 重试 */}
        {errorInfo && phase !== "generating" && (
          <div style={{ ...bubbleStyle("assistant"), background: "#fff2f0", border: "1px solid #ffccc7" }}>
            <div style={{ fontWeight: 600, color: "#cf1322", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
              <CloseCircleFilled />
              <span>调用失败</span>
            </div>
            {steps.length > 0 && <WorkflowSteps steps={steps} />}
            <div style={{ fontSize: 12, color: "#666", margin: "6px 0 8px" }}>{errorInfo}</div>
            <Space size={8}>
              <Button size="small" type="primary" danger icon={<ReloadOutlined />} onClick={handleRetry}>
                {canResumeRetry ? "从失败步骤重试" : "重试"}
              </Button>
              <Button size="small" onClick={() => setErrorInfo(null)}>
                关闭
              </Button>
            </Space>
          </div>
        )}

        {/* 调整方案就绪提示（对比核对在大弹窗中进行） */}
        {phase === "preview" && plan && (
          <div style={bubbleStyle("assistant")}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#389e0d", fontWeight: 500, marginBottom: 6 }}>
              <RobotOutlined />
              已生成调整方案（{changedCount} 项变更）
            </div>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
              请在核对弹窗中逐项确认后再应用；若已关闭，可点击下方按钮重新打开。
            </div>
            <Space size={8}>
              <Button size="small" type="primary" onClick={() => setDiffOpen(true)}>
                打开核对
              </Button>
              <Button size="small" danger onClick={handleCancel}>
                放弃方案
              </Button>
            </Space>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 输入区域 */}
      <div
        style={{
          padding: "10px 14px 12px",
          borderTop: "1px solid #f0f0f0",
          background: "#fff",
          borderRadius: "0 0 12px 12px",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <Input.TextArea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="问点什么，或直接说想怎么调整行程…"
            autoSize={{ minRows: 1, maxRows: 3 }}
            maxLength={500}
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            style={{ flex: 1, borderRadius: 10 }}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={() => handleSend()}
            style={{
              borderRadius: 10,
              background: "linear-gradient(135deg, #0d9488, #0891b2)",
              border: "none",
              boxShadow: "0 2px 8px rgba(13, 148, 136, 0.25)",
              flexShrink: 0,
            }}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
          <Space size="small">
            <Switch
              size="small"
              checked={webSearch}
              onChange={setWebSearch}
              checkedChildren={<GlobalOutlined />}
              unCheckedChildren={<GlobalOutlined />}
            />
            <Typography.Text
              type={webSearch ? "success" : "secondary"}
              style={{ fontSize: 11, cursor: "pointer" }}
              onClick={() => setWebSearch(!webSearch)}
            >
              联网搜索
            </Typography.Text>
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            Enter 发送，Shift+Enter 换行
          </Typography.Text>
        </div>
      </div>

      {/* 调整方案核对大弹窗 */}
      <Modal
        title={
          <span>
            <RobotOutlined style={{ color: "#389e0d", marginRight: 8 }} />
            核对调整方案
          </span>
        }
        open={phase === "preview" && !!plan && diffOpen}
        width={1000}
        onCancel={() => setDiffOpen(false)}
        footer={
          <Space>
            <Button danger onClick={handleCancel}>
              放弃方案
            </Button>
            <Button
              type="primary"
              loading={applying}
              disabled={changedCount === 0 || selectedCount === 0}
              onClick={handleApply}
            >
              {changedCount === 0 ? "没有可应用的变更" : `应用已选（${selectedCount}/${changedCount}）`}
            </Button>
          </Space>
        }
      >
        {plan && (
          <div style={{ maxHeight: "68vh", overflowY: "auto" }}>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
              勾选需要应用的变更项（默认已全选），确认后点击下方「应用已选」。
            </div>
            <AiDiffPreview
              entries={entries}
              startDate={dayjs(trip.startDate)}
              selected={selected}
              onSelectionChange={setSelected}
              oldDayCount={dayjs(trip.endDate).diff(dayjs(trip.startDate), "day") + 1}
              planDays={plan.days.length}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
