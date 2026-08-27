"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Checkbox, Descriptions, Divider, Input, List, Modal, Popconfirm, Tag, Typography } from "antd";
import {
  DeleteOutlined,
  DiffOutlined,
  EditOutlined,
  EnvironmentOutlined,
  EyeOutlined,
  HistoryOutlined,
  RollbackOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";

interface SnapshotItem {
  id: string;
  label: string;
  createdAt: string;
}

interface SnapDetailItem {
  dayIndex: number;
  sortOrder: number;
  type: string;
  title: string;
  startTime: string | null;
  endTime: string | null;
  placeName: string | null;
  estimatedCost: number | null;
  notes: string | null;
}

interface SnapDetail {
  dayCount: number;
  items: SnapDetailItem[];
  createdAt: string;
}

interface Props {
  open: boolean;
  tripId: string;
  onCancel: () => void;
  onRestored: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  SIGHT: "景点",
  TRANSPORT: "交通",
  HOTEL: "住宿",
  FOOD: "餐饮",
  SHOPPING: "购物",
  OTHER: "其他",
};

const TYPE_COLORS: Record<string, string> = {
  SIGHT: "blue",
  TRANSPORT: "orange",
  HOTEL: "purple",
  FOOD: "green",
  SHOPPING: "magenta",
  OTHER: "default",
};

type DiffStatus = "added" | "removed" | "modified" | "unchanged";

interface DiffItem {
  dayIndex: number;
  status: DiffStatus;
  oldItem: SnapDetailItem | null;
  newItem: SnapDetailItem | null;
  changedFields: string[];
}

// 生成 item 唯一键：title + dayIndex
function itemKey(item: SnapDetailItem): string {
  return `${item.dayIndex}|${item.title}`;
}

// 比较两个 item 的不同字段
function changedFields(oldItem: SnapDetailItem, newItem: SnapDetailItem): string[] {
  const fields: string[] = [];
  const compareKeys: (keyof SnapDetailItem)[] = [
    "type", "startTime", "endTime", "placeName",
    "estimatedCost", "notes", "sortOrder",
  ];
  for (const k of compareKeys) {
    if (oldItem[k] !== newItem[k]) {
      const labels: Record<string, string> = {
        type: "类型", startTime: "开始时间", endTime: "结束时间",
        placeName: "地点", estimatedCost: "费用", notes: "备注", sortOrder: "排序",
      };
      fields.push(labels[k] ?? k);
    }
  }
  return fields;
}

const CURRENT_ID = "__current__";

export default function SnapshotPanel({ open, tripId, onCancel, onRestored }: Props) {
  const { message } = App.useApp();
  const [snapshots, setSnapshots] = useState<SnapshotItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);

  // 查看详情
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailData, setDetailData] = useState<SnapDetail | null>(null);
  const [detailLabel, setDetailLabel] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);

  // 对比模式
  const [compareMode, setCompareMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareDataA, setCompareDataA] = useState<SnapDetail | null>(null);
  const [compareDataB, setCompareDataB] = useState<SnapDetail | null>(null);
  const [compareLabelA, setCompareLabelA] = useState("");
  const [compareLabelB, setCompareLabelB] = useState("");
  const [compareLoading, setCompareLoading] = useState(false);

  // 重命名
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLDivElement>(null);

  const loadSnapshots = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/snapshots`);
      if (res.ok) {
        setSnapshots(await res.json());
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      loadSnapshots();
      setCompareMode(false);
      setSelectedIds([]);
    }
  }, [open, tripId]);

  const handleView = async (snapId: string, label: string) => {
    setDetailLoading(true);
    setDetailLabel(label);
    setDetailOpen(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/snapshots/${snapId}`);
      if (res.ok) {
        setDetailData(await res.json());
      }
    } catch {
      message.error("加载快照详情失败");
    } finally {
      setDetailLoading(false);
    }
  };

  const handleRestore = async (snapId: string, label: string) => {
    setRestoring(snapId);
    try {
      const res = await fetch(`/api/trips/${tripId}/snapshots/${snapId}/restore`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        dayCount?: number;
        itemCount?: number;
        error?: string;
      };
      if (res.ok && data.ok) {
        message.success(`已从「${label}」恢复（${data.dayCount}天 · ${data.itemCount}项）`);
        onRestored();
        onCancel();
      } else {
        throw new Error(data.error);
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : "恢复失败");
    } finally {
      setRestoring(null);
    }
  };

  const handleDelete = async (snapId: string) => {
    try {
      const res = await fetch(`/api/trips/${tripId}/snapshots/${snapId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setSnapshots((prev) => prev.filter((s) => s.id !== snapId));
        setSelectedIds((prev) => prev.filter((id) => id !== snapId));
        message.success("已删除快照");
      }
    } catch {
      message.error("删除失败");
    }
  };

  const handleCreate = async () => {
    const hide = message.loading("正在保存快照…");
    try {
      const res = await fetch(`/api/trips/${tripId}/snapshots`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: `手动保存 - ${dayjs().format("MM-DD HH:mm")}` }),
      });
      if (res.ok) {
        message.success("快照已保存");
        loadSnapshots();
      }
    } catch {
      message.error("保存失败");
    } finally {
      hide();
    }
  };

  const handleRenameStart = (id: string, label: string) => {
    setRenameId(id);
    setRenameValue(label);
    // 等下一帧聚焦
    setTimeout(() => {
      const input = renameInputRef.current?.querySelector("input");
      input?.focus();
      input?.select();
    }, 50);
  };

  const handleRenameSubmit = async (id: string) => {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === snapshots.find((s) => s.id === id)?.label) {
      setRenameId(null);
      return;
    }
    try {
      const res = await fetch(`/api/trips/${tripId}/snapshots/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: trimmed }),
      });
      if (res.ok) {
        setSnapshots((prev) => prev.map((s) => (s.id === id ? { ...s, label: trimmed } : s)));
      }
    } catch {
      message.error("重命名失败");
    } finally {
      setRenameId(null);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  };

  const handleCompare = async () => {
    if (selectedIds.length !== 2) return;

    // 当前版本固定为"变更后"（较新），快照为"变更前"
    const hasCurrent = selectedIds.includes(CURRENT_ID);
    const snapId = selectedIds.find((id) => id !== CURRENT_ID)!;
    const snap = snapshots.find((s) => s.id === snapId);
    if (!snap) return;

    let labelA: string;
    let labelB: string;
    let fetchA: () => Promise<SnapDetail>;
    let fetchB: () => Promise<SnapDetail>;

    if (hasCurrent) {
      labelA = snap.label;
      labelB = "当前版本";
      fetchA = () => fetch(`/api/trips/${tripId}/snapshots/${snap.id}`).then((r) => r.json());
      fetchB = fetchCurrentTripData;
    } else {
      const snapId2 = selectedIds.find((id) => id !== snapId)!;
      const snap2 = snapshots.find((s) => s.id === snapId2);
      if (!snap2) return;
      const sorted = [snap, snap2].sort((a, b) => dayjs(a.createdAt).valueOf() - dayjs(b.createdAt).valueOf());
      labelA = sorted[0].label;
      labelB = sorted[1].label;
      fetchA = () => fetch(`/api/trips/${tripId}/snapshots/${sorted[0].id}`).then((r) => r.json());
      fetchB = () => fetch(`/api/trips/${tripId}/snapshots/${sorted[1].id}`).then((r) => r.json());
    }

    setCompareLabelA(labelA);
    setCompareLabelB(labelB);
    setCompareOpen(true);
    setCompareLoading(true);
    try {
      const [dataA, dataB] = await Promise.all([fetchA(), fetchB()]);
      setCompareDataA(dataA);
      setCompareDataB(dataB);
    } catch {
      message.error("加载对比数据失败");
    } finally {
      setCompareLoading(false);
    }
  };

  // 获取当前行程数据并转换为 SnapDetail 格式
  const fetchCurrentTripData = async (): Promise<SnapDetail> => {
    const res = await fetch(`/api/trips/${tripId}`);
    if (!res.ok) throw new Error("获取当前行程失败");
    const trip = await res.json();
    const items: SnapDetailItem[] = (trip.items ?? []).map((i: Record<string, unknown>) => ({
      dayIndex: i.dayIndex as number,
      sortOrder: i.sortOrder as number,
      type: (i.type as string) ?? "OTHER",
      title: (i.title as string) ?? "",
      startTime: (i.startTime as string) ?? null,
      endTime: (i.endTime as string) ?? null,
      placeName: (i.placeName as string) ?? null,
      estimatedCost: (i.estimatedCost as number) ?? null,
      notes: (i.notes as string) ?? null,
    }));
    const dayCount = trip.startDate && trip.endDate
      ? dayjs(trip.endDate as string).diff(dayjs(trip.startDate as string), "day") + 1
      : 1;
    return { dayCount, items, createdAt: new Date().toISOString() };
  };

  // 计算 diff 结果
  const diffItems = useMemo<DiffItem[]>(() => {
    if (!compareDataA || !compareDataB) return [];
    const oldItems = compareDataA.items;
    const newItems = compareDataB.items;

    const oldMap = new Map<string, SnapDetailItem>();
    const newMap = new Map<string, SnapDetailItem>();
    for (const item of oldItems) oldMap.set(itemKey(item), item);
    for (const item of newItems) newMap.set(itemKey(item), item);

    const allKeys = new Set([...oldMap.keys(), ...newMap.keys()]);
    const result: DiffItem[] = [];

    for (const key of allKeys) {
      const oldItem = oldMap.get(key) ?? null;
      const newItem = newMap.get(key) ?? null;
      const dayIndex = oldItem?.dayIndex ?? newItem!.dayIndex;
      let status: DiffStatus;
      let changed: string[] = [];
      if (oldItem && newItem) {
        changed = changedFields(oldItem, newItem);
        status = changed.length > 0 ? "modified" : "unchanged";
      } else if (oldItem && !newItem) {
        status = "removed";
      } else {
        status = "added";
      }
      result.push({ dayIndex, status, oldItem, newItem, changedFields: changed });
    }

    // 按 dayIndex 排序，同天内按 status 分组（removed → modified → added → unchanged）
    const statusOrder: Record<DiffStatus, number> = { removed: 0, modified: 1, added: 2, unchanged: 3 };
    result.sort((a, b) => {
      if (a.dayIndex !== b.dayIndex) return a.dayIndex - b.dayIndex;
      return statusOrder[a.status] - statusOrder[b.status];
    });
    return result;
  }, [compareDataA, compareDataB]);

  const diffStatusLabel: Record<DiffStatus, string> = {
    added: "新增",
    removed: "删除",
    modified: "变更",
    unchanged: "未变",
  };
  const diffStatusColor: Record<DiffStatus, string> = {
    added: "#52c41a",
    removed: "#ff4d4f",
    modified: "#fa8c16",
    unchanged: "#999",
  };
  const diffBgColor: Record<DiffStatus, string> = {
    added: "#f6ffed",
    removed: "#fff2f0",
    modified: "#fff7e6",
    unchanged: "transparent",
  };

  // 按天分组（详情弹窗）
  const groupedByDay = detailData
    ? Array.from({ length: detailData.dayCount }, (_, d) => ({
        day: d + 1,
        items: detailData.items
          .filter((i) => i.dayIndex === d)
          .sort((a, b) => a.sortOrder - b.sortOrder),
      }))
    : [];

  // 按天分组（对比弹窗）
  const maxDay = Math.max(compareDataA?.dayCount ?? 0, compareDataB?.dayCount ?? 0);
  const diffGroupedByDay = Array.from({ length: maxDay }, (_, d) => ({
    day: d + 1,
    items: diffItems.filter((i) => i.dayIndex === d),
  }));

  // 对比视图的 item 渲染
  const renderDiffItem = (di: DiffItem) => {
    const item = di.newItem ?? di.oldItem!;
    const color = diffStatusColor[di.status];
    return (
      <div
        key={itemKey(item)}
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
          padding: "6px 8px",
          background: diffBgColor[di.status],
          borderRadius: 4,
          marginBottom: 4,
        }}
      >
        <Tag color={color} style={{ flexShrink: 0, margin: 0, fontSize: 11 }}>
          {diffStatusLabel[di.status]}
        </Tag>
        <Tag color={TYPE_COLORS[item.type] ?? "default"} style={{ flexShrink: 0, margin: 0 }}>
          {TYPE_LABELS[item.type] ?? item.type}
        </Tag>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, lineHeight: "20px" }}>
            {item.startTime && (
              <span style={{ color: "#0d9488", marginRight: 4 }}>
                {item.startTime}
                {item.endTime ? `-${item.endTime}` : ""}
              </span>
            )}
            {item.title}
          </div>
          <div style={{ fontSize: 12, color: "#999", marginTop: 2 }}>
            {item.placeName && (
              <span>
                <EnvironmentOutlined style={{ marginRight: 2 }} />
                {item.placeName}
              </span>
            )}
            {item.estimatedCost != null && (
              <span style={{ marginLeft: 8 }}>¥{item.estimatedCost}</span>
            )}
            {di.status === "modified" && di.changedFields.length > 0 && (
              <span style={{ marginLeft: 8, color: "#fa8c16" }}>
                变更：{di.changedFields.join("、")}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  };

  // 统计
  const diffStats = useMemo(() => {
    const counts = { added: 0, removed: 0, modified: 0, unchanged: 0 };
    for (const d of diffItems) counts[d.status]++;
    return counts;
  }, [diffItems]);

  return (
    <>
      {/* 版本历史列表 */}
      <Modal
        title={
          <span>
            <HistoryOutlined style={{ color: "#0d9488", marginRight: 8 }} />
            版本历史
          </span>
        }
        open={open}
        onCancel={onCancel}
        width={560}
        footer={[
          compareMode ? (
            <Button
              key="compare"
              type="primary"
              icon={<DiffOutlined />}
              disabled={selectedIds.length !== 2}
              onClick={handleCompare}
            >
              对比选中版本（{selectedIds.length}/2）
            </Button>
          ) : (
            <Button key="compareMode" icon={<DiffOutlined />} onClick={() => setCompareMode(true)}>
              对比模式
            </Button>
          ),
          <Button key="create" icon={<HistoryOutlined />} onClick={handleCreate}>
            手动保存当前版本
          </Button>,
          <Button key="close" onClick={onCancel}>
            关闭
          </Button>,
        ]}
      >
        {compareMode && (
          <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 8 }}>
            勾选两个版本进行对比，旧版本为"变更前"，新版本为"变更后"
          </Typography.Text>
        )}
        {!compareMode && (
          <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 12 }}>
            AI 修改行程前会自动保存版本，你可以随时查看、恢复到任意历史版本。
          </Typography.Text>
        )}
        {snapshots.length === 0 && !loading ? (
          <Typography.Text type="secondary">暂无版本快照</Typography.Text>
        ) : (
          <List
            loading={loading}
            dataSource={compareMode ? [{ id: CURRENT_ID, label: "当前版本（此刻的行程数据）", createdAt: "" }, ...snapshots] : snapshots}
            renderItem={(item) => {
              const isCurrent = item.id === CURRENT_ID;
              return (
              <List.Item
                actions={
                  compareMode
                    ? [
                        <Checkbox
                          key="select"
                          checked={selectedIds.includes(item.id)}
                          onChange={() => toggleSelect(item.id)}
                        />,
                      ]
                    : isCurrent ? [] : [
                        <Button
                          key="view"
                          type="link"
                          size="small"
                          icon={<EyeOutlined />}
                          onClick={() => handleView(item.id, item.label)}
                        >
                          查看
                        </Button>,
                        <Popconfirm
                          key="restore"
                          title="恢复到此版本？"
                          description="当前行程将被替换为快照中的内容，此操作不可撤销。"
                          okText="确认恢复"
                          cancelText="取消"
                          onConfirm={() => handleRestore(item.id, item.label)}
                        >
                          <Button
                            type="link"
                            size="small"
                            icon={<RollbackOutlined />}
                            loading={restoring === item.id}
                            style={{ color: "#0d9488" }}
                          >
                            恢复
                          </Button>
                        </Popconfirm>,
                        <Popconfirm
                          key="delete"
                          title="删除此快照？"
                          okText="删除"
                          cancelText="取消"
                          onConfirm={() => handleDelete(item.id)}
                        >
                          <Button
                            type="link"
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                          >
                            删除
                          </Button>
                        </Popconfirm>,
                      ]
                }
              >
                <List.Item.Meta
                  title={
                    renameId === item.id ? (
                      <div ref={renameInputRef}>
                        <Input
                          size="small"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onPressEnter={() => handleRenameSubmit(item.id)}
                          onBlur={() => handleRenameSubmit(item.id)}
                          onKeyDown={(e) => { if (e.key === "Escape") setRenameId(null); }}
                          style={{ fontSize: 13, width: "100%" }}
                        />
                      </div>
                    ) : (
                      <span style={{ fontSize: 13 }}>
                        {isCurrent ? (
                          <EnvironmentOutlined style={{ marginRight: 6, color: "#0d9488" }} />
                        ) : (
                          <HistoryOutlined style={{ marginRight: 6, color: "#999" }} />
                        )}
                        {item.label}
                        {!isCurrent && !compareMode && (
                          <Button
                            type="text"
                            size="small"
                            icon={<EditOutlined />}
                            onClick={(e) => { e.stopPropagation(); handleRenameStart(item.id, item.label); }}
                            style={{ color: "#bbb", marginLeft: 4, padding: "0 2px", fontSize: 12 }}
                          />
                        )}
                      </span>
                    )
                  }
                  description={
                    renameId === item.id ? null : (
                      <span style={{ fontSize: 11, color: "#999" }}>
                        {isCurrent ? "当前实时数据" : dayjs(item.createdAt).format("YYYY-MM-DD HH:mm:ss")}
                      </span>
                    )
                  }
                />
              </List.Item>
              );
            }}
          />
        )}
      </Modal>

      {/* 快照详情弹窗 */}
      <Modal
        title={
          <span>
            <EyeOutlined style={{ color: "#0d9488", marginRight: 8 }} />
            快照详情：{detailLabel}
          </span>
        }
        open={detailOpen}
        onCancel={() => { setDetailOpen(false); setDetailData(null); }}
        width={640}
        footer={
          <Button onClick={() => { setDetailOpen(false); setDetailData(null); }}>关闭</Button>
        }
      >
        {detailLoading ? (
          <Typography.Text type="secondary">加载中…</Typography.Text>
        ) : detailData ? (
          <div style={{ maxHeight: "60vh", overflowY: "auto" }}>
            <Descriptions size="small" column={2} style={{ marginBottom: 12 }}>
              <Descriptions.Item label="保存时间">
                {dayjs(detailData.createdAt).format("YYYY-MM-DD HH:mm:ss")}
              </Descriptions.Item>
              <Descriptions.Item label="行程天数">{detailData.dayCount} 天</Descriptions.Item>
              <Descriptions.Item label="行程项数">{detailData.items.length} 项</Descriptions.Item>
            </Descriptions>
            {groupedByDay.map((day) => (
              <div key={day.day} style={{ marginBottom: 16 }}>
                <Divider orientation="left" style={{ fontSize: 13, margin: "8px 0" }}>
                  第 {day.day} 天
                  {day.items.length === 0 && (
                    <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 6 }}>
                      （暂无安排）
                    </Typography.Text>
                  )}
                </Divider>
                {day.items.map((item, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 8,
                      padding: "6px 0",
                      borderBottom: idx < day.items.length - 1 ? "1px solid #f0f0f0" : "none",
                    }}
                  >
                    <Tag color={TYPE_COLORS[item.type] ?? "default"} style={{ flexShrink: 0, margin: 0 }}>
                      {TYPE_LABELS[item.type] ?? item.type}
                    </Tag>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, lineHeight: "20px" }}>
                        {item.startTime && (
                          <span style={{ color: "#0d9488", marginRight: 4 }}>
                            {item.startTime}
                            {item.endTime ? `-${item.endTime}` : ""}
                          </span>
                        )}
                        {item.title}
                      </div>
                      <div style={{ fontSize: 12, color: "#999", marginTop: 2 }}>
                        {item.placeName && (
                          <span>
                            <EnvironmentOutlined style={{ marginRight: 2 }} />
                            {item.placeName}
                          </span>
                        )}
                        {item.estimatedCost != null && (
                          <span style={{ marginLeft: 8 }}>¥{item.estimatedCost}</span>
                        )}
                        {item.notes && (
                          <span style={{ marginLeft: 8, color: "#bbb" }}>{item.notes}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <Typography.Text type="secondary">加载失败</Typography.Text>
        )}
      </Modal>

      {/* 版本对比弹窗 */}
      <Modal
        title={
          <span>
            <DiffOutlined style={{ color: "#0d9488", marginRight: 8 }} />
            版本对比
          </span>
        }
        open={compareOpen}
        onCancel={() => { setCompareOpen(false); setCompareDataA(null); setCompareDataB(null); }}
        width={700}
        footer={
          <Button onClick={() => { setCompareOpen(false); setCompareDataA(null); setCompareDataB(null); }}>
            关闭
          </Button>
        }
      >
        {compareLoading ? (
          <Typography.Text type="secondary">加载中…</Typography.Text>
        ) : compareDataA && compareDataB ? (
          <div style={{ maxHeight: "60vh", overflowY: "auto" }}>
            {/* 对比概览 */}
            <Descriptions size="small" column={2} style={{ marginBottom: 12 }}>
              <Descriptions.Item label="变更前">
                {compareLabelA}（{compareDataA.createdAt ? dayjs(compareDataA.createdAt).format("MM-DD HH:mm") : "当前"}）
              </Descriptions.Item>
              <Descriptions.Item label="变更后">
                {compareLabelB}（{compareDataB.createdAt ? dayjs(compareDataB.createdAt).format("MM-DD HH:mm") : "当前"}）
              </Descriptions.Item>
            </Descriptions>

            {/* 变更统计 */}
            <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
              {(["added", "removed", "modified", "unchanged"] as DiffStatus[]).map((s) => (
                <div
                  key={s}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 12,
                    color: diffStatusColor[s],
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      width: 8,
                      height: 8,
                      borderRadius: 2,
                      background: diffStatusColor[s],
                    }}
                  />
                  {diffStatusLabel[s]} {diffStats[s]}
                </div>
              ))}
            </div>

            {/* 按天对比 */}
            {diffGroupedByDay.map((day) => {
              const hasChanges = day.items.some((i) => i.status !== "unchanged");
              if (!hasChanges) return null;
              return (
                <div key={day.day} style={{ marginBottom: 16 }}>
                  <Divider orientation="left" style={{ fontSize: 13, margin: "8px 0" }}>
                    第 {day.day} 天
                  </Divider>
                  {day.items.map(renderDiffItem)}
                </div>
              );
            })}

            {/* 无变更提示 */}
            {diffStats.added === 0 && diffStats.removed === 0 && diffStats.modified === 0 && (
              <Typography.Text type="secondary">两个版本完全相同，没有变更</Typography.Text>
            )}
          </div>
        ) : (
          <Typography.Text type="secondary">加载失败</Typography.Text>
        )}
      </Modal>
    </>
  );
}