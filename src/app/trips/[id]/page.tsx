"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { App, Button, Card, Dropdown, Popconfirm, Space, Spin, Tabs, Tag, Typography } from "antd";
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  RobotOutlined,
  ShareAltOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import AiAdjustModal from "@/components/AiAdjustModal";
import ChecklistPanel from "@/components/ChecklistPanel";
import ExpensesPanel from "@/components/ExpensesPanel";
import ItemFormModal from "@/components/ItemFormModal";
import ItineraryBoard from "@/components/ItineraryBoard";
import MapPanel from "@/components/MapPanel";
import ResearchPanel from "@/components/ResearchPanel";
import ShareModal from "@/components/ShareModal";
import TripFormModal from "@/components/TripFormModal";
import { downloadText, tripToMarkdown } from "@/lib/export";
import type { ExpenseT, ItineraryItemT, TripDetail } from "@/types";

export default function TripDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { message, modal } = App.useApp();
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tripModalOpen, setTripModalOpen] = useState(false);
  const [aiAdjustOpen, setAiAdjustOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [weather, setWeather] = useState<Record<number, string>>({});
  const [itemModal, setItemModal] = useState<{
    open: boolean;
    dayIndex: number;
    item: ItineraryItemT | null;
  }>({ open: false, dayIndex: 0, item: null });

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/trips/${id}`);
      if (!res.ok) throw new Error();
      setTrip(await res.json());
    } catch {
      message.error("加载行程失败");
      setTrip(null);
    } finally {
      setLoading(false);
    }
  }, [id, message]);

  useEffect(() => {
    load();
  }, [load]);

  // 天气（配置了和风天气时展示，静默失败）
  useEffect(() => {
    if (!trip) return;
    let disposed = false;
    (async () => {
      try {
        const res = await fetch(`/api/weather?city=${encodeURIComponent(trip.destination)}`);
        const data = (await res.json()) as {
          ok: boolean;
          daily?: Array<{ date: string; text: string; tempMin: string; tempMax: string }>;
        };
        if (disposed || !data.ok || !data.daily) return;
        const start = dayjs(trip.startDate);
        const dayCount = dayjs(trip.endDate).diff(start, "day") + 1;
        const map: Record<number, string> = {};
        for (let d = 0; d < dayCount; d++) {
          const dateStr = start.add(d, "day").format("YYYY-MM-DD");
          const daily = data.daily.find((x) => x.date === dateStr);
          if (daily) map[d] = `${daily.text} ${daily.tempMin}~${daily.tempMax}°C`;
        }
        setWeather(map);
      } catch {
        // 忽略
      }
    })();
    return () => {
      disposed = true;
    };
  }, [trip]);

  const handleReorder = async (items: ItineraryItemT[]) => {
    setTrip((prev) => (prev ? { ...prev, items } : prev));
    const res = await fetch(`/api/trips/${id}/reorder`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        items: items.map(({ id: itemId, dayIndex, sortOrder }) => ({
          id: itemId,
          dayIndex,
          sortOrder,
        })),
      }),
    }).catch(() => null);
    if (!res || !res.ok) {
      message.error("保存排序失败，已还原");
      load();
    }
  };

  const handleInsertDay = async (dayIndex: number) => {
    const res = await fetch(`/api/trips/${id}/days`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "insert", dayIndex }),
    }).catch(() => null);
    if (res?.ok) {
      message.success("已添加一天");
      load();
    } else {
      const data = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
      message.error(data?.error ?? "操作失败");
    }
  };

  const handleRemoveDay = (dayIndex: number) => {
    if (!trip) return;
    const count = trip.items.filter((i) => i.dayIndex === dayIndex).length;
    modal.confirm({
      title: `删除第 ${dayIndex + 1} 天？`,
      content:
        dayIndex === 0
          ? count > 0
            ? `该天的 ${count} 个安排将并入下一天，出发日期推迟一天（其余日期不变）。`
            : "出发日期将推迟一天（其余日期不变）。"
          : count > 0
            ? `该天的 ${count} 个安排将并入前一天，后续日期整体前移一天。`
            : "后续日期将整体前移一天。",
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        const res = await fetch(`/api/trips/${id}/days`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "remove", dayIndex }),
        }).catch(() => null);
        if (res?.ok) {
          message.success("已删除该天");
          load();
        } else {
          const data = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
          message.error(data?.error ?? "操作失败");
        }
      },
    });
  };

  const handleDeleteTrip = async () => {
    const res = await fetch(`/api/trips/${id}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok) {
      message.success("行程已删除");
      router.push("/");
    } else {
      message.error("删除失败");
    }
  };

  const handleExport = async (key: string) => {
    if (!trip) return;
    if (key === "json") {
      window.location.href = `/api/trips/${trip.id}/export`;
    } else if (key === "print") {
      window.open(`/trips/${trip.id}/print`, "_blank");
    } else if (key === "md") {
      try {
        const res = await fetch(`/api/trips/${trip.id}/expenses`);
        const expenses: ExpenseT[] = res.ok ? await res.json() : [];
        downloadText(`${trip.title}.md`, tripToMarkdown(trip, expenses), "text/markdown");
      } catch {
        message.error("导出失败");
      }
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!trip) {
    return (
      <Card>
        <Typography.Text type="secondary">行程不存在或已删除</Typography.Text>
        <Button type="link" onClick={() => router.push("/")}>
          返回列表
        </Button>
      </Card>
    );
  }

  const startDay = dayjs(trip.startDate);
  const dayCount = dayjs(trip.endDate).diff(startDay, "day") + 1;
  const estimatedTotal = trip.items.reduce((sum, i) => sum + (i.estimatedCost ?? 0), 0);
  const role = trip.access?.role ?? "owner";
  const isOwner = role === "owner";
  const readOnly = role === "read";
  const openItemModal = (dayIndex: number, item: ItineraryItemT | null) => {
    if (readOnly) {
      message.info("该行程对你是只读共享");
      return;
    }
    setItemModal({ open: true, dayIndex, item });
  };
  const dayLabel = `第 ${itemModal.dayIndex + 1} 天 · ${startDay
    .add(itemModal.dayIndex, "day")
    .format("M月D日")}`;

  return (
    <Space direction="vertical" size="middle" style={{ display: "flex" }}>
      <Card>
        <Space direction="vertical" size={6} style={{ display: "flex" }}>
          <Space wrap>
            <Button icon={<ArrowLeftOutlined />} onClick={() => router.push("/")}>
              返回
            </Button>
            <Typography.Title level={4} style={{ margin: 0 }}>
              {trip.title}
            </Typography.Title>
            <Tag color="blue">{trip.destination}</Tag>
            {!isOwner && (
              <Tag color={readOnly ? "default" : "processing"}>
                {(trip.owner?.displayName || trip.owner?.username || "他人") + " 共享"}
                {readOnly ? " · 只读" : " · 可编辑"}
              </Tag>
            )}
          </Space>
          <Space wrap size="middle">
            <Typography.Text type="secondary">
              {startDay.format("YYYY年M月D日")} - {dayjs(trip.endDate).format("M月D日")} · 共{" "}
              {dayCount} 天 · {trip.items.length} 个行程项
            </Typography.Text>
            {trip.budgetTotal != null && (
              <Typography.Text type="secondary">
                预算 ¥{trip.budgetTotal.toLocaleString()}
              </Typography.Text>
            )}
            {estimatedTotal > 0 && (
              <Typography.Text type="secondary">
                预估合计 ¥{estimatedTotal.toLocaleString()}
              </Typography.Text>
            )}
            {!readOnly && (
              <Button size="small" icon={<RobotOutlined />} onClick={() => setAiAdjustOpen(true)}>
                AI 调整
              </Button>
            )}
            <Dropdown
              menu={{
                items: [
                  { key: "md", label: "导出 Markdown" },
                  { key: "json", label: "导出 JSON 备份" },
                  { key: "print", label: "打印页面（可存 PDF）" },
                ],
                onClick: ({ key }) => handleExport(key),
              }}
            >
              <Button size="small" icon={<DownloadOutlined />}>
                导出
              </Button>
            </Dropdown>
            {isOwner && (
              <Button size="small" icon={<ShareAltOutlined />} onClick={() => setShareOpen(true)}>
                共享
                {trip.shares && trip.shares.length > 0 ? `（${trip.shares.length}）` : ""}
              </Button>
            )}
            {isOwner && (
              <Button size="small" icon={<EditOutlined />} onClick={() => setTripModalOpen(true)}>
                编辑
              </Button>
            )}
            {isOwner && (
              <Popconfirm
                title="删除整个行程？"
                description="将同时删除日程、开销与清单"
                okText="删除"
                okButtonProps={{ danger: true }}
                cancelText="取消"
                onConfirm={handleDeleteTrip}
              >
                <Button size="small" danger icon={<DeleteOutlined />}>
                  删除
                </Button>
              </Popconfirm>
            )}
          </Space>
          {trip.notes && <Typography.Text type="secondary">备注：{trip.notes}</Typography.Text>}
        </Space>
      </Card>

      <Card size="small">
        <Tabs
          defaultActiveKey="board"
          items={[
            {
              key: "board",
              label: "日程编排",
              children: (
                <ItineraryBoard
                  startDate={startDay}
                  dayCount={dayCount}
                  items={trip.items}
                  weather={weather}
                  readOnly={readOnly}
                  onAddItem={(dayIndex) => openItemModal(dayIndex, null)}
                  onEditItem={(item) => openItemModal(item.dayIndex, item)}
                  onReorder={handleReorder}
                  onInsertDay={handleInsertDay}
                  onRemoveDay={handleRemoveDay}
                />
              ),
            },
            {
              key: "map",
              label: "地图路线",
              children: (
                <MapPanel
                  items={trip.items}
                  startDate={startDay}
                  dayCount={dayCount}
                  readOnly={readOnly}
                  onEditItem={(item) => openItemModal(item.dayIndex, item)}
                  onItemsChanged={load}
                />
              ),
            },
            {
              key: "expenses",
              label: "开销",
              children: <ExpensesPanel trip={trip} readOnly={readOnly} />,
            },
            {
              key: "research",
              label: "攻略参考",
              children: <ResearchPanel trip={trip} readOnly={readOnly} onChanged={load} />,
            },
            {
              key: "checklist",
              label: "行前清单",
              children: <ChecklistPanel tripId={trip.id} readOnly={readOnly} />,
            },
          ]}
        />
      </Card>

      <TripFormModal
        open={tripModalOpen}
        trip={trip}
        onCancel={() => setTripModalOpen(false)}
        onSaved={() => {
          setTripModalOpen(false);
          load();
        }}
      />
      <ItemFormModal
        open={itemModal.open}
        tripId={trip.id}
        dayIndex={itemModal.dayIndex}
        dayLabel={dayLabel}
        cityHint={trip.destination}
        item={itemModal.item}
        onCancel={() => setItemModal((m) => ({ ...m, open: false }))}
        onSaved={() => {
          setItemModal((m) => ({ ...m, open: false }));
          load();
        }}
      />
      <AiAdjustModal
        open={aiAdjustOpen}
        trip={trip}
        onCancel={() => setAiAdjustOpen(false)}
        onApplied={() => {
          setAiAdjustOpen(false);
          load();
        }}
      />
      <ShareModal open={shareOpen} tripId={trip.id} onCancel={() => { setShareOpen(false); load(); }} />
    </Space>
  );
}
