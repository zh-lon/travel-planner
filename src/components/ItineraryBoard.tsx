"use client";

import { useCallback, useEffect, useRef, useState, type HTMLAttributes } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type CollisionDetection,
  type DroppableContainer,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, horizontalListSortingStrategy, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { DeleteOutlined, EnvironmentOutlined, HolderOutlined, LeftOutlined, MoreOutlined, PlusOutlined, RightOutlined } from "@ant-design/icons";
import { Button, Dropdown, Popconfirm, Tag, Typography } from "antd";
import type { Dayjs } from "dayjs";
import { itemTypeMeta } from "@/types/constants";
import type { ItineraryItemT } from "@/types";

interface BoardProps {
  startDate: Dayjs;
  dayCount: number;
  items: ItineraryItemT[];
  weather?: Record<number, string>; // dayIndex → 天气描述
  readOnly?: boolean; // 只读共享：隐藏所有编辑入口并禁用拖拽
  onAddItem: (dayIndex: number, insertAfterSortOrder?: number) => void;
  onEditItem: (item: ItineraryItemT) => void;
  onDeleteItem: (item: ItineraryItemT) => void; // 卡片上直接删除
  onReorder: (items: ItineraryItemT[]) => void;
  onInsertDay: (dayIndex: number) => void; // 在该位置插入一天（= dayCount 表示末尾追加）
  onRemoveDay: (dayIndex: number) => void;
}

function buildColumns(items: ItineraryItemT[], dayCount: number): ItineraryItemT[][] {
  const cols: ItineraryItemT[][] = Array.from({ length: dayCount }, () => []);
  [...items]
    .sort((a, b) => a.dayIndex - b.dayIndex || a.sortOrder - b.sortOrder)
    .forEach((item) => {
      const day = Math.min(Math.max(item.dayIndex, 0), dayCount - 1);
      cols[day].push(item);
    });
  return cols;
}

