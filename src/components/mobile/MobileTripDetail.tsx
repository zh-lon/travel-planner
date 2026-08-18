"use client";

// 手机版行程详情：全屏 Tabs（5 大模块）+ 悬浮 AI 助手抽屉
import { useState } from "react";
import dynamic from "next/dynamic";
import { Button, Card, Drawer, Tabs } from "antd";
import { RobotOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import AiAssistantPanel from "@/components/AiAssistantPanel";
import ChecklistPanel from "@/components/ChecklistPanel";
import ExpensesPanel from "@/components/ExpensesPanel";
import ItineraryBoard from "@/components/ItineraryBoard";
import PoiExplorerPanel from "@/components/PoiExplorerPanel";
import type { ItineraryItemT, TripDetail } from "@/types";

const MapPanel = dynamic(() => import("@/components/MapPanel"), { ssr: false });

interface Props {
  trip: TripDetail;
  weather: Record<number, string>;
  activeTab: string;
  onTabChange: (key: string) => void;
  onAddItem: (dayIndex: number) => void;
  onShowDetail: (item: ItineraryItemT) => void;
  onDeleteItem: (item: ItineraryItemT) => void;
  onReorder: (items: ItineraryItemT[]) => void;
  onInsertDay: (dayIndex: number) => void;
  onRemoveDay: (dayIndex: number) => void;
  onEditItemFromMap: (item: ItineraryItemT) => void;
  onItemsChanged: () => void;
  onTripChanged: () => void;
}

export default function MobileTripDetail({
  trip,
  weather,
  activeTab,
  onTabChange,
  onAddItem,
  onShowDetail,
  onDeleteItem,
  onReorder,
  onInsertDay,
  onRemoveDay,
  onEditItemFromMap,
  onItemsChanged,
  onTripChanged,
}: Props) {
  const [aiOpen, setAiOpen] = useState(false);

  const startDay = dayjs(trip.startDate);
  const dayCount = dayjs(trip.endDate).diff(startDay, "day") + 1;
  const role = trip.access?.role ?? "owner";
  const readOnly = role === "read";

  return (
    <div className="m-trip-detail">
      <Card
        className="trip-detail-content"
        size="small"
        style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}
      >
        <Tabs
          activeKey={activeTab}
          onChange={onTabChange}
          size="small"
          destroyInactiveTabPane={false}
          items={[
            {
              key: "board",
              label: "日程",
              children: (
                <ItineraryBoard
                  startDate={startDay}
                  dayCount={dayCount}
                  items={trip.items}
                  weather={weather}
                  readOnly={readOnly}
                  onAddItem={onAddItem}
                  onEditItem={onShowDetail}
                  onDeleteItem={onDeleteItem}
                  onReorder={onReorder}
                  onInsertDay={onInsertDay}
                  onRemoveDay={onRemoveDay}
                />
              ),
            },
            {
              key: "map",
              label: "地图",
              children: (
                <MapPanel
                  items={trip.items}
                  startDate={startDay}
                  dayCount={dayCount}
                  readOnly={readOnly}
                  onAddItem={onAddItem}
                  onEditItem={onEditItemFromMap}
                  onReorder={onReorder}
                  onItemsChanged={onItemsChanged}
                  onShowDetail={onShowDetail}
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
                  existingPois={trip.items.map((i) => i.placeName).filter(Boolean) as string[]}
                  trip={trip}
                  onAdded={onItemsChanged}
                  onTripChanged={onTripChanged}
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
              label: "清单",
              children: <ChecklistPanel tripId={trip.id} readOnly={readOnly} />,
            },
          ]}
        />
      </Card>

      {/* 悬浮 AI 助手按钮 */}
      {!readOnly && (
        <Button
          type="primary"
          shape="circle"
          size="large"
          icon={<RobotOutlined />}
          className="m-ai-fab"
          onClick={() => setAiOpen(true)}
        />
      )}

      {/* AI 助手抽屉（底部弹出） */}
      <Drawer
        title="AI 助手"
        placement="bottom"
        height="78%"
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        styles={{ body: { padding: 8, display: "flex", flexDirection: "column" } }}
        className="m-ai-drawer"
      >
        <AiAssistantPanel
          trip={trip}
          collapsed={false}
          onCollapsedChange={(c) => {
            if (c) setAiOpen(false);
          }}
          onApplied={onTripChanged}
        />
      </Drawer>
    </div>
  );
}
