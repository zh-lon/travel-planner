"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  App,
  Button,
  Checkbox,
  Drawer,
  Empty,
  Input,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  CheckOutlined,
  EnvironmentOutlined,
  GlobalOutlined,
  MessageOutlined,
  SendOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { postSse } from "@/lib/sse-client";
import { ITEM_TYPES } from "@/types/constants";
import type { AiPlanItem, ItineraryItemT, TripDetail } from "@/types";

interface Props {
  open: boolean;
  trip: TripDetail;
  onClose: () => void;
}

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

interface Proposal {
  dayIndex: number;
  theme: string | null;
  items: AiPlanItem[];
}

interface OverviewSegment {
  dayStart: number; // 1-based
  dayEnd: number; // 1-based
  city: string;
  summary: string;
}

export default function CoplanDrawer({ open, trip, onClose }: Props) {
  const { message } = App.useApp();
  const dayCount = dayjs(trip.endDate).diff(dayjs(trip.startDate), "day") + 1;
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [focusDay, setFocusDay] = useState(0);
  const [confirmedDays, setConfirmedDays] = useState<Set<number>>(new Set());
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [items, setItems] = useState<ItineraryItemT[]>(trip.items);
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState("");
  const [streamText, setStreamText] = useState("");
  const [applying, setApplying] = useState(false);
  // SSR 安全：用 state 存窗口宽度，避免 hydration 时 window.innerWidth 与服务端不一致
  const [windowWidth, setWindowWidth] = useState(980);
  useEffect(() => {
    setWindowWidth(window.innerWidth);
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // 概览阶段状态
  const [overview, setOverview] = useState<OverviewSegment[] | null>(null);
  const [overviewReply, setOverviewReply] = useState("");
  const [overviewConfirmed, setOverviewConfirmed] = useState(false);

  // 网络搜索开关
  const [webSearch, setWebSearch] = useState(false);
  const [searchPlatform, setSearchPlatform] = useState("all");

  const PLATFORM_OPTIONS = [
    { value: "all", label: "全网" },
    { value: "xiaohongshu", label: "小红书" },
    { value: "mafengwo", label: "马蜂窝" },
    { value: "ctrip", label: "携程" },
    { value: "dianping", label: "大众点评" },
  ];

  const abortRef = useRef<AbortController | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setItems(trip.items);
      // 默认聚焦到第一个还没有安排的天
      const firstEmpty = Array.from({ length: dayCount }, (_, d) => d).find(
        (d) => !trip.items.some((i) => i.dayIndex === d),
      );
      setFocusDay(firstEmpty ?? 0);

      // 如果行程已有内容，自动跳过概览阶段，直接进入逐天规划
      const hasExistingItems = trip.items.length > 0;
      if (hasExistingItems) {
        // 将已有安排的天标记为已确认
        const confirmed = new Set<number>();
        for (let d = 0; d < dayCount; d++) {
          if (trip.items.some((i) => i.dayIndex === d)) {
            confirmed.add(d);
          }
        }
        setConfirmedDays(confirmed);
        setOverviewConfirmed(true);
      } else if (!overview) {
        // 全新行程：发起概览请求
        fetchOverview();
      }
    } else {
      // 仅中断请求，保留聊天记录和概览状态
      abortRef.current?.abort();
      setGenerating(false);
      setStreamText("");
      setStatus("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamText, status]);

  const confirmedPayload = useMemo(
    () =>
      Array.from(confirmedDays).map((d) => ({
        dayIndex: d,
        items: items
          .filter((i) => i.dayIndex === d)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((i) => ({
            type: i.type,
            title: i.title,
            startTime: i.startTime,
            endTime: i.endTime,
            placeName: i.placeName,
            estimatedCost: i.estimatedCost,
            notes: i.notes,
            lng: i.lng,
            lat: i.lat,
            address: i.address,
          })),
      })),
    [confirmedDays, items],
  );

  // 概览请求：进入时自动调用
  const fetchOverview = async () => {
    setGenerating(true);
    setStreamText("");
    setStatus("正在生成行程概览…");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await postSse(
        "/api/ai/coplan",
        {
          mode: "overview",
          destination: trip.destination,
          startDate: dayjs(trip.startDate).format("YYYY-MM-DD"),
          days: dayCount,
          webSearch,
          searchPlatform,
        },
        (event) => {
          if (event.type === "status" && event.text) setStatus(event.text);
          else if (event.type === "delta" && event.text) {
            setStreamText((prev) => (prev + event.text).slice(-2000));
          } else if (event.type === "result") {
            const reply = event.reply ?? "";
            if (reply) setOverviewReply(reply);
            const segs = (event.overview as OverviewSegment[] | null) ?? null;
            if (segs) setOverview(segs);
          } else if (event.type === "error") {
            message.error(event.message ?? "生成概览失败", 6);
          }
        },
        controller.signal,
      );
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        message.error(err instanceof Error ? err.message : "生成概览失败", 6);
      }
    } finally {
      setGenerating(false);
      setStreamText("");
      setStatus("");
    }
  };

  const send = async (text: string, day = focusDay) => {
    const userText = text.trim();
    if (!userText || generating) return;
    const nextMessages: ChatMsg[] = [...messages, { role: "user", content: userText }];
    setMessages(nextMessages);
    setInput("");
    setGenerating(true);
    setStreamText("");
    setStatus("正在连接 AI 服务…");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await postSse(
        "/api/ai/coplan",
        {
          destination: trip.destination,
          startDate: dayjs(trip.startDate).format("YYYY-MM-DD"),
          days: dayCount,
          focusDay: day,
          confirmedDays: confirmedPayload,
          messages: nextMessages,
          webSearch,
          searchPlatform,
        },
        (event) => {
          if (event.type === "status" && event.text) setStatus(event.text);
          else if (event.type === "delta" && event.text) {
            setStreamText((prev) => (prev + event.text).slice(-2000));
          } else if (event.type === "result") {
            const reply = event.reply ?? "";
            if (reply) setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
            const p = (event.proposal as Proposal | null) ?? null;
            if (p) {
              setProposal(p);
              setChecked(new Set(p.items.map((_, idx) => idx)));
            }
          } else if (event.type === "error") {
            message.error(event.message ?? "生成失败", 6);
          }
        },
        controller.signal,
      );
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        message.error(err instanceof Error ? err.message : "生成失败", 6);
      }
    } finally {
      setGenerating(false);
      setStreamText("");
      setStatus("");
    }
  };

  const refreshItems = async () => {
    try {
      const res = await fetch(`/api/trips/${trip.id}`);
      if (res.ok) {
        const data = (await res.json()) as TripDetail;
        setItems(data.items);
        return data.items;
      }
    } catch {
      // 忽略，保留本地状态
    }
    return null;
  };

  const handleConfirmDay = async () => {
    if (!proposal) return;
    const kept = proposal.items.filter((_, idx) => checked.has(idx));
    if (kept.length === 0) {
      message.warning("请至少保留一个行程项");
      return;
    }
    setApplying(true);
    try {
      // 全集提交：其他天的现有条目原样保留（带 id），当前天替换为勾选的提议项
      const others = items
        .filter((i) => i.dayIndex !== proposal.dayIndex)
        .map((i) => ({
          id: i.id,
          dayIndex: i.dayIndex,
          sortOrder: i.sortOrder,
          type: i.type,
          title: i.title,
          startTime: i.startTime,
          endTime: i.endTime,
          placeName: i.placeName,
          lng: i.lng,
          lat: i.lat,
          address: i.address,
          estimatedCost: i.estimatedCost,
          needBooking: i.needBooking === true,
          notes: i.notes,
          aiGenerated: i.aiGenerated,
        }));
      const fresh = kept.map((item, idx) => ({
        dayIndex: proposal.dayIndex,
        sortOrder: idx,
        type: item.type,
        title: item.title,
        startTime: item.startTime,
        endTime: item.endTime,
        placeName: item.placeName,
        lng: item.lng,
        lat: item.lat,
        address: item.address,
        estimatedCost: item.estimatedCost,
        needBooking: item.needBooking === true,
        notes: item.notes,
        aiGenerated: true,
      }));
      const res = await fetch(`/api/trips/${trip.id}/apply-items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: [...others, ...fresh] }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error);
      message.success(`第 ${proposal.dayIndex + 1} 天已确认（${kept.length} 项）`);
      const confirmed = new Set(confirmedDays).add(proposal.dayIndex);
      setConfirmedDays(confirmed);
      setProposal(null);
      await refreshItems();
      // 推进到下一个未确认天并自动发起规划
      const next = Array.from({ length: dayCount }, (_, d) => d).find(
        (d) => d > proposal.dayIndex && !confirmed.has(d),
      );
      if (next != null) {
        setFocusDay(next);
        send(`第 ${proposal.dayIndex + 1} 天已确认，请继续规划第 ${next + 1} 天。`, next);
      } else {
        message.success("所有天都已规划完成！");
      }
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : "应用失败");
    } finally {
      setApplying(false);
    }
  };

  const handleClose = () => {
    abortRef.current?.abort();
    onClose();
  };

  const typeLabel = (t: string) => ITEM_TYPES.find((x) => x.value === t)?.label ?? t;
  const startDay = dayjs(trip.startDate);

  const formatDateRange = (seg: OverviewSegment) => {
    const d1 = startDay.add(seg.dayStart - 1, "day").format("M月D日");
    if (seg.dayStart === seg.dayEnd) return `第${seg.dayStart}天 · ${d1}`;
    const d2 = startDay.add(seg.dayEnd - 1, "day").format("M月D日");
    return `第${seg.dayStart}-${seg.dayEnd}天 · ${d1}~${d2}`;
  };

  return (
    <Drawer
      title={
        <span>
          <MessageOutlined style={{ color: "#0d9488", marginRight: 8 }} />
          共同创作 · 和 AI 一起逐天搭行程
        </span>
      }
      open={open}
      onClose={handleClose}
      width={Math.min(980, windowWidth)}
      styles={{ body: { padding: 0, display: "flex", flexDirection: "column" } }}
    >
      {/* 天数步进条 */}
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: "12px 16px",
          borderBottom: "1px solid #f0f0f0",
          overflowX: "auto",
        }}
      >
        {Array.from({ length: dayCount }, (_, d) => {
          const hasItems = items.some((i) => i.dayIndex === d);
          return (
            <Button
              key={d}
              size="small"
              type={focusDay === d ? "primary" : "default"}
              onClick={() => setFocusDay(d)}
              icon={confirmedDays.has(d) ? <CheckOutlined /> : undefined}
            >
              Day {d + 1}
              {!confirmedDays.has(d) && hasItems ? " ·已有安排" : ""}
            </Button>
          );
        })}
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* 左：聊天 */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            borderRight: "1px solid #f0f0f0",
            minWidth: 0,
          }}
        >
          <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
            {/* 概览阶段：空状态 */}
            {messages.length === 0 && !overviewConfirmed && (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <span>
                    AI 正在为你的 {dayCount} 天行程
                    <br />
                    生成整体概览，请稍候…
                  </span>
                }
              />
            )}
            {/* 概览阶段：生成中 */}
            {messages.length === 0 && !overviewConfirmed && generating && (
              <div style={{ marginBottom: 10 }}>
                <Alert type="info" showIcon message={status || "生成中…"} />
                {streamText && (
                  <pre
                    style={{
                      maxHeight: 140,
                      overflowY: "auto",
                      background: "#fafafa",
                      border: "1px solid #f0f0f0",
                      borderRadius: 8,
                      padding: 8,
                      fontSize: 12,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                      marginTop: 8,
                      marginBottom: 0,
                    }}
                  >
                    {streamText}
                  </pre>
                )}
              </div>
            )}
            {/* 逐天阶段：空状态 */}
            {messages.length === 0 && overviewConfirmed && !generating && (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <span>
                    说说第 {focusDay + 1} 天（
                    {startDay.add(focusDay, "day").format("M月D日")}）想怎么玩，
                    <br />
                    或直接让 AI 提议
                  </span>
                }
              >
                <Button
                  type="primary"
                  onClick={() =>
                    send(`请为第 ${focusDay + 1} 天给出行程提议，节奏适中、动线合理。`)
                  }
                >
                  让 AI 先提议这一天
                </Button>
              </Empty>
            )}
            {messages.map((m, idx) => (
              <div
                key={idx}
                style={{
                  display: "flex",
                  justifyContent: m.role === "user" ? "flex-end" : "flex-start",
                  marginBottom: 10,
                }}
              >
                <div
                  style={{
                    maxWidth: "82%",
                    padding: "8px 12px",
                    borderRadius: 10,
                    fontSize: 13,
                    whiteSpace: "pre-wrap",
                    background: m.role === "user" ? "#0d9488" : "#f5f5f5",
                    color: m.role === "user" ? "#fff" : undefined,
                  }}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {generating && overviewConfirmed && messages.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <Alert type="info" showIcon message={status || "生成中…"} />
                {streamText && (
                  <pre
                    style={{
                      maxHeight: 140,
                      overflowY: "auto",
                      background: "#fafafa",
                      border: "1px solid #f0f0f0",
                      borderRadius: 8,
                      padding: 8,
                      fontSize: 12,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                      marginTop: 8,
                      marginBottom: 0,
                    }}
                  >
                    {streamText}
                  </pre>
                )}
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
          <div style={{ padding: 12, borderTop: "1px solid #f0f0f0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <Tooltip title="启用后 AI 对话前会先联网搜索参考信息，生成更贴近实际的行程建议" placement="topLeft">
                <Space size={6}>
                  <GlobalOutlined style={{ color: webSearch ? "#0d9488" : "#bfbfbf", fontSize: 14 }} />
                  <Typography.Text style={{ fontSize: 12, color: webSearch ? "#0d9488" : "rgba(0,0,0,0.45)" }}>
                    联网搜索
                  </Typography.Text>
                  <Switch size="small" checked={webSearch} onChange={setWebSearch} disabled={generating} />
                </Space>
              </Tooltip>
              {webSearch && (
                <Select
                  size="small"
                  variant="filled"
                  value={searchPlatform}
                  onChange={setSearchPlatform}
                  disabled={generating}
                  style={{ width: 100, fontSize: 12 }}
                  options={PLATFORM_OPTIONS}
                />
              )}
            </div>
            <Space.Compact style={{ width: "100%" }}>
              <Input.TextArea
                autoSize={{ minRows: 1, maxRows: 4 }}
                value={input}
                disabled={generating || !overviewConfirmed}
                onChange={(e) => setInput(e.target.value)}
                onPressEnter={(e) => {
                  if (!e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                placeholder={`和 AI 聊第 ${focusDay + 1} 天的安排，如：想去都江堰，早上出发，别太赶`}
              />
              <Button
                type="primary"
                icon={<SendOutlined />}
                loading={generating}
                disabled={!overviewConfirmed}
                onClick={() => send(input)}
              />
            </Space.Compact>
          </div>
        </div>

        {/* 右：概览 / 当前提议 */}
        <div style={{ width: 380, display: "flex", flexDirection: "column", flexShrink: 0 }}>
          <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
            {/* 概览阶段 */}
            {!overviewConfirmed && (
              <Space direction="vertical" size="small" style={{ display: "flex" }}>
                <Typography.Text strong>
                  <EnvironmentOutlined style={{ color: "#0d9488", marginRight: 6 }} />
                  行程概览
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  AI 拟定的整体行程框架，确认后进入逐天细化
                </Typography.Text>
                {overviewReply && (
                  <Alert type="info" showIcon message={overviewReply} style={{ fontSize: 13 }} />
                )}
                {generating && !overview && (
                  <div style={{ textAlign: "center", padding: "40px 0" }}>
                    <Alert type="info" showIcon message={status || "生成中…"} />
                    {streamText && (
                      <pre
                        style={{
                          maxHeight: 140,
                          overflowY: "auto",
                          background: "#fafafa",
                          border: "1px solid #f0f0f0",
                          borderRadius: 8,
                          padding: 8,
                          fontSize: 12,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-all",
                          marginTop: 8,
                          marginBottom: 0,
                        }}
                      >
                        {streamText}
                      </pre>
                    )}
                  </div>
                )}
                {overview?.map((seg, idx) => (
                  <div
                    key={idx}
                    style={{
                      border: "1px solid #e6f7f5",
                      borderLeft: "3px solid #0d9488",
                      borderRadius: 8,
                      padding: "10px 12px",
                      background: "#fafafa",
                    }}
                  >
                    <Space size={6} wrap>
                      <Tag color="teal">{formatDateRange(seg)}</Tag>
                      <Typography.Text strong>{seg.city}</Typography.Text>
                    </Space>
                    <div style={{ marginTop: 4, fontSize: 12, color: "rgba(0,0,0,0.65)" }}>
                      {seg.summary}
                    </div>
                  </div>
                ))}
              </Space>
            )}
            {/* 逐天提议阶段 */}
            {overviewConfirmed && (
              <Space direction="vertical" size="small" style={{ display: "flex" }}>
                <Typography.Text strong>
                  第 {focusDay + 1} 天提议
                  {proposal?.theme ? ` · ${proposal.theme}` : ""}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  勾选要保留的行程项，也可以在左侧继续提修改意见
                </Typography.Text>
                {items.some((i) => i.dayIndex === (proposal?.dayIndex ?? -1)) && (
                  <Alert
                    type="warning"
                    showIcon
                    message={`确认后将替换第 ${(proposal?.dayIndex ?? 0) + 1} 天现有的 ${items.filter((i) => i.dayIndex === (proposal?.dayIndex ?? -1)).length} 个安排`}
                  />
                )}
                {proposal?.items.map((item, idx) => (
                  <div
                    key={idx}
                    style={{
                      border: "1px solid #f0f0f0",
                      borderRadius: 8,
                      padding: "8px 12px",
                      opacity: checked.has(idx) ? 1 : 0.5,
                    }}
                  >
                    <Checkbox
                      checked={checked.has(idx)}
                      onChange={(e) => {
                        const next = new Set(checked);
                        if (e.target.checked) next.add(idx);
                        else next.delete(idx);
                        setChecked(next);
                      }}
                    >
                      <Space size={6} wrap>
                        <Tag>{typeLabel(item.type)}</Tag>
                        <Typography.Text strong>{item.title}</Typography.Text>
                      </Space>
                    </Checkbox>
                    <div style={{ marginLeft: 24, fontSize: 12, color: "rgba(0,0,0,0.45)" }}>
                      {[
                        item.startTime && `${item.startTime}${item.endTime ? `–${item.endTime}` : ""}`,
                        item.placeName,
                        item.estimatedCost != null && item.estimatedCost > 0
                          ? `¥${item.estimatedCost}/人`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      {item.notes && <div>{item.notes}</div>}
                      {item.placeName && item.lng == null && (
                        <Tag color="orange" style={{ marginTop: 4 }}>
                          未匹配到坐标
                        </Tag>
                      )}
                    </div>
                  </div>
                ))}
              </Space>
            )}
            {/* 空状态：逐天阶段无提议时 */}
            {overviewConfirmed && !proposal && !generating && (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="AI 的行程提议会显示在这里"
                style={{ marginTop: 60 }}
              />
            )}
            {/* 逐天阶段生成中 */}
            {overviewConfirmed && generating && (
              <div style={{ marginBottom: 10 }}>
                <Alert type="info" showIcon message={status || "生成中…"} />
                {streamText && (
                  <pre
                    style={{
                      maxHeight: 140,
                      overflowY: "auto",
                      background: "#fafafa",
                      border: "1px solid #f0f0f0",
                      borderRadius: 8,
                      padding: 8,
                      fontSize: 12,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                      marginTop: 8,
                      marginBottom: 0,
                    }}
                  >
                    {streamText}
                  </pre>
                )}
              </div>
            )}
          </div>
          {/* 底部操作区 */}
          {/* 概览确认按钮 */}
          {!overviewConfirmed && overview && (
            <div style={{ padding: 12, borderTop: "1px solid #f0f0f0" }}>
              <Button
                type="primary"
                block
                loading={generating}
                onClick={() => {
                  setOverviewConfirmed(true);
                  // 进入逐天模式，自动发起第一天规划
                  const firstEmpty = Array.from({ length: dayCount }, (_, d) => d).find(
                    (d) => !trip.items.some((i) => i.dayIndex === d),
                  );
                  const firstDay = firstEmpty ?? 0;
                  setFocusDay(firstDay);
                  send(`行程概览已确认，请开始规划第 ${firstDay + 1} 天。`, firstDay);
                }}
              >
                确认概览，开始逐天细化
              </Button>
            </div>
          )}
          {/* 逐天确认按钮 */}
          {overviewConfirmed && proposal && (
            <div style={{ padding: 12, borderTop: "1px solid #f0f0f0" }}>
              <Button
                type="primary"
                block
                loading={applying}
                disabled={checked.size === 0}
                onClick={handleConfirmDay}
              >
                确认第 {proposal.dayIndex + 1} 天（{checked.size}/{proposal.items.length} 项）
              </Button>
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}