// 当天节奏评估（参考行谱「节奏：健康」徽章）：按活动时长 + 条目数粗估
function dayPace(items: ItineraryItemT[]): { label: string; color: string } | null {
  const active = items.filter((i) => i.type !== "TRANSPORT" && i.type !== "HOTEL");
  if (active.length === 0) return null;
  const toMin = (t: string | null) => {
    const m = t ? /^(\d{1,2}):(\d{2})$/.exec(t) : null;
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  let hours = 0;
  for (const i of active) {
    const s = toMin(i.startTime);
    const e = toMin(i.endTime);
    hours += s != null && e != null && e > s ? (e - s) / 60 : 1.5; // 无时间按 1.5h 估
  }
  if (active.length >= 6 || hours > 9) return { label: "偏赶", color: "orange" };
  if (active.length <= 2 && hours <= 4) return { label: "轻松", color: "cyan" };
  return { label: "健康", color: "green" };
}

// 社交平台搜索直达（参考行谱 POI 卡）：拼 URL 即可，无需任何 API
const SOCIAL_SEARCHES = [
  { key: "xhs", label: "小红书", url: (q: string) => `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(q)}` },
  { key: "douyin", label: "抖音", url: (q: string) => `https://www.douyin.com/search/${encodeURIComponent(q)}` },
  { key: "baidu", label: "百度", url: (q: string) => `https://www.baidu.com/s?wd=${encodeURIComponent(q)}` },
];

// 自定义碰撞检测：优先检测指针是否在 day 列内（确保空天也能被识别），
// 若在列内且指针也在某个 sortable item 内则返回 item，否则返回 day 列
function makeCollisionDetection(): CollisionDetection {
  return (args) => {
    const { active, droppableContainers, pointerCoordinates } = args;
    if (!pointerCoordinates) return [];
    const activeId = String(active.id);
    const isDraggingDay = activeId.startsWith("day-");

    // 先找出所有 day 列和所有 sortable item
    const dayCols: DroppableContainer[] = [];
    const sortables: DroppableContainer[] = [];
    for (const c of droppableContainers) {
      const id = String(c.id);
      if (id.startsWith("day-")) {
        dayCols.push(c);
      } else {
        sortables.push(c);
      }
    }

    // 拖动整列天：按指针所在的目标天列横向重排
    if (isDraggingDay) {
      for (const col of dayCols) {
        if (String(col.id) === activeId) continue;
        const r = col.rect.current;
        if (!r) continue;
        if (pointerCoordinates.x >= r.left && pointerCoordinates.x <= r.right) {
          return [{ id: col.id }];
        }
      }
      return [];
    }

    // 检查指针是否在某个 day 列内
    for (const col of dayCols) {
      const r = col.rect.current;
      if (!r) continue;
      if (
        pointerCoordinates.x >= r.left &&
        pointerCoordinates.x <= r.right &&
        pointerCoordinates.y >= r.top &&
        pointerCoordinates.y <= r.bottom
      ) {
        // 指针在 day 列内 → 再检查是否在某个 sortable item 内
        for (const s of sortables) {
          const sr = s.rect.current;
          if (!sr) continue;
          if (
            pointerCoordinates.x >= sr.left &&
            pointerCoordinates.x <= sr.right &&
            pointerCoordinates.y >= sr.top &&
            pointerCoordinates.y <= sr.bottom
          ) {
            return [{ id: s.id }];
          }
        }
        // 在 day 列内但不在任何 item 内 → 空天
        return [{ id: col.id }];
      }
    }

    // 指针不在任何 day 列内 → 回退到 closestCenter
    return closestCenter(args);
  };
}

function signature(cols: ItineraryItemT[][]): string {
  return cols.map((col) => col.map((i) => i.id).join(",")).join("|");
}

// antd Tag 颜色名 → hex
const TAG_COLOR_HEX: Record<string, string> = {
  green: "#52c41a",
  blue: "#1677ff",
  purple: "#722ed1",
  orange: "#fa8c16",
  magenta: "#eb2f96",
  default: "#d9d9d9",
};

function ItemCardBody({
  item,
  onClick,
  handleProps,
  dragging,
  onDelete,
}: {
  item: ItineraryItemT;
  onClick?: () => void;
  handleProps?: HTMLAttributes<HTMLSpanElement>;
  dragging?: boolean;
  onDelete?: () => void;
}) {
  const meta = itemTypeMeta(item.type);
  const accent = TAG_COLOR_HEX[meta.color] ?? "#d9d9d9";
  return (
    <div
      onClick={onClick}
      className="board-item-card"
      style={{
        padding: "10px 12px 10px 14px",
        boxShadow: dragging ? "0 6px 18px rgba(0,0,0,.14)" : undefined,
        borderColor: dragging ? "#99d5cf" : undefined,
        ["--accent" as string]: accent,
      }}
    >
      <span
        {...handleProps}
        onClick={(e) => e.stopPropagation()}
        style={{
          cursor: "grab",
          color: "#c5c5c5",
          touchAction: "none",
          display: handleProps ? undefined : "none",
          paddingTop: 2,
          transition: "color 0.2s",
        }}
      >
        <HolderOutlined />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <Tag color={meta.color} style={{ marginRight: 0, flexShrink: 0, fontSize: 11, lineHeight: "20px" }}>
            {meta.label}
          </Tag>
          <Typography.Text strong ellipsis style={{ flex: 1, fontSize: 13 }}>
            {item.title}
          </Typography.Text>
          {onDelete && (
            // 外层包裹拦截气泡内容的点击冒泡（React Portal 会沿组件树冒泡到卡片 onClick，
            // 导致点确认/取消时误打开详情）
            <span onClick={(e) => e.stopPropagation()} style={{ flexShrink: 0, lineHeight: 0 }}>
              <Popconfirm
                title="删除这个行程项？"
                okText="删除"
                okButtonProps={{ danger: true, size: "small" }}
                cancelText="取消"
                onConfirm={onDelete}
              >
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  className="board-item-del"
                  onClick={(e) => e.stopPropagation()}
                  title="删除"
                />
              </Popconfirm>
            </span>
          )}
        </div>
        {(item.startTime || item.placeName || item.estimatedCost != null || item.needBooking) && (
          <div
            style={{
              marginTop: 5,
              fontSize: 12,
              color: "#8c8c8c",
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
            }}
          >
            {item.startTime && (
              <span style={{ color: "#0d9488", fontWeight: 500 }}>
                {item.startTime}
                {item.endTime ? ` - ${item.endTime}` : ""}
              </span>
            )}
            {item.placeName && (
              <span>
                <EnvironmentOutlined /> {item.placeName}
              </span>
            )}
            {item.estimatedCost != null && <span>¥{item.estimatedCost.toLocaleString()}</span>}
            {item.needBooking && (
              <span style={{ color: "#d46b08", fontWeight: 500 }}>需预约</span>
            )}
          </div>
        )}
        {item.notes && (
          <div
            style={{
              marginTop: 5,
              fontSize: 12,
              color: "#666",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              background: "#f9fbfb",
              borderRadius: 6,
              padding: "4px 8px",
              lineHeight: 1.5,
              border: "1px solid #eef2f2",
            }}
          >
            📝 {item.notes}
          </div>
        )}
        {(item.placeName || item.type === "SIGHT" || item.type === "FOOD") && (
          <div style={{ marginTop: 5, fontSize: 11, display: "flex", gap: 8 }}>
            {SOCIAL_SEARCHES.map((s) => (
              <a
                key={s.key}
                href={s.url(item.placeName || item.title)}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={{ color: "#b3b3b3", transition: "color 0.2s" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#0d9488")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "#b3b3b3")}
                title={`在${s.label}搜索「${item.placeName || item.title}」`}
              >
                {s.label}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SortableItemCard({
  item,
  readOnly,
  onEdit,
  onDelete,
}: {
  item: ItineraryItemT;
  readOnly?: boolean;
  onEdit: (item: ItineraryItemT) => void;
  onDelete: (item: ItineraryItemT) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.35 : 1,
      }}
    >
      <ItemCardBody
        item={item}
        onClick={() => onEdit(item)}
        handleProps={
          readOnly ? undefined : ({ ...attributes, ...listeners } as HTMLAttributes<HTMLSpanElement>)
        }
        onDelete={readOnly ? undefined : () => onDelete(item)}
      />
    </div>
  );
}

function DayColumn({
  dayIndex,
  dayCount,
  date,
  items,
  weather,
  readOnly,
  onAddItem,
  onEditItem,
  onDeleteItem,
  onInsertDay,
  onRemoveDay,
  onMoveDay,
}: {
  dayIndex: number;
  dayCount: number;
  date: Dayjs;
  items: ItineraryItemT[];
  weather?: string;
  readOnly?: boolean;
  onAddItem: (dayIndex: number, insertAfterSortOrder?: number) => void;
  onEditItem: (item: ItineraryItemT) => void;
  onDeleteItem: (item: ItineraryItemT) => void;
  onInsertDay: (dayIndex: number) => void;
  onRemoveDay: (dayIndex: number) => void;
  onMoveDay: (from: number, to: number) => void;
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging, isOver } = useSortable({
    id: `day-${dayIndex}`,
  });
  const cost = items.reduce((sum, i) => sum + (i.estimatedCost ?? 0), 0);
  const pace = dayPace(items);
  return (
    <div
      ref={setNodeRef}
      className={`board-day-col${isOver ? " drag-over" : ""}`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      <div style={{ marginBottom: 12, display: "flex", alignItems: "flex-start", gap: 4 }}>
        {!readOnly && (
          <span
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
            className="board-day-grip"
            title="拖动调整天顺序"
            style={{
              cursor: "grab",
              color: "#bfbfbf",
              touchAction: "none",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              paddingTop: 2,
              transition: "color 0.2s",
            }}
          >
            <HolderOutlined style={{ transform: "rotate(90deg)" }} />
          </span>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Typography.Text strong style={{ fontSize: 15 }}>第 {dayIndex + 1} 天</Typography.Text>
            {pace && (
              <Tag color={pace.color} style={{ margin: 0, fontSize: 10, lineHeight: "16px", padding: "0 6px" }}>
                {pace.label}
              </Tag>
            )}
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 2 }}>
            {date.format("M月D日 ddd")}
            {cost > 0 ? ` · 预估 ¥${cost.toLocaleString()}` : ""}
          </Typography.Text>
          {weather && (
            <div style={{ fontSize: 12, color: "#8c8c8c", marginTop: 2 }}>{weather}</div>
          )}
        </div>
        {!readOnly && (
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [
                { key: "left", label: "左移一天", disabled: dayIndex === 0 },
                { key: "right", label: "右移一天", disabled: dayIndex === dayCount - 1 },
                { type: "divider" as const },
                { key: "before", label: "在这天前插入一天" },
                { key: "after", label: "在这天后插入一天" },
                { type: "divider" as const },
                { key: "remove", label: "删除这一天", danger: true, disabled: dayCount <= 1 },
              ],
              onClick: ({ key }) => {
                if (key === "left") onMoveDay(dayIndex, dayIndex - 1);
                else if (key === "right") onMoveDay(dayIndex, dayIndex + 1);
                else if (key === "remove") onRemoveDay(dayIndex);
                else onInsertDay(key === "before" ? dayIndex : dayIndex + 1);
              },
            }}
          >
            <Button type="text" size="small" icon={<MoreOutlined />} />
          </Dropdown>
        )}
      </div>
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div
          style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 48 }}
        >
          {items.map((item, idx) => (
            <div key={item.id}>
              {!readOnly && (
                <div
                  className="item-insert-divider"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddItem(dayIndex, items[idx - 1]?.sortOrder ?? -1);
                  }}
                  style={{
                    height: 2,
                    position: "relative",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "height 0.15s, margin 0.15s",
                    margin: "2px 0",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.height = "28px";
                    e.currentTarget.style.margin = "4px 0";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.height = "2px";
                    e.currentTarget.style.margin = "2px 0";
                  }}
                >
                  <span
                    style={{
                      opacity: 0,
                      transition: "opacity 0.15s",
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      background: "var(--brand-grad, linear-gradient(135deg, #0d9488, #0891b2))",
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 12,
                      position: "absolute",
                      zIndex: 1,
                      boxShadow: "0 2px 6px rgba(13,148,136,0.35)",
                    }}
                    className="item-insert-icon"
                  >
                    <PlusOutlined style={{ fontSize: 10 }} />
                  </span>
                </div>
              )}
              <SortableItemCard item={item} readOnly={readOnly} onEdit={onEditItem} onDelete={onDeleteItem} />
            </div>
          ))}
          {items.length === 0 && (
            <div
              style={{
                border: "1px dashed #dce4e4",
                borderRadius: 10,
                padding: "20px 0",
                textAlign: "center",
                color: "#bfbfbf",
                fontSize: 12,
                background: "rgba(255,255,255,0.5)",
              }}
            >
              暂无安排，可拖入或点下方添加
            </div>
          )}
          {!readOnly && (
            <Button
              type="dashed"
              block
              icon={<PlusOutlined />}
              style={{ marginTop: items.length > 0 ? 6 : 0, borderColor: "#dce4e4", color: "#8c8c8c", borderRadius: 8 }}
              onClick={() => onAddItem(dayIndex)}
            >
              添加行程项
            </Button>
          )}
        </div>
      </SortableContext>
    </div>
  );
}

export default function ItineraryBoard({
  startDate,
  dayCount,
  items,
  weather,
  readOnly,
  onAddItem,
  onEditItem,
  onDeleteItem,
  onReorder,
  onInsertDay,
  onRemoveDay,
}: BoardProps) {
  const [columns, setColumns] = useState<ItineraryItemT[][]>(() => buildColumns(items, dayCount));
  const [activeItem, setActiveItem] = useState<ItineraryItemT | null>(null);
  const [activeDay, setActiveDay] = useState(0);
  const snapshotRef = useRef("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollingRef = useRef(false); // 程序化滚动期间抑制 Observer 干扰
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    setColumns(buildColumns(items, dayCount));
  }, [items, dayCount]);

  // 使用 IntersectionObserver 追踪当前可见的日列
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    // 延迟一帧确保 DOM 渲染完成
    const raf = requestAnimationFrame(() => {
      const cols = container.querySelectorAll<HTMLDivElement>(".board-day-col");
      if (cols.length === 0) return;
      const observer = new IntersectionObserver(
        (entries) => {
          if (scrollingRef.current) return; // 程序化滚动期间不更新
          const firstVisible = entries.find((e) => e.isIntersecting);
          if (firstVisible) {
            const idx = Array.from(cols).indexOf(firstVisible.target as HTMLDivElement);
            if (idx >= 0) setActiveDay(idx);
          }
        },
        { root: container, threshold: 0.3 },
      );
      cols.forEach((col) => observer.observe(col));
      return () => observer.disconnect();
    });
    return () => cancelAnimationFrame(raf);
  }, [columns.length]);

  const scrollToDay = useCallback((dayIndex: number) => {
    const container = scrollRef.current;
    if (!container) return;
    const cols = container.querySelectorAll<HTMLDivElement>(".board-day-col");
    const el = cols[dayIndex];
    if (el) {
      scrollingRef.current = true;
      setActiveDay(dayIndex);
      container.scrollTo({ left: el.offsetLeft - 12, behavior: "smooth" });
      setTimeout(() => { scrollingRef.current = false; }, 600);
    }
  }, []);

  const scrollBy = useCallback((direction: "prev" | "next") => {
    const container = scrollRef.current;
    if (!container) return;
    const colWidth = 280 + 12; // column width + gap
    const offset = direction === "prev" ? -colWidth * 2 : colWidth * 2;
    container.scrollBy({ left: offset, behavior: "smooth" });
  }, []);

  const findDay = (id: string): number | null => {
    if (id.startsWith("day-")) {
      const n = Number(id.slice(4));
      return Number.isInteger(n) && n >= 0 && n < columns.length ? n : null;
    }
    for (let d = 0; d < columns.length; d++) {
      if (columns[d].some((i) => i.id === id)) return d;
    }
    return null;
  };

  const handleDragStart = ({ active }: DragStartEvent) => {
    snapshotRef.current = signature(columns);
    const activeId = String(active.id);
    if (activeId.startsWith("day-")) {
      // 拖动整列天，不显示卡片 overlay（列自身随指针移动）
      setActiveItem(null);
      return;
    }
    const day = findDay(activeId);
    setActiveItem(day === null ? null : (columns[day].find((i) => i.id === activeId) ?? null));
  };

  // 跨天拖拽：拖动过程中把行程项挪到目标天，实现实时预览
  const handleDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const activeId = String(active.id);
    if (activeId.startsWith("day-")) return; // 天重排由 SortableContext 变换处理
    const overId = String(over.id);
    const fromDay = findDay(activeId);
    const toDay = findDay(overId);
    if (fromDay === null || toDay === null || fromDay === toDay) return;
    setColumns((prev) => {
      const next = prev.map((col) => [...col]);
      const fromIdx = next[fromDay].findIndex((i) => i.id === activeId);
      if (fromIdx === -1) return prev;
      const [moved] = next[fromDay].splice(fromIdx, 1);
      const overIdx = next[toDay].findIndex((i) => i.id === overId);
      const insertIdx = overIdx >= 0 ? overIdx : next[toDay].length;
      next[toDay].splice(insertIdx, 0, { ...moved, dayIndex: toDay });
      return next;
    });
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveItem(null);
    const activeId = String(active.id);
    // 拖动整列天：提交新的天顺序（复用 onReorder 持久化 dayIndex 重排）
    if (activeId.startsWith("day-")) {
      if (!over) return;
      const from = Number(activeId.slice(4));
      const to = Number(String(over.id).slice(4));
      if (
        !Number.isInteger(from) ||
        !Number.isInteger(to) ||
        from === to ||
        from < 0 ||
        to < 0 ||
        from >= columns.length ||
        to >= columns.length
      ) {
        return;
      }
      const moved = arrayMove(columns, from, to);
      setColumns(moved);
      onReorder(
        moved.flatMap((col, d) => col.map((item, idx) => ({ ...item, dayIndex: d, sortOrder: idx }))),
      );
      return;
    }
    let next = columns;
    if (over) {
      const overId = String(over.id);
      const fromDay = findDay(activeId);
      const toDay = findDay(overId);
      if (fromDay !== null && toDay !== null && fromDay !== toDay) {
        // 跨天拖拽：作为 handleDragOver 的兜底，确保空天也能接收
        next = columns.map((col) => [...col]);
        const fromIdx = next[fromDay].findIndex((i) => i.id === activeId);
        if (fromIdx >= 0) {
          const [moved] = next[fromDay].splice(fromIdx, 1);
          const overIdx = next[toDay].findIndex((i) => i.id === overId);
          const insertIdx = overIdx >= 0 ? overIdx : next[toDay].length;
          next[toDay].splice(insertIdx, 0, { ...moved, dayIndex: toDay });
        }
        setColumns(next);
      } else if (fromDay !== null && toDay === fromDay) {
        const col = columns[fromDay];
        const oldIdx = col.findIndex((i) => i.id === activeId);
        const newIdx = col.findIndex((i) => i.id === overId);
        if (oldIdx >= 0 && newIdx >= 0 && oldIdx !== newIdx) {
          next = columns.map((col2, d) => (d === fromDay ? arrayMove(col2, oldIdx, newIdx) : col2));
          setColumns(next);
        }
      }
    }
    if (signature(next) !== snapshotRef.current) {
      onReorder(
        next.flatMap((col, d) => col.map((item, idx) => ({ ...item, dayIndex: d, sortOrder: idx }))),
      );
    }
  };

  const handleDragCancel = () => {
    setActiveItem(null);
    setColumns(buildColumns(items, dayCount));
  };

  const collisionDetection = useRef(makeCollisionDetection()).current;

  // 菜单「左移/右移一天」：与拖动整列天等价，复用 onReorder 持久化
  const moveDay = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= columns.length || to >= columns.length) return;
    const moved = arrayMove(columns, from, to);
    setColumns(moved);
    onReorder(
      moved.flatMap((col, d) => col.map((item, idx) => ({ ...item, dayIndex: d, sortOrder: idx }))),
    );
  };

  return (
    <DndContext
      sensors={readOnly ? [] : sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {/* 日导航栏 */}
      <div className="board-day-nav" style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 10, padding: "6px 0", overflow: "hidden" }}>
        <Button
          type="text"
          size="small"
          icon={<LeftOutlined />}
          onClick={() => scrollBy("prev")}
          style={{ flexShrink: 0 }}
        />
        <div className="board-day-nav-inner" style={{ display: "flex", gap: 4, overflowX: "auto", flex: 1, padding: "0 2px" }}>
          {columns.map((_col, dayIndex) => (
            <Button
              key={dayIndex}
              type={activeDay === dayIndex ? "primary" : "default"}
              size="small"
              onClick={() => scrollToDay(dayIndex)}
              style={{
                flexShrink: 0,
                borderRadius: 16,
                fontSize: 12,
                padding: "0 12px",
                fontWeight: activeDay === dayIndex ? 600 : 400,
              }}
            >
              第 {dayIndex + 1} 天
            </Button>
          ))}
        </div>
        <Button
          type="text"
          size="small"
          icon={<RightOutlined />}
          onClick={() => scrollBy("next")}
          style={{ flexShrink: 0 }}
        />
      </div>

      <div
        ref={scrollRef}
        style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 8, alignItems: "stretch", scrollBehavior: "smooth" }}
      >
        <SortableContext items={columns.map((_, d) => `day-${d}`)} strategy={horizontalListSortingStrategy}>
          {columns.map((colItems, dayIndex) => (
            <DayColumn
              key={dayIndex}
              dayIndex={dayIndex}
              dayCount={dayCount}
              date={startDate.add(dayIndex, "day")}
              items={colItems}
              weather={weather?.[dayIndex]}
              readOnly={readOnly}
              onAddItem={onAddItem}
              onEditItem={onEditItem}
              onDeleteItem={onDeleteItem}
              onInsertDay={onInsertDay}
              onRemoveDay={onRemoveDay}
              onMoveDay={moveDay}
            />
          ))}
        </SortableContext>
        {!readOnly && (
          <div
            className="board-add-day"
            onClick={() => onInsertDay(dayCount)}
          >
            <PlusOutlined />
            <span style={{ writingMode: "vertical-lr", letterSpacing: 4, fontSize: 12 }}>添加一天</span>
          </div>
        )}
      </div>
      <DragOverlay>
        {activeItem ? (
          <div style={{ width: 256 }}>
            <ItemCardBody item={activeItem} dragging />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
