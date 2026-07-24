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
} from "antd";
import { ThunderboltOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import AiPlanPreview from "@/components/AiPlanPreview";
import { postSse } from "@/lib/sse-client";
import type { AiPlan } from "@/types";

interface Props {
  open: boolean;
  onCancel: () => void;
  onCreated: (tripId: string) => void;
}

const PREFERENCE_OPTIONS = [
  "亲子",
  "美食",
  "暴走打卡",
  "休闲慢节奏",
  "历史文化",
  "自然风光",
  "购物",
  "摄影",
  "夜生活",
  "小众路线",
].map((x) => ({ value: x, label: x }));

type Phase = "form" | "generating" | "preview";

export default function AiPlanWizard({ open, onCancel, onCreated }: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [phase, setPhase] = useState<Phase>("form");
  const [status, setStatus] = useState("");
  const [streamText, setStreamText] = useState("");
  const [plan, setPlan] = useState<AiPlan | null>(null);
  const [importing, setImporting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const paramsRef = useRef<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      setPhase("form");
      setPlan(null);
      setStreamText("");
      setStatus("");
    }
  }, [open]);

  useEffect(() => {
    if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [streamText, status]);

  const runGenerate = async (params: Record<string, unknown>) => {
    paramsRef.current = params;
    setPhase("generating");
    setStreamText("");
    setStatus("正在连接 AI 服务…");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await postSse(
        "/api/ai/generate",
        params,
        (event) => {
          if (event.type === "delta" && event.text) setStreamText((prev) => prev + event.text);
          else if (event.type === "status" && event.text) setStatus(event.text);
          else if (event.type === "result" && event.plan) {
            setPlan(event.plan as AiPlan);
            setPhase("preview");
          } else if (event.type === "error") {
            message.error(event.message ?? "生成失败", 6);
            setPhase("form");
          }
        },
        controller.signal,
      );
      // 流结束但没有 result（如服务端异常提前关闭）
      setPhase((p) => (p === "generating" ? "form" : p));
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        message.error(err instanceof Error ? err.message : "生成失败", 6);
      }
      setPhase("form");
    }
  };

  const handleGenerate = async () => {
    const values = await form.validateFields().catch(() => null);
    if (!values) return;
    const [start, end] = values.dates as [Dayjs, Dayjs];
    runGenerate({
      destination: values.destination,
      startDate: start.format("YYYY-MM-DD"),
      days: end.diff(start, "day") + 1,
      people: values.people ?? 2,
      budgetLevel: values.budgetLevel ?? "舒适",
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
      {phase === "form" && (
        <Form form={form} layout="vertical" initialValues={{ people: 2, budgetLevel: "舒适" }}>
          <div style={{ display: "flex", gap: 12 }}>
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
              style={{ flex: 1.4 }}
            >
              <DatePicker.RangePicker style={{ width: "100%" }} />
            </Form.Item>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <Form.Item label="人数" name="people" style={{ flex: 1 }}>
              <InputNumber min={1} max={20} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="预算档位" name="budgetLevel" style={{ flex: 2 }}>
              <Segmented options={["经济", "舒适", "高端"]} />
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
          <Button type="primary" block size="large" icon={<ThunderboltOutlined />} onClick={handleGenerate}>
            开始生成
          </Button>
        </Form>
      )}

      {phase === "generating" && (
        <Space direction="vertical" size="middle" style={{ display: "flex" }}>
          <Alert type="info" showIcon message={status || "生成中…"} />
          <pre
            ref={preRef}
            style={{
              maxHeight: 320,
              overflowY: "auto",
              background: "#fafafa",
              border: "1px solid #f0f0f0",
              borderRadius: 8,
              padding: 12,
              fontSize: 12,
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              margin: 0,
            }}
          >
            {streamText || "等待模型输出…"}
          </pre>
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
