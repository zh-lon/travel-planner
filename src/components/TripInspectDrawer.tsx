"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, Button, Collapse, Drawer, Empty, Result, Space, Tag, Typography } from "antd";
import { SafetyCertificateOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { postSse } from "@/lib/sse-client";
import type { InspectFinding, InspectLevel } from "@/lib/ai/inspect";
import type { TripDetail } from "@/types";

interface Props {
  open: boolean;
  trip: TripDetail;
  onClose: () => void;
}

const LEVEL_META: Record<InspectLevel, { color: string; label: string }> = {
  red: { color: "red", label: "严重" },
  yellow: { color: "gold", label: "提醒" },
  green: { color: "green", label: "正常" },
};

const CHECK_LABEL: Record<InspectFinding["check"], string> = {
  "time-conflict": "时间冲突",
  order: "顺序",
  transit: "交通衔接",
  opening: "开放时间",
  weather: "天气",
  missing: "信息缺失",
  lodging: "住宿",
};

export default function TripInspectDrawer({ open, trip, onClose }: Props) {
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [streamText, setStreamText] = useState("");
  const [findings, setFindings] = useState<InspectFinding[] | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const startedRef = useRef(false);

  const run = async () => {
    setRunning(true);
    setError(null);
    setFindings(null);
    setNotes([]);
    setStreamText("");
    setStatus("正在体检…");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await postSse(
        `/api/trips/${trip.id}/inspect`,
        {},
        (event) => {
          if (event.type === "status" && event.text) setStatus(event.text);
          else if (event.type === "delta" && event.text) {
            setStreamText((prev) => (prev + event.text).slice(-4000));
          } else if (event.type === "result") {
            setFindings((event.findings as InspectFinding[]) ?? []);
            setNotes(event.notes ?? []);
          } else if (event.type === "error") {
            setError(event.message ?? "体检失败");
          }
        },
        controller.signal,
      );
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(err instanceof Error ? err.message : "体检失败");
      }
    } finally {
      setRunning(false);
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [streamText, status]);

  const redCount = findings?.filter((f) => f.level === "red").length ?? 0;
  const yellowCount = findings?.filter((f) => f.level === "yellow").length ?? 0;
  const dayCount = dayjs(trip.endDate).diff(dayjs(trip.startDate), "day") + 1;
  const byDay = new Map<number, InspectFinding[]>();
  for (const f of findings ?? []) {
    const arr = byDay.get(f.dayIndex) ?? [];
    arr.push(f);
    byDay.set(f.dayIndex, arr);
  }

  return (
    <Drawer
      title={
        <span>
          <SafetyCertificateOutlined style={{ color: "#0d9488", marginRight: 8 }} />
          出发前行程体检
        </span>
      }
      open={open}
      onClose={() => {
        abortRef.current?.abort();
        onClose();
      }}
      width={560}
      extra={
        <Button size="small" onClick={run} loading={running}>
          重新体检
        </Button>
      }
    >
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}

      {running && (
        <Space direction="vertical" size="middle" style={{ display: "flex" }}>
          <Alert type="info" showIcon message={status || "体检中…"} />
          {streamText && (
            <pre
              ref={preRef}
              style={{
                maxHeight: 260,
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
              {streamText}
            </pre>
          )}
        </Space>
      )}

      {!running && findings && (
        <Space direction="vertical" size="middle" style={{ display: "flex" }}>
          {findings.length === 0 ? (
            <Result
              status="success"
              title="体检通过"
              subTitle="没有发现明显问题，可以放心出发！"
            />
          ) : (
            <Alert
              type={redCount > 0 ? "error" : "warning"}
              showIcon
              message={
                <>
                  发现 {redCount > 0 && <Tag color="red">{redCount} 个严重问题</Tag>}
                  {yellowCount > 0 && <Tag color="gold">{yellowCount} 个提醒</Tag>}
                </>
              }
            />
          )}
          {notes.map((n, i) => (
            <Alert key={i} type="info" showIcon message={n} />
          ))}
          {findings.length > 0 && (
            <Collapse
              defaultActiveKey={Array.from(byDay.keys()).map(String)}
              items={Array.from({ length: dayCount }, (_, d) => d)
                .filter((d) => byDay.has(d))
                .map((d) => {
                  const dayFindings = byDay.get(d)!;
                  return {
                    key: String(d),
                    label: (
                      <span>
                        第 {d + 1} 天 · {dayjs(trip.startDate).add(d, "day").format("M月D日")}
                        <Tag style={{ marginLeft: 8 }} color={dayFindings.some((f) => f.level === "red") ? "red" : "gold"}>
                          {dayFindings.length} 项
                        </Tag>
                      </span>
                    ),
                    children: (
                      <Space direction="vertical" size="small" style={{ display: "flex" }}>
                        {dayFindings.map((f) => (
                          <div
                            key={f.id}
                            style={{
                              border: "1px solid #f0f0f0",
                              borderRadius: 8,
                              padding: "8px 12px",
                            }}
                          >
                            <div>
                              <Tag color={LEVEL_META[f.level].color}>{LEVEL_META[f.level].label}</Tag>
                              <Tag>{CHECK_LABEL[f.check]}</Tag>
                              {f.source === "ai" && <Tag color="purple">AI</Tag>}
                            </div>
                            <Typography.Text style={{ display: "block", marginTop: 6 }}>
                              {f.message}
                            </Typography.Text>
                            {f.suggestion && (
                              <Typography.Text type="secondary" style={{ display: "block", marginTop: 2 }}>
                                建议：{f.suggestion}
                              </Typography.Text>
                            )}
                          </div>
                        ))}
                      </Space>
                    ),
                  };
                })}
            />
          )}
        </Space>
      )}

      {!running && !findings && !error && (
        <Empty description="点击「重新体检」开始检查" style={{ marginTop: 48 }} />
      )}
    </Drawer>
  );
}
