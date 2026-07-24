"use client";

import { useEffect, useRef, useState, type HTMLAttributes } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { EnvironmentOutlined, HolderOutlined, MoreOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Dropdown, Tag, Typography } from "antd";
import type { Dayjs } from "dayjs";
import { itemTypeMeta } from "@/types/constants";
import type { ItineraryItemT } from "@/types";

interface BoardProps {
  startDate: Dayjs;
  dayCount: number;
  items: ItineraryItemT[];
  weather?: Record<number, string>; // dayIndex → 天气描述
  onAddItem: (dayIndex: number) => void;
  onEditItem: (item: ItineraryItemT) => void;
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

function signature(cols: ItineraryItemT[][]): string {
  return cols.map((col) => col.map((i) => i.id).join(",")).join("|");
}

function ItemCardBody({
  item,
  onClick,
  handleProps,
  dragging,
}: {
  item: ItineraryItemT;
  onClick?: () => void;
  handleProps?: HTMLAttributes<HTMLSpanElement>;
  dragging?: boolean;
}) {
  const meta = itemTypeMeta(item.type);
  return (
    <div
      onClick={onClick}
      style={{
        background: "#fff",
        border: "1px solid #e8e8e8",
        borderRadius: 6,
        padding: "8px 10px",
        cursor: "pointer",
        display: "flex",
        gap: 8,
        boxShadow: dragging ? "0 4px 12px rgba(0,0,0,.15)" : undefined,
      }}
    >
      <span
        {...handleProps}
        onClick={(e) => e.stopPropagation()}
        style={{ cursor: "grab", color: "#999", touchAction: "none" }}
      >
        <HolderOutlined />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <Tag color={meta.color} style={{ marginRight: 0, flexShrink: 0 }}>
            {meta.label}
          </Tag>
          <Typography.Text strong ellipsis style={{ flex: 1 }}>
            {item.title}
          </Typography.Text>
        </div>
        {(item.startTime || item.placeName || item.estimatedCost != null) && (
          <div
            style={{
              marginTop: 4,
              fontSize: 12,
              color: "#888",
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            {item.startTime && (
              <span>
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
          </div>
        )}
      </div>
    </div>
  );
}

function SortableItemCard({
  item,
  onEdit,
}: {
  item: ItineraryItemT;
  onEdit: (item: ItineraryItemT) => void;
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
        handleProps={{ ...attributes, ...listeners } as HTMLAttributes<HTMLSpanElement>}
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
  onAddItem,
  onEditItem,
  onInsertDay,
  onRemoveDay,
}: {
  dayIndex: number;
  dayCount: number;
  date: Dayjs;
  items: ItineraryItemT[];
  weather?: string;
  onAddItem: (dayIndex: number) => void;
  onEditItem: (item: ItineraryItemT) => void;
  onInsertDay: (dayIndex: number) => void;
  onRemoveDay: (dayIndex: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day-${dayIndex}` });
  const cost = items.reduce((sum, i) => sum + (i.estimatedCost ?? 0), 0);
  return (
    <div
      style={{
        width: 280,
        flexShrink: 0,
        background: isOver ? "#f0f7ff" : "#fafafa",
        borderRadius: 8,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        transition: "background .2s",
      }}
    >
      <div style={{ marginBottom: 10, display: "flex", alignItems: "flex-start", gap: 4 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Typography.Text strong>第 {dayIndex + 1} 天</Typography.Text>
          <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
            {date.format("M月D日 ddd")}
            {cost > 0 ? ` · 预估 ¥${cost.toLocaleString()}` : ""}
          </Typography.Text>
          {weather && (
            <div style={{ fontSize: 12, color: "#8c8c8c", marginTop: 2 }}>{weather}</div>
          )}
        </div>
        <Dropdown
          trigger={["click"]}
          menu={{
            items: [
              { key: "before", label: "在这天前插入一天" },
              { key: "after", label: "在这天后插入一天" },
              { type: "divider" as const },
              { key: "remove", label: "删除这一天", danger: true, disabled: dayCount <= 1 },
            ],
            onClick: ({ key }) => {
              if (key === "remove") onRemoveDay(dayIndex);
              else onInsertDay(key === "before" ? dayIndex : dayIndex + 1);
            },
          }}
        >
          <Button type="text" size="small" icon={<MoreOutlined />} />
        </Dropdown>
      </div>
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minHeight: 48 }}
        >
          {items.map((item) => (
            <SortableItemCard key={item.id} item={item} onEdit={onEditItem} />
          ))}
          {items.length === 0 && (
            <div
              style={{
                border: "1px dashed #d9d9d9",
                borderRadius: 6,
                padding: "14px 0",
                textAlign: "center",
                color: "#bbb",
                fontSize: 12,
              }}
            >
              暂无安排，可拖入或点下方添加
            </div>
          )}
        </div>
      </SortableContext>
      <Button
        type="dashed"
        block
        icon={<PlusOutlined />}
        style={{ marginTop: 10 }}
        onClick={() => onAddItem(dayIndex)}
      >
        添加行程项
      </Button>
    </div>
  );
}

export default function ItineraryBoard({
  startDate,
  dayCount,
  items,
  weather,
  onAddItem,
  onEditItem,
  onReorder,
  onInsertDay,
  onRemoveDay,
}: BoardProps) {
  const [columns, setColumns] = useState<ItineraryItemT[][]>(() => buildColumns(items, dayCount));
  const [activeItem, setActiveItem] = useState<ItineraryItemT | null>(null);
  const snapshotRef = useRef("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    setColumns(buildColumns(items, dayCount));
  }, [items, dayCount]);

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
    const day = findDay(String(active.id));
    setActiveItem(day === null ? null : (columns[day].find((i) => i.id === String(active.id)) ?? null));
  };

  // 跨天拖拽：拖动过程中把行程项挪到目标天，实现实时预览
  const handleDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const activeId = String(active.id);
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
    let next = columns;
    if (over) {
      const activeId = String(active.id);
      const overId = String(over.id);
      const fromDay = findDay(activeId);
      const toDay = findDay(overId);
      if (fromDay !== null && toDay === fromDay) {
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

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 8, alignItems: "stretch" }}>
        {columns.map((colItems, dayIndex) => (
          <DayColumn
            key={dayIndex}
            dayIndex={dayIndex}
            dayCount={dayCount}
            date={startDate.add(dayIndex, "day")}
            items={colItems}
            weather={weather?.[dayIndex]}
            onAddItem={onAddItem}
            onEditItem={onEditItem}
            onInsertDay={onInsertDay}
            onRemoveDay={onRemoveDay}
          />
        ))}
        <div
          onClick={() => onInsertDay(dayCount)}
          style={{
            width: 52,
            flexShrink: 0,
            border: "1px dashed #d9d9d9",
            borderRadius: 8,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            cursor: "pointer",
            color: "#999",
            minHeight: 160,
          }}
        >
          <PlusOutlined />
          <span style={{ writingMode: "vertical-lr", letterSpacing: 4, fontSize: 12 }}>添加一天</span>
        </div>
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
