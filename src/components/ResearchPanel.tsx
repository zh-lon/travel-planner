"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, App, Button, Empty, Popconfirm, Space, Typography } from "antd";
import { GlobalOutlined, ReloadOutlined, DeleteOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import ReactMarkdown from "react-markdown";
import { postSse } from "@/lib/sse-client";
import type { TripDetail } from "@/types";

interface Props {
  trip: TripDetail;
  readOnly?: boolean;
  onChanged: () => void; // 研究完成/删除后刷新行程
}

// 联网攻略研究：搜索目的地攻略与各景点评价 → AI 总结存档
export default function ResearchPanel({ trip, readOnly, onChanged }: Props) {
  const { message } = App.useApp();
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [streamText, setStreamText] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [streamText, status]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = async () => {
    setRunning(true);
    setStreamText("");
    setStatus("正在准备…");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await postSse(
        `/api/trips/${trip.id}/research`,
        {},
        (event) => {
          if (event.type === "status" && event.text) setStatus(event.text);
          else if (event.type === "delta" && event.text) setStreamText((prev) => prev + event.text);
          else if (event.type === "result") {
            message.success("研究完成，已保存");
            onChanged();
          } else if (event.type === "error") {
            message.error(event.message ?? "研究失败", 8);
          }
        },
        controller.signal,
      );
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        message.error(err instanceof Error ? err.message : "研究失败", 8);
      }
    } finally {
      setRunning(false);
    }
  };

  const remove = async () => {
    const res = await fetch(`/api/trips/${trip.id}/research`, { method: "DELETE" }).catch(() => null);
    if (res?.ok) {
      message.success("已删除研究结果");
      onChanged();
    } else {
      message.error("删除失败");
    }
  };

  if (running) {
    return (
      <Space direction="vertical" size="middle" style={{ display: "flex" }}>
        <Alert type="info" showIcon message={status || "研究中…"} />
        <pre
          ref={preRef}
          style={{
            maxHeight: 420,
            overflowY: "auto",
            background: "#fafafa",
            border: "1px solid #f0f0f0",
            borderRadius: 8,
            padding: 12,
            fontSize: 12,
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            margin: 0,
            minHeight: 120,
          }}
        >
          {streamText || "正在联网搜索资料…"}
        </pre>
        <Button
          block
          onClick={() => {
            abortRef.current?.abort();
            setRunning(false);
          }}
        >
          取消
        </Button>
      </Space>
    );
  }

  if (!trip.researchSummary) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <span>
            还没有研究结果
            <br />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              自动联网搜索目的地攻略与各景点的网友评价，由 AI 总结成一份带来源的参考报告
              <br />
              （需管理员在设置页配置「联网搜索」服务）
            </Typography.Text>
          </span>
        }
        style={{ padding: "40px 0" }}
      >
        {!readOnly && (
          <Button type="primary" icon={<GlobalOutlined />} onClick={run}>
            开始联网研究
          </Button>
        )}
      </Empty>
    );
  }

  return (
    <Space direction="vertical" size="middle" style={{ display: "flex" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          研究于 {trip.researchAt ? dayjs(trip.researchAt).format("YYYY年M月D日 HH:mm") : "—"} ·
          内容由网络搜索与 AI 总结生成，仅供参考
        </Typography.Text>
        <span style={{ flex: 1 }} />
        {!readOnly && (
          <>
            <Button size="small" icon={<ReloadOutlined />} onClick={run}>
              重新研究
            </Button>
            <Popconfirm title="删除研究结果？" okText="删除" okButtonProps={{ danger: true }} cancelText="取消" onConfirm={remove}>
              <Button size="small" danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          </>
        )}
      </div>
      <Typography style={{ maxWidth: 860 }}>
        <ReactMarkdown
          components={{
            a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
          }}
        >
          {trip.researchSummary}
        </ReactMarkdown>
      </Typography>
    </Space>
  );
}
