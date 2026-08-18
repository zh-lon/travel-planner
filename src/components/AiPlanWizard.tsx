"use client";

import { useEffect, useRef, useState } from "react";
import {
  Alert,
  App,
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Segmented,
  Select,
  Space,
  Switch,
  Typography,
} from "antd";
import { ThunderboltOutlined, MessageOutlined, GlobalOutlined, ReloadOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import AiPlanPreview from "@/components/AiPlanPreview";
import WorkflowSteps, { type WorkflowStepItem } from "@/components/WorkflowSteps";
import { postSse } from "@/lib/sse-client";
import { PREFERENCE_VALUES } from "@/types/constants";
import type { AiPlan } from "@/types";

interface Props {
  open: boolean;
  onCancel: () => void;
  onCreated: (tripId: string, mode?: "full" | "coplan") => void;
}

const PREFERENCE_OPTIONS = PREFERENCE_VALUES.map((x) => ({ value: x, label: x }));

const EXAMPLE_INTENTS = [
  "下周想去成都玩3天，2个人，预算舒适，想看大熊猫和宽窄巷子",
  "国庆节带爸妈去北京5天，历史文化为主，要爬长城",
  "周末去杭州2天，休闲慢节奏，美食为主",
  "9月中旬去西安4天，3个人，想看兵马俑和回民街",
];

type Phase = "intent" | "form" | "generating" | "failed" | "preview";

export default function AiPlanWizard({ open, onCancel, onCreated }: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [phase, setPhase] = useState<Phase>("intent");
  const [status, setStatus] = useState("");
  const [streamText, setStreamText] = useState("");
  const [plan, setPlan] = useState<AiPlan | null>(null);
  const [importing, setImporting] = useState(false);
  const [intentText, setIntentText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [coplanCreating, setCoplanCreating] = useState(false);
  const [steps, setSteps] = useState<WorkflowStepItem[]>([]);
  const [useWebSearch, setUseWebSearch] = useState(false);
  const [genError, setGenError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const paramsRef = useRef<Record<string, unknown> | null>(null);
  const workflowIdRef = useRef<string>("");
  const failedStepRef = useRef<string>("");

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      setPhase("intent");
      setPlan(null);
      setStreamText("");
      setStatus("");
      setIntentText("");
      setParsing(false);
      setCoplanCreating(false);
      setSteps([]);
      setGenError("");
    }
  }, [open]);

  useEffect(() => {
    if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [streamText, status]);

  const runGenerate = async (params: Record<string, unknown>, resume?: { workflowId: string; from: string }) => {
    paramsRef.current = params;
    setPhase("generating");
    setStreamText("");
    if (!resume) setSteps([]);
    failedStepRef.current = "";
    setGenError("");
    setStatus("正在启动工作流…");
    const controller = new AbortController();
    abortRef.current = controller;
    let gotTerminal = false;
    try {
      await postSse(
        "/api/ai/generate",
        {
          ...params,
          webSearch: useWebSearch,
          ...(resume ? { workflowId: resume.workflowId, resumeFrom: resume.from } : {}),
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
          } else if (event.type === "delta" && event.text) setStreamText((prev) => prev + event.text);
          else if (event.type === "status" && event.text) setStatus(event.text);
          else if (event.type === "result" && event.plan) {
            gotTerminal = true;
            setPlan(event.plan as AiPlan);
            setPhase("preview");
          } else if (event.type === "error") {
            gotTerminal = true;
            setGenError(event.message ?? "生成失败");
            setPhase("failed");
          }
        },
        controller.signal,
      );
      // 流结束但没有 result（如服务端异常提前关闭）
      if (!gotTerminal) {
        setGenError("连接中断，未收到生成结果，请重试");
        setPhase("failed");
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setGenError(err instanceof Error ? err.message : "生成失败");
        setPhase("failed");
      } else {
        setPhase("form");
      }
    }
  };

  // 重试：优先从失败步骤续跑，无法续跑时整体重跑
  const handleRetryGenerate = () => {
    if (!paramsRef.current) return;
    if (workflowIdRef.current && failedStepRef.current) {
      runGenerate(paramsRef.current, { workflowId: workflowIdRef.current, from: failedStepRef.current });
    } else {
      runGenerate(paramsRef.current);
    }
  };

  const handleParseIntent = async () => {
    const text = intentText.trim();
    if (!text) {
      message.warning("请先描述你的旅行需求");
      return;
    }
    setParsing(true);
    try {
      await postSse(
        "/api/ai/parse-intent",
        { text },
        (event) => {
          if (event.type === "error") {
            throw new Error(event.message ?? "解析失败");
          }
          if (event.type !== "result" || !event.parsed) return;
          const data = event.parsed as {
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
          // 预填表单
          const formValues: Record<string, unknown> = {
            destination: data.destination || "",
            departure: data.departure || "",
            preferences: data.preferences || [],
            mustVisit: data.mustVisit || [],
            extra: data.extra || "",
          };
          if (data.people) formValues.people = data.people;
          if (data.budgetLevel) formValues.budgetLevel = data.budgetLevel;
          if (data.pace) formValues.pace = data.pace;
          if (data.startDate && data.days) {
            const start = dayjs(data.startDate);
            if (start.isValid()) {
              const end = start.add(data.days - 1, "day");
              formValues.dates = [start, end];
            }
          }
          form.setFieldsValue(formValues);
          setPhase("form");
          message.success("已解析需求并预填表单，请确认后生成");
        },
      );
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : "解析失败", 6);
    } finally {
      setParsing(false);
    }
  };

  const handleCoplan = async () => {
    const values = await form.validateFields().catch(() => null);
    if (!values) return;
    const [start, end] = values.dates as [Dayjs, Dayjs];
    const destination = values.destination as string;
    const days = end.diff(start, "day") + 1;
    setCoplanCreating(true);
    try {
      const res = await fetch("/api/trips", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: `${destination}${days}日游`,
          destination,
          startDate: start.format("YYYY-MM-DD"),
          endDate: end.format("YYYY-MM-DD"),
          budgetTotal: null,
          notes: "AI 逐步规划",
          planParams: {
            departure: (values.departure as string) ?? "",
            people: values.people ?? null,
            budgetLevel: values.budgetLevel ?? null,
            pace: values.pace ?? null,
            preferences: (values.preferences as string[]) ?? [],
            mustVisit: (values.mustVisit as string[]) ?? [],
            extra: (values.extra as string) ?? "",
          },
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error);
      onCreated(data.id, "coplan");
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : "创建行程失败");
    } finally {
      setCoplanCreating(false);
    }
  };

  const handleGenerate = async () => {
    const values = await form.validateFields().catch(() => null);
    if (!values) return;
    const [start, end] = values.dates as [Dayjs, Dayjs];
    runGenerate({
      destination: values.destination,
      departure: values.departure ?? "",
      startDate: start.format("YYYY-MM-DD"),
      days: end.diff(start, "day") + 1,
      people: values.people ?? 2,
      budgetLevel: values.budgetLevel ?? "舒适",
      pace: values.pace ?? "适中",
      preferences: values.preferences ?? [],
      mustVisit: values.mustVisit ?? [],
      extra: values.extra ?? "",
    });
  };

  const handleImport = async () => {
    if (!plan || !paramsRef.current) return;
    const p = paramsRef.current;
    const start = dayjs(String(p.startDate));
    setImporting(true);
    try {
      const res = await fetch("/api/ai/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: `${p.destination}${p.days}日游`,
          destination: p.destination,
          startDate: start.format("YYYY-MM-DD"),
          endDate: start.add(Number(p.days) - 1, "day").format("YYYY-MM-DD"),
          budgetTotal: null,
          notes: "由 AI 生成",
          planParams: paramsRef.current,
          plan,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error);
      message.success("已导入为新行程");
      onCreated(data.id);
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : "导入失败");
    } finally {
      setImporting(false);
    }
  };

  const startDate = paramsRef.current ? dayjs(String(paramsRef.current.startDate)) : undefined;

  return (
    <Modal
      title={
        <span>
          <ThunderboltOutlined style={{ color: "#faad14", marginRight: 8 }} />
          AI 规划行程
        </span>
      }
      open={open}
      onCancel={() => {
        abortRef.current?.abort();
        onCancel();
      }}
      width={760}
      footer={null}
      forceRender
    >
      {phase === "intent" && (
        <Space direction="vertical" size="middle" style={{ display: "flex" }}>
          <Alert
            type="info"
            showIcon
            message="用一句话描述你的旅行计划"
            description="AI 会自动提取目的地、日期、人数、偏好等信息，预填到下方表单供你确认修改。"
          />
          <Input.TextArea
            rows={4}
            value={intentText}
            onChange={(e) => setIntentText(e.target.value)}
            placeholder="如：下周想去成都玩3天，2个人，预算舒适，想看大熊猫和宽窄巷子，带个小孩"
            maxLength={500}
            onPressEnter={(e) => {
              if (e.ctrlKey || e.metaKey) handleParseIntent();
            }}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {EXAMPLE_INTENTS.map((ex) => (
              <Button
                key={ex}
                size="small"
                type="dashed"
                onClick={() => setIntentText(ex)}
                style={{ marginBottom: 4 }}
              >
                {ex}
              </Button>
            ))}
          </div>
          <Button
            type="primary"
            size="large"
            block
            loading={parsing}
            icon={<ThunderboltOutlined />}
            onClick={handleParseIntent}
          >
            AI 解析需求
          </Button>
          <Button type="link" block onClick={() => setPhase("form")}>
            跳过，直接填写表单
          </Button>
        </Space>
      )}

      {phase === "form" && (
        <Form form={form} layout="vertical" initialValues={{ people: 2, budgetLevel: "舒适", pace: "适中" }}>
          <div style={{ display: "flex", gap: 12 }}>
            <Form.Item
              label="出发地"
              name="departure"
              style={{ flex: 1 }}
            >
              <Input placeholder="如：上海" maxLength={30} />
            </Form.Item>
            <Form.Item
              label="目的地"
              name="destination"
              rules={[{ required: true, message: "请输入目的地" }]}
              style={{ flex: 1 }}
            >
              <Input placeholder="如：成都" maxLength={30} />
            </Form.Item>
            <Form.Item
              label="日期范围"
              name="dates"
              rules={[{ required: true, message: "请选择日期" }]}
              style={{ flex: 1.2 }}
            >
              <DatePicker.RangePicker style={{ width: "100%" }} />
            </Form.Item>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <Form.Item label="人数" name="people" style={{ flex: 1 }}>
              <InputNumber min={1} max={20} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="预算档位" name="budgetLevel" style={{ flex: 1.5 }}>
              <Segmented options={["经济", "舒适", "高端"]} />
            </Form.Item>
            <Form.Item label="节奏" name="pace" style={{ flex: 1.5 }}>
              <Segmented options={["紧凑", "适中", "休闲"]} />
            </Form.Item>
          </div>
          <Form.Item label="旅行偏好" name="preferences">
            <Select mode="multiple" options={PREFERENCE_OPTIONS} placeholder="可多选" allowClear />
          </Form.Item>
          <Form.Item label="必去地点" name="mustVisit">
            <Select mode="tags" placeholder="输入后回车，可多个" open={false} suffixIcon={null} />
          </Form.Item>
          <Form.Item label="补充要求" name="extra">
            <Input.TextArea rows={2} placeholder="如：带老人小孩、不吃辣、第一天下午才到" maxLength={300} />
          </Form.Item>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <Switch
              size="small"
              checked={useWebSearch}
              onChange={setUseWebSearch}
              checkedChildren={<GlobalOutlined />}
              unCheckedChildren={<GlobalOutlined />}
            />
            <Typography.Text
              type={useWebSearch ? "success" : "secondary"}
              style={{ fontSize: 12, cursor: "pointer" }}
              onClick={() => setUseWebSearch(!useWebSearch)}
            >
              联网搜索参考资料（攻略/景点/美食，生成更贴近实时信息）
            </Typography.Text>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <Button
              type="primary"
              size="large"
              icon={<ThunderboltOutlined />}
              onClick={handleGenerate}
              style={{ flex: 1 }}
            >
              一键生成全部
            </Button>
            <Button
              size="large"
              icon={<MessageOutlined />}
              onClick={handleCoplan}
              loading={coplanCreating}
              style={{ flex: 1 }}
            >
              创建并逐步规划
            </Button>
          </div>
        </Form>
      )}

      {phase === "generating" && (
        <Space direction="vertical" size="middle" style={{ display: "flex" }}>
          <Alert type="info" showIcon message="AI 正在按工作流逐步生成行程，请稍候…" />
          <div
            style={{
              background: "#fafafa",
              border: "1px solid #f0f0f0",
              borderRadius: 8,
              padding: 12,
            }}
          >
            {steps.length > 0 ? (
              <WorkflowSteps steps={steps} />
            ) : (
              <div style={{ fontSize: 12, color: "#666" }}>{status || "生成中…"}</div>
            )}
            {steps.length > 0 && status && (
              <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>{status}</div>
            )}
            {streamText && (
              <pre
                ref={preRef}
                style={{
                  maxHeight: 220,
                  overflowY: "auto",
                  marginTop: 8,
                  paddingTop: 8,
                  borderTop: "1px dashed #e0e0e0",
                  fontSize: 12,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  margin: "8px 0 0",
                }}
              >
                {streamText}
              </pre>
            )}
          </div>
          <Button
            block
            onClick={() => {
              abortRef.current?.abort();
              setPhase("form");
            }}
          >
            取消生成
          </Button>
        </Space>
      )}

      {phase === "failed" && (
        <Space direction="vertical" size="middle" style={{ display: "flex" }}>
          <Alert type="error" showIcon message="生成失败" description={genError || "请稍后重试"} />
          {steps.length > 0 && (
            <div style={{ background: "#fafafa", border: "1px solid #f0f0f0", borderRadius: 8, padding: 12 }}>
              <WorkflowSteps steps={steps} />
            </div>
          )}
          <Space wrap>
            <Button type="primary" danger icon={<ReloadOutlined />} onClick={handleRetryGenerate}>
              {workflowIdRef.current && failedStepRef.current ? "从失败步骤重试" : "重试"}
            </Button>
            <Button onClick={() => paramsRef.current && runGenerate(paramsRef.current)}>重新开始</Button>
            <Button onClick={() => setPhase("form")}>返回表单</Button>
          </Space>
        </Space>
      )}

      {phase === "preview" && plan && (
        <Space direction="vertical" size="middle" style={{ display: "flex" }}>
          <div style={{ maxHeight: 420, overflowY: "auto" }}>
            <AiPlanPreview plan={plan} startDate={startDate} />
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <Button onClick={() => setPhase("form")}>返回修改</Button>
            <Button onClick={() => paramsRef.current && runGenerate(paramsRef.current)}>重新生成</Button>
            <Button type="primary" style={{ flex: 1 }} loading={importing} onClick={handleImport}>
              导入为行程
            </Button>
          </div>
        </Space>
      )}
    </Modal>
  );
}
