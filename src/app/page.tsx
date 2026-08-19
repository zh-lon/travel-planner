"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Card, Col, Empty, Popconfirm, Row, Space, Spin, Tag, Typography } from "antd";
import {
  CalendarOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  EnvironmentOutlined,
  PlusOutlined,
  ReadOutlined,
  ThunderboltOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import AiPlanWizard from "@/components/AiPlanWizard";
import GuideImportModal from "@/components/GuideImportModal";
import MobileHome from "@/components/mobile/MobileHome";
import TripFormModal from "@/components/TripFormModal";
import { useIsMobile } from "@/lib/use-is-mobile";
import type { TripSummary } from "@/types";

export default function HomePage() {
  const { message, modal } = App.useApp();
  const router = useRouter();
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TripSummary | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const isMobile = useIsMobile();
  // 客户端挂载后才渲染弹窗类组件，避免 SSR 阶段触发 antd Portal 警告
  const [mounted, setMounted] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/trips");
      if (!res.ok) throw new Error();
      setTrips(await res.json());
    } catch {
      message.error("加载行程列表失败");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    load();
  }, [load]);

  // 窗口重新可见/聚焦时刷新列表，避免从详情页或其他标签页回来后看到过期数据
  useEffect(() => {
    const onFocus = () => load();
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/trips/${id}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok) {
      message.success("行程已删除");
      load();
    } else {
      message.error("删除失败");
    }
  };

  const handleCopy = async (id: string) => {
    const hide = message.loading("正在复制行程…");
    const res = await fetch(`/api/trips/${id}/copy`, { method: "POST" }).catch(() => null);
    hide();
    const data = res ? ((await res.json().catch(() => ({}))) as { id?: string; error?: string }) : {};
    if (res?.ok && data.id) {
      message.success("行程已复制");
      load();
    } else {
      message.error(data.error || "复制失败");
    }
  };

  const handleImportFile = async (file: File) => {
    setImporting(true);
    try {
      const text = await file.text();
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error("文件不是合法的 JSON");
      }
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !result.id) throw new Error(result.error);
      message.success("备份已导入");
      load();
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : "导入失败", 5);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const dayCount = (trip: TripSummary) =>
    dayjs(trip.endDate).diff(dayjs(trip.startDate), "day") + 1;

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

  // 行程状态：0 进行中 / 1 即将出发 / 2 已结束（也用作排序权重）
  const statusOf = (trip: TripSummary) => {
    const today = dayjs().startOf("day");
    const start = dayjs(trip.startDate).startOf("day");
    const end = dayjs(trip.endDate).startOf("day");
    if (today.isBefore(start)) {
      return {
        weight: 1,
        tag: <Tag color="processing">即将出发 · {start.diff(today, "day")} 天后</Tag>,
      };
    }
    if (today.isAfter(end)) {
      return { weight: 2, tag: <Tag>已结束</Tag> };
    }
    return {
      weight: 0,
      tag: (
        <Tag color="success">
          进行中 · Day {today.diff(start, "day") + 1}/{dayCount(trip)}
        </Tag>
      ),
    };
  };

  const sortedTrips = [...trips].sort((a, b) => {
    const wa = statusOf(a).weight;
    const wb = statusOf(b).weight;
    if (wa !== wb) return wa - wb;
    // 同状态按出发日期：未结束的近在前，已结束的近在前（倒序）
    return wa === 2
      ? dayjs(b.startDate).valueOf() - dayjs(a.startDate).valueOf()
      : dayjs(a.startDate).valueOf() - dayjs(b.startDate).valueOf();
  });

  // 弹窗组件（桌面/手机版共享）
  const sharedModals = mounted && (
    <>
      <TripFormModal
        open={modalOpen}
        trip={editing}
        onCancel={() => setModalOpen(false)}
        onSaved={() => {
          setModalOpen(false);
          load();
        }}
      />
      <AiPlanWizard
        open={wizardOpen}
        onCancel={() => setWizardOpen(false)}
        onCreated={(tripId, mode) => {
          setWizardOpen(false);
          load(); // 立即刷新列表，即使跳转缓慢/失败列表也是新的
          router.push(`/trips/${tripId}${mode === "coplan" ? "?coplan=1" : ""}`);
        }}
      />
      <GuideImportModal
        open={guideOpen}
        onCancel={() => setGuideOpen(false)}
        onCreated={(tripId) => {
          setGuideOpen(false);
          load();
          router.push(`/trips/${tripId}`);
        }}
      />
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleImportFile(file);
        }}
      />
    </>
  );

  // 检测中：短暂加载态，避免桌面/手机版本闪烁
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
        <MobileHome
          trips={sortedTrips}
          loading={loading}
          onOpenTrip={(tripId) => router.push(`/trips/${tripId}`)}
          onNewTrip={() => {
            setEditing(null);
            setModalOpen(true);
          }}
          onEditTrip={(trip) => {
            setEditing(trip);
            setModalOpen(true);
          }}
          onCopyTrip={(id) => handleCopy(id)}
          onDeleteTrip={(tripId) => {
            modal.confirm({
              title: "删除行程",
              content: "将同时删除日程、开销与清单",
              okText: "删除",
              okButtonProps: { danger: true },
              cancelText: "取消",
              onOk: () => handleDelete(tripId),
            });
          }}
          onAiPlan={() => setWizardOpen(true)}
          onImportGuide={() => setGuideOpen(true)}
          onImportBackup={() => fileRef.current?.click()}
        />
        {sharedModals}
      </>
    );
  }

  return (
    <>
      <div className="home-hero no-print">
        <h1>🧳 把想去的地方，交给 AI 谱成行程</h1>
        <p>一句话生成逐日行程，地图动线、预算开销、清单天气，一站式搞定。</p>
        <div className="hero-actions">
          <Button
            size="large"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
            style={{
              background: "#fff",
              color: "#0d9488",
              border: "none",
              fontWeight: 600,
              boxShadow: "0 4px 14px rgba(0, 0, 0, 0.12)",
            }}
          >
            新建行程
          </Button>
          <Button
            size="large"
            className="hero-ghost-btn"
            icon={<ThunderboltOutlined />}
            onClick={() => setWizardOpen(true)}
            style={{ fontWeight: 600 }}
          >
            ✨ AI 规划
          </Button>
          <Button
            size="large"
            className="hero-ghost-btn"
            icon={<ReadOutlined />}
            onClick={() => setGuideOpen(true)}
            style={{ fontWeight: 500 }}
          >
            导入攻略
          </Button>
          <Button
            size="large"
            className="hero-ghost-btn"
            icon={<UploadOutlined />}
            loading={importing}
            onClick={() => fileRef.current?.click()}
            style={{ fontWeight: 500 }}
          >
            导入备份
          </Button>
        </div>
      </div>

      {loading ? (
        <Card loading style={{ borderRadius: 14 }} />
      ) : trips.length === 0 ? (
        <div className="home-empty">
          <div
            style={{
              width: 80,
              height: 80,
              borderRadius: 20,
              background: "linear-gradient(135deg, #0d9488, #0891b2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 40,
              margin: "0 auto 20px",
              boxShadow: "0 8px 24px rgba(13, 148, 136, 0.25)",
            }}
          >
            🗺️
          </div>
          <Typography.Title level={4} style={{ marginTop: 0, marginBottom: 8 }}>
            还没有行程
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 24 }}>
            点「新建行程」手动规划，或试试「AI 规划」——一句话生成完整逐日行程。
          </Typography.Paragraph>
          <Space wrap>
            <Button
              type="primary"
              size="large"
              icon={<ThunderboltOutlined />}
              onClick={() => setWizardOpen(true)}
            >
              ✨ AI 帮我规划
            </Button>
            <Button
              size="large"
              icon={<PlusOutlined />}
              onClick={() => {
                setEditing(null);
                setModalOpen(true);
              }}
            >
              创建第一个行程
            </Button>
          </Space>
        </div>
      ) : (
        <Row gutter={[16, 16]}>
          {sortedTrips.map((trip) => {
            const isOwner = (trip.access?.role ?? "owner") === "owner";
            const status = statusOf(trip);
            return (
              <Col xs={24} sm={12} lg={8} xl={6} key={trip.id}>
                <Card
                  hoverable
                  size="small"
                  className="trip-card"
                  styles={{ body: { padding: 0 } }}
                  onClick={() => router.push(`/trips/${trip.id}`)}
                  actions={
                    isOwner
                      ? [
                          <span
                            key="copy"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopy(trip.id);
                            }}
                          >
                            <CopyOutlined /> 复制
                          </span>,
                          <span
                            key="edit"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditing(trip);
                              setModalOpen(true);
                            }}
                          >
                            <EditOutlined /> 编辑
                          </span>,
                          <Popconfirm
                            key="delete"
                            title="删除行程"
                            description="将同时删除日程、开销与清单"
                            okText="删除"
                            okButtonProps={{ danger: true }}
                            cancelText="取消"
                            onConfirm={(e) => {
                              e?.stopPropagation();
                              handleDelete(trip.id);
                            }}
                            onCancel={(e) => e?.stopPropagation()}
                          >
                            <span onClick={(e) => e.stopPropagation()}>
                              <DeleteOutlined /> 删除
                            </span>
                          </Popconfirm>,
                        ]
                      : undefined
                  }
                >
                  <div className="trip-card-cover" style={{ background: coverOf(trip) }}>
                    <div className="trip-card-title">{trip.title}</div>
                    <div className="trip-card-dest">
                      <EnvironmentOutlined style={{ fontSize: 13 }} />
                      {trip.destination}
                    </div>
                  </div>
                  <div className="trip-card-body">
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                        marginBottom: 10,
                      }}
                    >
                      <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                        <CalendarOutlined style={{ marginRight: 5 }} />
                        {dayjs(trip.startDate).format("M/D")} - {dayjs(trip.endDate).format("M/D")}
                      </Typography.Text>
                      {status.tag}
                    </div>
                    {!isOwner && (
                      <Tag
                        style={{ marginBottom: 10 }}
                        color={trip.access?.role === "edit" ? "processing" : "default"}
                      >
                        {(trip.owner?.displayName || trip.owner?.username || "他人") + " 共享"}
                        {trip.access?.role === "edit" ? " · 可编辑" : " · 只读"}
                      </Tag>
                    )}
                    {trip.places && trip.places.length > 0 && (
                      <div className="trip-card-places">
                        {trip.places.slice(0, 4).map((p, i) => (
                          <span key={i} className="trip-card-place">
                            {p}
                          </span>
                        ))}
                        {trip.places.length > 4 && (
                          <span className="trip-card-place-more">+{trip.places.length - 4}</span>
                        )}
                      </div>
                    )}
                    <div className="trip-card-stats">
                      <span className="stat">
                        <div className="v">{dayCount(trip)}</div>
                        <div className="l">天数</div>
                      </span>
                      <span className="stat">
                        <div className="v">{trip._count?.items ?? 0}</div>
                        <div className="l">行程项</div>
                      </span>
                      {trip.budgetTotal != null && (
                        <span className="stat">
                          <div className="v">¥{trip.budgetTotal.toLocaleString()}</div>
                          <div className="l">预算</div>
                        </span>
                      )}
                    </div>
                  </div>
                </Card>
              </Col>
            );
          })}
        </Row>
      )}

      {sharedModals}
    </>
  );
}
