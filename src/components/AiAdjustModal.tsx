"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, App, Button, Input, Modal, Space } from "antd";
import { RobotOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import AiDiffPreview from "@/components/AiDiffPreview";
import { composeApplyItems, diffPlan } from "@/lib/ai/diff";
import { postSse } from "@/lib/sse-client";
import type { AiPlan, TripDetail } from "@/types";

interface Props {
  open: boolean;
  trip: TripDetail;
  onCancel: () => void;
  onApplied: () => void;
}

type Phase = "form" | "generating" | "preview";

export default function AiAdjustModal({ open, trip, onCancel, onApplied }: Props) {
  const { message } = App.useApp();
  const [phase, setPhase] = useState<Phase>("form");
  const [instruction, setInstruction] = useState("");
  const [status, setStatus] = useState("");
  const [streamText, setStreamText] = useState("");
  const [plan, setPlan] = useState<AiPlan | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const preRef = useRef<HTMLPreElement>(null);

  // 对比：AI 方案 vs 现有行程
  const entries = useMemo(
    () => (plan ? diffPlan(trip.items, plan) : []),
    [plan, trip.items],
  );

  // 方案到达时默认全选所有变更
  useEffect(() => {
    setSelected(new Set(entries.filter((e) => e.kind !== "unchanged").map((e) => e.key)));
  }, [entries]);

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

  const handleGenerate = async () => {
    if (!instruction.trim()) {
      message.warning("请先填写调整要求");
      return;
    }
    setPhase("generating");
    setStreamText("");
    setStatus("正在连接 AI 服务…");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await postSse(
        "/api/ai/adjust",
        { tripId: trip.id, instruction },
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
      setPhase((p) => (p === "generating" ? "form" : p));
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        message.error(err instanceof Error ? err.message : "生成失败", 6);
      }
      setPhase("form");
    }
  };

  const selectedCount = entries.filter(
    (e) => e.kind !== "unchanged" && selected.has(e.key),
  ).length;
  const changedCount = entries.filter((e) => e.kind !== "unchanged").length;

  const handleApply = async () => {
    if (!plan || selectedCount === 0) return;
    setApplying(true);
    try {
      const items = composeApplyItems(entries, selected, plan.days.length);
      const res = await fetch(`/api/trips/${trip.id}/apply-items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error);
      message.success(`已应用 ${selectedCount} 项变更`);
      onApplied();
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : "应用失败");
    } finally {
      setApplying(false);
    }
  };

  return (
    <Modal
      title={
        <span>
          <RobotOutlined style={{ color: "#1677ff", marginRight: 8 }} />
          AI 调整行程
        </span>
      }
      open={open}
      onCancel={() => {
        abortRef.current?.abort();
        onCancel();
      }}
      width={800}
      footer={null}
      forceRender
    >
      {phase === "form" && (
        <Space direction="vertical" size="middle" style={{ display: "flex" }}>
          <Alert
            type="info"
            showIcon
            message="生成后会展示与现有行程的逐项对比，由你勾选要应用的变更"
            description="未勾选的内容保持原样；被保留和被修改的行程项不影响已有的开销关联。"
          />
          <Input.TextArea
            rows={4}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder={`告诉 AI 你想怎么调整，例如：\n· 第 2 天太赶了，减少一个景点，节奏放慢\n· 把美食安排换成本地老字号\n· 第 3 天改成亲子主题`}
            maxLength={500}
          />
          <Button type="primary" block icon={<RobotOutlined />} onClick={handleGenerate}>
            生成调整方案
          </Button>
        </Space>
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
            取消
          </Button>
        </Space>
      )}

      {phase === "preview" && plan && (
        <Space direction="vertical" size="middle" style={{ display: "flex" }}>
          <div style={{ maxHeight: 440, overflowY: "auto" }}>
            <AiDiffPreview
              entries={entries}
              startDate={dayjs(trip.startDate)}
              selected={selected}
              onSelectionChange={setSelected}
            />
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <Button onClick={() => setPhase("form")}>返回修改要求</Button>
            <Button
              type="primary"
              style={{ flex: 1 }}
              loading={applying}
              disabled={changedCount === 0 || selectedCount === 0}
              onClick={handleApply}
            >
              {changedCount === 0
                ? "没有可应用的变更"
                : `应用已选变更（${selectedCount}/${changedCount} 项）`}
            </Button>
          </div>
        </Space>
      )}
    </Modal>
  );
}
