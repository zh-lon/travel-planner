"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Card, Col, Empty, Popconfirm, Row, Space, Tag, Typography } from "antd";
import {
  CalendarOutlined,
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
import TripFormModal from "@/components/TripFormModal";
import type { TripSummary } from "@/types";

export default function HomePage() {
  const { message } = App.useApp();
  const router = useRouter();
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TripSummary | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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

  return (
    <>
      <Card
        title="我的行程"
        loading={loading}
        extra={
          <Space wrap>
            <Button icon={<ThunderboltOutlined />} onClick={() => setWizardOpen(true)}>
              AI 规划
            </Button>
            <Button icon={<ReadOutlined />} onClick={() => setGuideOpen(true)}>
              导入攻略
            </Button>
            <Button icon={<UploadOutlined />} loading={importing} onClick={() => fileRef.current?.click()}>
              导入备份
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setEditing(null);
                setModalOpen(true);
              }}
            >
              新建行程
            </Button>
          </Space>
        }
      >
        {trips.length === 0 ? (
          <Empty
            description="还没有行程 — 点「新建行程」手动规划，或试试「AI 规划」一键生成"
            style={{ padding: "48px 0" }}
          />
        ) : (
          <Row gutter={[16, 16]}>
            {trips.map((trip) => (
              <Col xs={24} sm={12} lg={8} key={trip.id}>
                <Card
                  hoverable
                  size="small"
                  onClick={() => router.push(`/trips/${trip.id}`)}
                  actions={[
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
                  ]}
                >
                  <Typography.Title level={5} style={{ marginTop: 0, marginBottom: 8 }}>
                    {trip.title}
                  </Typography.Title>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span>
                      <EnvironmentOutlined style={{ color: "#1677ff", marginRight: 6 }} />
                      <Tag color="blue">{trip.destination}</Tag>
                    </span>
                    <Typography.Text type="secondary">
                      <CalendarOutlined style={{ marginRight: 6 }} />
                      {dayjs(trip.startDate).format("YYYY/M/D")} -{" "}
                      {dayjs(trip.endDate).format("YYYY/M/D")} · {dayCount(trip)} 天
                    </Typography.Text>
                    <Typography.Text type="secondary">
                      {trip._count?.items ?? 0} 个行程项
                      {trip.budgetTotal != null
                        ? ` · 预算 ¥${trip.budgetTotal.toLocaleString()}`
                        : ""}
                    </Typography.Text>
                  </div>
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </Card>

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
        onCreated={(tripId) => {
          setWizardOpen(false);
          load(); // 立即刷新列表，即使跳转缓慢/失败列表也是新的
          router.push(`/trips/${tripId}`);
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
    </>
  );
}
