"use client";

// 手机版首页：行程卡片列表 + 顶部操作 + 新建按钮
import { Button, Card, Dropdown, Empty, Space, Tag, Typography } from "antd";
import {
  CalendarOutlined,
  DeleteOutlined,
  EditOutlined,
  EllipsisOutlined,
  EnvironmentOutlined,
  PlusOutlined,
  ReadOutlined,
  ThunderboltOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import type { TripSummary } from "@/types";

interface Props {
  trips: TripSummary[];
  loading: boolean;
  onOpenTrip: (id: string) => void;
  onNewTrip: () => void;
  onEditTrip: (trip: TripSummary) => void;
  onDeleteTrip: (id: string) => void;
  onAiPlan: () => void;
  onImportGuide: () => void;
  onImportBackup: () => void;
}

const COVER_GRADIENTS = [
  "linear-gradient(120deg, #0d9488, #0891b2)",
  "linear-gradient(120deg, #0ea5e9, #06b6d4)",
  "linear-gradient(120deg, #10b981, #0d9488)",
  "linear-gradient(120deg, #f59e0b, #ef4444)",
  "linear-gradient(120deg, #ec4899, #0891b2)",
];

const coverOf = (trip: TripSummary) => {
  let h = 0;
  for (const ch of trip.destination || trip.title) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COVER_GRADIENTS[h % COVER_GRADIENTS.length];
};

const dayCount = (trip: TripSummary) =>
  dayjs(trip.endDate).diff(dayjs(trip.startDate), "day") + 1;

export default function MobileHome({
  trips,
  loading,
  onOpenTrip,
  onNewTrip,
  onEditTrip,
  onDeleteTrip,
  onAiPlan,
  onImportGuide,
  onImportBackup,
}: Props) {
  const statusTag = (trip: TripSummary) => {
    const today = dayjs().startOf("day");
    const start = dayjs(trip.startDate).startOf("day");
    const end = dayjs(trip.endDate).startOf("day");
    if (today.isBefore(start)) return <Tag color="processing">即将出发</Tag>;
    if (today.isAfter(end)) return <Tag>已结束</Tag>;
    return (
      <Tag color="success">
        Day {today.diff(start, "day") + 1}/{dayCount(trip)}
      </Tag>
    );
  };

  return (
    <div className="m-home">
      {/* 欢迎区 */}
      <div className="m-home-hero">
        <h1>🧳 旅行规划</h1>
        <p>把想去的地方，交给 AI 谱成行程</p>
      </div>

      {/* 操作区 */}
      <Space wrap size={8} style={{ marginBottom: 14 }}>
        <Button type="primary" icon={<ThunderboltOutlined />} onClick={onAiPlan}>
          AI 规划
        </Button>
        <Button icon={<ReadOutlined />} onClick={onImportGuide}>
          导入攻略
        </Button>
        <Button icon={<UploadOutlined />} onClick={onImportBackup}>
          导入备份
        </Button>
      </Space>

      {/* 行程列表 */}
      {!loading && trips.length === 0 ? (
        <Empty description="还没有行程" style={{ marginTop: 48 }}>
          <Button type="primary" icon={<ThunderboltOutlined />} onClick={onAiPlan}>
            ✨ AI 帮我规划
          </Button>
        </Empty>
      ) : (
        <div className="m-home-list">
          {trips.map((trip) => {
            const isOwner = (trip.access?.role ?? "owner") === "owner";
            return (
              <Card
                key={trip.id}
                size="small"
                className="m-trip-card"
                styles={{ body: { padding: 0 } }}
                onClick={() => onOpenTrip(trip.id)}
              >
                <div className="m-trip-cover" style={{ background: coverOf(trip) }}>
                  <div className="m-trip-title">{trip.title}</div>
                  <div className="m-trip-dest">
                    <EnvironmentOutlined style={{ fontSize: 12 }} />
                    {trip.destination}
                  </div>
                </div>
                <div className="m-trip-body">
                  <div className="m-trip-row">
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      <CalendarOutlined style={{ marginRight: 4 }} />
                      {dayjs(trip.startDate).format("M/D")} - {dayjs(trip.endDate).format("M/D")} ·{" "}
                      {dayCount(trip)}天
                    </Typography.Text>
                    {statusTag(trip)}
                  </div>
                  {!isOwner && (
                    <Tag
                      style={{ marginTop: 6 }}
                      color={trip.access?.role === "edit" ? "processing" : "default"}
                    >
                      {(trip.owner?.displayName || trip.owner?.username || "他人") + " 共享"}
                      {trip.access?.role === "edit" ? " · 可编辑" : " · 只读"}
                    </Tag>
                  )}
                  <div className="m-trip-footer">
                    <span className="m-trip-stat">
                      {trip._count?.items ?? 0} 个行程项
                      {trip.budgetTotal != null && ` · 预算 ¥${trip.budgetTotal.toLocaleString()}`}
                    </span>
                    {isOwner && (
                      <Dropdown
                        trigger={["click"]}
                        menu={{
                          items: [
                            { key: "edit", icon: <EditOutlined />, label: "编辑" },
                            { key: "delete", icon: <DeleteOutlined />, label: "删除", danger: true },
                          ],
                          onClick: ({ key, domEvent }) => {
                            domEvent.stopPropagation();
                            if (key === "edit") onEditTrip(trip);
                            else if (key === "delete") onDeleteTrip(trip.id);
                          },
                        }}
                      >
                        <Button
                          type="text"
                          size="small"
                          icon={<EllipsisOutlined />}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </Dropdown>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* 悬浮新建按钮 */}
      <Button
        type="primary"
        shape="circle"
        size="large"
        icon={<PlusOutlined />}
        className="m-home-fab"
        onClick={onNewTrip}
      />
    </div>
  );
}
