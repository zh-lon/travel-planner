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
  Space,
} from "antd";
import { ReadOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import AiPlanPreview from "@/components/AiPlanPreview";
import { postSse } from "@/lib/sse-client";
import type { AiPlan } from "@/types";

interface Props {
  open: boolean;
  onCancel: () => void;
  onCreated: (tripId: string) => void;
}

type Phase = "form" | "generating" | "preview";

export default function GuideImportModal({ open, onCancel, onCreated }: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [phase, setPhase] = useState<Phase>("form");
  const [status, setStatus] = useState("");
  const [streamText, setStreamText] = useState("");
  const [plan, setPlan] = useState<AiPlan | null>(null);
  const [importing, setImporting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const paramsRef = useRef<{ destination: string; startDate: string } | null>(null);

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

  const handleParse = async () => {
    const values = await form.validateFields().catch(() => null);
    if (!values) return;
    const content = (values.content as string).trim();
    if (/^https?:\/\/\S+$/.test(content)) {
      message.warning("小红书链接需要登录才能访问，请粘贴攻略正文文字（App 内长按可复制）", 6);
      return;
    }
    const startDate = (values.startDate as Dayjs).format("YYYY-MM-DD");
    paramsRef.current = { destination: values.destination, startDate };
    setPhase("generating");
    setStreamText("");
    setStatus("正在解析攻略…");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await postSse(
        "/api/ai/parse-guide",
        {
          content,
          destination: values.destination,
          startDate,
          days: values.days ?? undefined,
        },
        (event) => {
          if (event.type === "delta" && event.text) setStreamText((prev) => prev + event.text);
          else if (event.type === "status" && event.text) setStatus(event.text);
          else if (event.type === "result" && event.plan) {
            setPlan(event.plan as AiPlan);
            setPhase("preview");
          } else if (event.type === "error") {
            message.error(event.message ?? "解析失败", 6);
            setPhase("form");
          }
        },
        controller.signal,
      );
      setPhase((p) => (p === "generating" ? "form" : p));
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        message.error(err instanceof Error ? err.message : "解析失败", 6);
      }
      setPhase("form");
    }
  };

  const handleImport = async () => {
    if (!plan || !paramsRef.current) return;
    const { destination, startDate } = paramsRef.current;
    const days = plan.days.length;
    setImporting(true);
    try {
      const res = await fetch("/api/ai/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: `${destination}${days}日游（攻略）`,
          destination,
          startDate,
          endDate: dayjs(startDate).add(days - 1, "day").format("YYYY-MM-DD"),
          budgetTotal: null,
          notes: "由小红书攻略导入",
          plan,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error);
      message.success("攻略已导入为行程");
      onCreated(data.id);
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : "导入失败");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal
      title={
        <span>
          <ReadOutlined style={{ color: "#eb2f96", marginRight: 8 }} />
          导入小红书攻略
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
        <Form form={form} layout="vertical">
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="在小红书 App 里打开攻略笔记，长按正文复制文字，粘贴到下面即可。AI 会自动提取地点、整理成按天行程并匹配地图坐标。"
          />
          <Form.Item
            label="攻略正文"
            name="content"
            rules={[
              { required: true, message: "请粘贴攻略正文" },
              { min: 20, message: "内容太短，请粘贴完整攻略" },
            ]}
          >
            <Input.TextArea
              rows={8}
              placeholder={`粘贴攻略文字，例如：\n成都3天2晚保姆级攻略🔥\nDay1：宽窄巷子→人民公园喝茶→春熙路\nDay2：大熊猫基地（一定要早去！）→文殊院→建设路小吃\n…`}
              maxLength={12000}
              showCount
            />
          </Form.Item>
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
              label="出发日期"
              name="startDate"
              rules={[{ required: true, message: "请选择出发日期" }]}
              style={{ flex: 1 }}
            >
              <DatePicker style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="天数（选填）" name="days" style={{ flex: 1 }} extra="留空由 AI 按攻略判断">
              <InputNumber min={1} max={30} style={{ width: "100%" }} placeholder="自动" />
            </Form.Item>
          </div>
          <Button type="primary" block size="large" icon={<ReadOutlined />} onClick={handleParse}>
            解析攻略
          </Button>
        </Form>
      )}

      {phase === "generating" && (
        <Space direction="vertical" size="middle" style={{ display: "flex" }}>
          <Alert type="info" showIcon message={status || "解析中…"} />
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
            取消
          </Button>
        </Space>
      )}

      {phase === "preview" && plan && (
        <Space direction="vertical" size="middle" style={{ display: "flex" }}>
          <div style={{ maxHeight: 420, overflowY: "auto" }}>
            <AiPlanPreview
              plan={plan}
              startDate={paramsRef.current ? dayjs(paramsRef.current.startDate) : undefined}
            />
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <Button onClick={() => setPhase("form")}>返回修改</Button>
            <Button type="primary" style={{ flex: 1 }} loading={importing} onClick={handleImport}>
              导入为行程
            </Button>
          </div>
        </Space>
      )}
    </Modal>
  );
}
