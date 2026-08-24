"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { App, Button, Card, Dropdown, Spin, Tabs, Tag, Typography } from "antd";
import {
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EllipsisOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  ShareAltOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import AiAssistantPanel from "@/components/AiAssistantPanel";
import AiSelfCheckModal from "@/components/AiSelfCheckModal";
import ChecklistPanel from "@/components/ChecklistPanel";
import CoplanDrawer from "@/components/CoplanDrawer";
import ExpensesPanel from "@/components/ExpensesPanel";
import GuideShareModal from "@/components/GuideShareModal";
import ItemFormModal from "@/components/ItemFormModal";
import ItineraryBoard from "@/components/ItineraryBoard";
import MobileTripDetail from "@/components/mobile/MobileTripDetail";
import PoiDetailDrawer from "@/components/PoiDetailDrawer";
import PoiExplorerPanel from "@/components/PoiExplorerPanel";
import ShareModal from "@/components/ShareModal";
import TripFormModal from "@/components/TripFormModal";
import TripInspectDrawer from "@/components/TripInspectDrawer";
import { downloadText, tripToCsv, tripToMarkdown } from "@/lib/export";
import { useHeaderContent } from "@/lib/header-context";
import { useIsMobile } from "@/lib/use-is-mobile";
import type { ExpenseT, ItineraryItemT, TripDetail } from "@/types";

const MapPanel = dynamic(() => import("@/components/MapPanel"), { ssr: false });

export default function TripDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { message, modal } = App.useApp();
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tripModalOpen, setTripModalOpen] = useState(false);
  const [aiPanelCollapsed, setAiPanelCollapsed] = useState(false);
  const [inspectOpen, setInspectOpen] = useState(false);
  const [selfCheckOpen, setSelfCheckOpen] = useState(false);
  const [coplanOpen, setCoplanOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<ItineraryItemT | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [guideShareOpen, setGuideShareOpen] = useState(false);
  const [weather, setWeather] = useState<Record<number, string>>({});
  const [itemModal, setItemModal] = useState<{
    open: boolean;
    dayIndex: number;
    item: ItineraryItemT | null;
    insertAfterSortOrder?: number;
  }>({ open: false, dayIndex: 0, item: null });

  const { setHeaderContent } = useHeaderContent();
  const isMobile = useIsMobile();

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

  // URL 参数 ?coplan=1 时自动打开共同创作
  useEffect(() => {
    if (trip && searchParams.get("coplan") === "1") {
      setCoplanOpen(true);
    }
  }, [trip, searchParams]);

  const TAB_KEYS = ["board", "map", "discover", "expenses", "checklist"] as const;
  const tabParam = searchParams.get("tab");
  const activeTab = TAB_KEYS.includes(tabParam as typeof TAB_KEYS[number]) ? tabParam! : "board";

  const handleTabChange = (key: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", key);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

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

  const handleDeleteItem = async (item: ItineraryItemT) => {
    // 乐观删除：先从本地移除，API 失败时再回滚
    setTrip((prev) => (prev ? { ...prev, items: prev.items.filter((i) => i.id !== item.id) } : prev));
    try {
      const res = await fetch(`/api/items/${item.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      message.success("行程项已删除");
    } catch {
      message.error("删除失败");
      load();
    }
  };

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

  const handleCopyTrip = async () => {
    const hide = message.loading("正在复制行程…");
    const res = await fetch(`/api/trips/${id}/copy`, { method: "POST" }).catch(() => null);
    hide();
    const data = res ? ((await res.json().catch(() => ({}))) as { id?: string; error?: string }) : {};
    if (res?.ok && data.id) {
      message.success("行程已复制");
      router.push(`/trips/${data.id}`);
    } else {
      message.error(data.error || "复制失败");
    }
  };

  const handleExport = async (key: string) => {
    if (!trip) return;
    if (key === "json") {
      window.location.href = `/api/trips/${trip.id}/export`;
    } else if (key === "print") {
      window.open(`/trips/${trip.id}/print`, "_blank");
    } else if (key === "md" || key === "excel") {
      try {
        const res = await fetch(`/api/trips/${trip.id}/expenses`);
        const expenses: ExpenseT[] = res.ok ? await res.json() : [];
        if (key === "md") {
          downloadText(`${trip.title}.md`, tripToMarkdown(trip, expenses), "text/markdown");
        } else {
          downloadText(`${trip.title}.csv`, tripToCsv(trip, expenses), "text/csv");
        }
      } catch {
        message.error("导出失败");
      }
    }
  };

  // 注入顶部栏自定义内容（需在早期 return 前声明，遵守 hooks 规则）
  const role2 = trip?.access?.role ?? "owner";
  const isOwner2 = role2 === "owner";
  const readOnly2 = role2 === "read";

  useEffect(() => {
    if (!trip || isMobile === null) {
      setHeaderContent(null);
      return;
    }
    const startDay2 = dayjs(trip.startDate);
    const dayCount2 = dayjs(trip.endDate).diff(startDay2, "day") + 1;

    // 手机版：标题 + 目的地 + ⋯ 全操作菜单
    if (isMobile) {
      setHeaderContent(
        <div style={{ display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
          <span style={{ fontWeight: 600, fontSize: 15, color: "#1f1f1f", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 140 }}>
            {trip.title}
          </span>
          <Tag color="blue" style={{ flexShrink: 0, margin: 0 }}>{trip.destination}</Tag>
          <div style={{ flex: 1 }} />
          {isOwner2 && (
            <Button type="text" size="middle" icon={<ShareAltOutlined />} style={{ color: "#555", flexShrink: 0 }} onClick={() => setGuideShareOpen(true)}>
              共享
            </Button>
          )}
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [
                { key: "inspect", icon: <SafetyCertificateOutlined />, label: "行程体检" },
                { key: "selfcheck", icon: <RobotOutlined />, label: "方案自检" },
                ...(isOwner2
                  ? [
                      { key: "copy", icon: <CopyOutlined />, label: "复制行程" },
                      { key: "memberShare", icon: <ShareAltOutlined />, label: `成员共享${trip.shares && trip.shares.length > 0 ? `（${trip.shares.length}）` : ""}` },
                      { key: "edit", icon: <EditOutlined />, label: "编辑行程" },
                    ]
                  : []),
                { type: "divider" as const },
                { key: "md", label: "导出 Markdown" },
                { key: "excel", label: "导出 Excel" },
                { key: "json", label: "导出 JSON 备份" },
                { key: "print", label: "打印页面（可存 PDF）" },
                ...(isOwner2
                  ? [
                      { type: "divider" as const },
                      { key: "delete", icon: <DeleteOutlined />, label: "删除行程", danger: true },
                    ]
                  : []),
              ],
              onClick: ({ key }) => {
                if (key === "inspect") setInspectOpen(true);
                else if (key === "selfcheck") setSelfCheckOpen(true);
                else if (key === "copy") handleCopyTrip();
                else if (key === "memberShare") setShareOpen(true);
                else if (key === "edit") setTripModalOpen(true);
                else if (key === "delete") {
                  modal.confirm({
                    title: "删除整个行程？",
                    content: "将同时删除日程、开销与清单",
                    okText: "删除",
                    okButtonProps: { danger: true },
                    cancelText: "取消",
                    onOk: handleDeleteTrip,
                  });
                } else handleExport(key);
              },
            }}
          >
            <Button type="text" size="middle" icon={<EllipsisOutlined />} style={{ color: "#555", flexShrink: 0 }} />
          </Dropdown>
        </div>,
      );
      return () => {
        setHeaderContent(null);
      };
    }

    setHeaderContent(
      <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
        <span style={{ fontWeight: 600, fontSize: 17, color: "#1f1f1f", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 260 }}>
          {trip.title}
        </span>
        <Tag color="blue" style={{ flexShrink: 0, margin: 0 }}>{trip.destination}</Tag>
        {!isOwner2 && (
          <Tag color={readOnly2 ? "default" : "processing"} style={{ flexShrink: 0, margin: 0 }}>
            {(trip.owner?.displayName || trip.owner?.username || "他人") + " 共享"}
          </Tag>
        )}
        <span style={{ fontSize: 13, color: "#999", whiteSpace: "nowrap", flexShrink: 0 }}>
          {startDay2.format("M月D日")} - {dayjs(trip.endDate).format("M月D日")} · {dayCount2}天
        </span>
        <div style={{ flex: 1 }} />
        <Button size="middle" icon={<SafetyCertificateOutlined />} onClick={() => setInspectOpen(true)}>体检</Button>
        <Button size="middle" icon={<RobotOutlined />} onClick={() => setSelfCheckOpen(true)}>自检</Button>
        {isOwner2 && (
          <Button size="middle" icon={<CopyOutlined />} onClick={handleCopyTrip}>复制</Button>
        )}
        {isOwner2 && (
          <Button size="middle" icon={<ShareAltOutlined />} onClick={() => setGuideShareOpen(true)}>共享</Button>
        )}
        <Dropdown
          trigger={["click"]}
          menu={{
            items: [
              { key: "md", label: "导出 Markdown" },
              { key: "excel", label: "导出 Excel" },
              { key: "json", label: "导出 JSON 备份" },
              { key: "print", label: "打印页面（可存 PDF）" },
            ],
            onClick: ({ key }) => handleExport(key),
          }}
        >
          <Button size="middle" icon={<DownloadOutlined />}>导出</Button>
        </Dropdown>
        {isOwner2 && (
          <Button size="middle" icon={<EditOutlined />} onClick={() => setTripModalOpen(true)}>编辑</Button>
        )}
        {isOwner2 && (
          <Button size="middle" icon={<ShareAltOutlined />} onClick={() => setShareOpen(true)}>
            成员共享{trip.shares && trip.shares.length > 0 ? `（${trip.shares.length}）` : ""}
          </Button>
        )}
        {isOwner2 && (
          <Button
            size="middle"
            danger
            icon={<DeleteOutlined />}
            onClick={() =>
              modal.confirm({
                title: "删除整个行程？",
                content: "将同时删除日程、开销与清单",
                okText: "删除",
                okButtonProps: { danger: true },
                cancelText: "取消",
                onOk: handleDeleteTrip,
              })
            }
          >
            删除
          </Button>
        )}
      </div>
    );
    return () => {
      setHeaderContent(null);
    };
  }, [trip, isOwner2, readOnly2, setHeaderContent, router, isMobile]);

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
  const role = trip.access?.role ?? "owner";
  const isOwner = role === "owner";
  const readOnly = role === "read";
  const openItemModal = (dayIndex: number, item: ItineraryItemT | null, insertAfterSortOrder?: number) => {
    if (readOnly) {
      message.info("该行程对你是只读共享");
      return;
    }
    setItemModal({ open: true, dayIndex, item, insertAfterSortOrder });
  };
  const dayLabel = `第 ${itemModal.dayIndex + 1} 天 · ${startDay
    .add(itemModal.dayIndex, "day")
    .format("M月D日")}`;

  // 弹窗/抽屉（桌面与手机版共享）
  const sharedModals = (
    <>
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
        insertAfterSortOrder={itemModal.insertAfterSortOrder}
        onCancel={() => setItemModal((m) => ({ ...m, open: false }))}
        onSaved={() => {
          setItemModal((m) => ({ ...m, open: false }));
          load();
        }}
      />
      <PoiDetailDrawer
        open={detailItem != null}
        item={detailItem}
        cityHint={trip.destination}
        readOnly={readOnly}
        onClose={() => setDetailItem(null)}
        onChanged={load}
        onEdit={(item) => {
          setDetailItem(null);
          openItemModal(item.dayIndex, item);
        }}
      />
      <TripInspectDrawer open={inspectOpen} trip={trip} onClose={() => setInspectOpen(false)} />
      <AiSelfCheckModal
        open={selfCheckOpen}
        trip={trip}
        onCancel={() => setSelfCheckOpen(false)}
        onApplied={() => { setSelfCheckOpen(false); load(); }}
      />
      <CoplanDrawer
        open={coplanOpen}
        trip={trip}
        onClose={() => {
          setCoplanOpen(false);
          load();
        }}
      />
      <ShareModal open={shareOpen} tripId={trip.id} onCancel={() => { setShareOpen(false); load(); }} />
      <GuideShareModal
        open={guideShareOpen}
        trip={trip}
        onCancel={() => setGuideShareOpen(false)}
        onTokenChanged={(token) => setTrip((p) => (p ? { ...p, shareToken: token } : p))}
      />
    </>
  );

  // 检测中：短暂加载态，避免版本闪烁
  if (isMobile === null) {
    return (
      <div style={{ textAlign: "center", padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  // 手机版
  if (isMobile) {
    return (
      <>
        <MobileTripDetail
          trip={trip}
          weather={weather}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          onAddItem={(dayIndex) => openItemModal(dayIndex, null)}
          onShowDetail={(item) => setDetailItem(item)}
          onDeleteItem={handleDeleteItem}
          onReorder={handleReorder}
          onInsertDay={handleInsertDay}
          onRemoveDay={handleRemoveDay}
          onEditItemFromMap={(item) => openItemModal(item.dayIndex, item)}
          onItemsChanged={load}
          onTripChanged={load}
        />
        {sharedModals}
      </>
    );
  }

  return (
    <div className="trip-detail-root" style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 56px - 24px)", gap: 10 }}>
      <div className="trip-detail-main" style={{ flex: 1, minHeight: 0, display: "flex", gap: 12, alignItems: "stretch" }}>
        <Card className="trip-detail-content" size="small" style={{ flex: 1, minWidth: 0, height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <Tabs
            activeKey={activeTab}
            onChange={handleTabChange}
            destroyInactiveTabPane={false}
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
                    onAddItem={(dayIndex, insertAfterSortOrder) => openItemModal(dayIndex, null, insertAfterSortOrder)}
                    onEditItem={(item) => setDetailItem(item)}
                    onDeleteItem={handleDeleteItem}
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
                    onAddItem={(dayIndex) => openItemModal(dayIndex, null)}
                    onEditItem={(item) => openItemModal(item.dayIndex, item)}
                    onReorder={handleReorder}
                    onItemsChanged={load}
                    onShowDetail={(item) => setDetailItem(item)}
                  />
                ),
              },
              {
                key: "discover",
                label: "发现",
                children: (
                  <PoiExplorerPanel
                    tripId={trip.id}
                    destination={trip.destination}
                    dayCount={dayCount}
                    existingPois={
                      trip.items
                        .map((i) => i.placeName)
                        .filter(Boolean) as string[]
                    }
                    trip={trip}
                    onAdded={load}
                    onTripChanged={load}
                  />
                ),
              },
              {
                key: "expenses",
                label: "开销",
                children: <ExpensesPanel trip={trip} readOnly={readOnly} />,
              },
              {
                key: "checklist",
                label: "行前清单",
                children: <ChecklistPanel tripId={trip.id} readOnly={readOnly} />,
              },
            ]}
          />
        </Card>
        {!readOnly && (
          <AiAssistantPanel
            trip={trip}
            collapsed={aiPanelCollapsed}
            onCollapsedChange={setAiPanelCollapsed}
            onApplied={load}
          />
        )}
      </div>

      {sharedModals}
    </div>
  );
}
