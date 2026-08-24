"use client";

// 独立方案自检弹窗：让 AI 审查现有行程的动线顺路与时段合理性，展示 diff 供勾选应用
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, App, Button, Modal, Space } from "antd";
import { RobotOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import AiDiffPreview from "@/components/AiDiffPreview";
import WorkflowSteps, { type WorkflowStepItem } from "@/components/WorkflowSteps";
import { composeApplyItems, diffPlan } from "@/lib/ai/diff";
import { postSse } from "@/lib/sse-client";
import type { AiPlan, TripDetail } from "@/types";

interface Props {
  open: boolean;
  trip: TripDetail;
  onCancel: () => void;
  onApplied: () => void;
}

type Phase = "running" | "preview";

export default function AiSelfCheckModal({ open, trip, onCancel, onApplied }: Props) {
  const { message } = App.useApp();
  const [phase, setPhase] = useState<Phase>("running");
  const [steps, setSteps] = useState<WorkflowStepItem[]>([]);
  const [status, setStatus] = useState("");
  const [plan, setPlan] = useState<AiPlan | null>(null);
  const [summary, setSummary] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const startedRef = useRef(false);

  // 对比：自检后方案 vs 现有行程（自检不涉及 focusDays 过滤，直接 diff）
  const entries = useMemo(
    () => (plan ? diffPlan(trip.items, plan) : []),
    [plan, trip.items],
  );

  // 方案到达时默认全选 added 和 modified
  useEffect(() => {
    setSelected(new Set(entries.filter((e) => e.kind === "added" || e.kind === "modified").map((e) => e.key)));
  }, [entries]);

  const run = async () => {
    setPhase("running");
    setError(null);
    setPlan(null);
    setSteps([]);
    setSummary("");
    setStatus("正在连接 AI 服务…");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await postSse(
        "/api/ai/selfcheck",
        { tripId: trip.id },
        (event) => {
          if (event.type === "step" && event.id) {
            const entry: WorkflowStepItem = {
              id: event.id,
              label: event.label ?? event.id,
              status: event.status === "start" ? "running" : event.status === "error" ? "error" : "done",
              detail: event.detail,
            };
            setSteps((prev) => {
              const idx = prev.findIndex((s) => s.id === entry.id);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = entry;
                return next;
              }
              return [...prev, entry];
            });
          } else if (event.type === "status" && event.text) {
            setStatus(event.text);
          } else if (event.type === "result" && event.plan) {
            setPlan(event.plan as AiPlan);
            setSummary((event.summary as string) ?? "");
            setPhase("preview");
          } else if (event.type === "error") {
            setError(event.message ?? "自检失败");
            setPhase("running");
          }
        },
        controller.signal,
      );
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(err instanceof Error ? err.message : "自检失败");
      }
    }
  };

  useEffect(() => {
    if (open && !startedRef.current) {
      startedRef.current = true;
      run();
    }
    if (!open) {
      abortRef.current?.abort();
      startedRef.current = false;
      setPhase("running");
      setPlan(null);
      setSteps([]);
      setStatus("");
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const selectedCount = entries.filter((e) => e.kind !== "unchanged" && selected.has(e.key)).length;
  const changedCount = entries.filter((e) => e.kind !== "unchanged").length;

  const handleApply = async () => {
    if (!plan || selectedCount === 0) return;
    // 安全检查：entries 必须包含足够原始项，防止 diff 逻辑异常导致全量删除
    const oldItemCount = trip.items.length;
    const entriesWithOld = entries.filter((e) => e.oldItem).length;
    if (oldItemCount > 0 && entriesWithOld === 0) {
      message.error("对比数据异常（原始项全部丢失），已阻止应用以保护数据，请重新自检");
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
          <RobotOutlined style={{ color: "#0d9488", marginRight: 8 }} />
          方案自检
        </span>
      }
      open={open}
      width={800}
      onCancel={() => {
        abortRef.current?.abort();
        onCancel();
      }}
      footer={null}
      forceRender
    >
      {phase === "running" && (
        <Space direction="vertical" size="middle" style={{ display: "flex" }}>
          {error ? (
            <>
              <Alert type="error" showIcon message={error} />
              <Button type="primary" block onClick={() => { setError(null); run(); }}>
                重新自检
              </Button>
            </>
          ) : (
            <>
              <WorkflowSteps steps={steps} />
              <Alert type="info" showIcon message={status || "自检中…"} />
            </>
          )}
        </Space>
      )}

      {phase === "preview" && plan && (
        <Space direction="vertical" size="middle" style={{ display: "flex" }}>
          {summary && (
            <Alert type={changedCount > 0 ? "info" : "success"} showIcon message={summary} />
          )}
          {changedCount === 0 ? (
            <Alert type="success" showIcon message="AI 认为现有行程无需调整" />
          ) : (
            <div style={{ maxHeight: 440, overflowY: "auto" }}>
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
          <div style={{ display: "flex", gap: 12 }}>
            <Button onClick={() => { setError(null); run(); }}>
              重新自检
            </Button>
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
