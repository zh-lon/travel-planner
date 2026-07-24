"use client";

import { useState } from "react";
import { Alert, Checkbox, Switch, Tag, Typography } from "antd";
import type { Dayjs } from "dayjs";
import { itemTypeMeta } from "@/types/constants";
import type { DiffChange, DiffEntry } from "@/lib/ai/diff";
import type { AiPlanItem, ItineraryItemT } from "@/types";

interface Props {
  entries: DiffEntry[];
  startDate?: Dayjs;
  selected: Set<string>;
  onSelectionChange: (next: Set<string>) => void;
  oldDayCount?: number; // 现有行程天数
  planDays?: number; // 方案天数（与现有不同时展示天数变化）
}

const KIND_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  added: { label: "新增", color: "success", bg: "#f6ffed", border: "#b7eb8f" },
  modified: { label: "修改", color: "warning", bg: "#fffbe6", border: "#ffe58f" },
  removed: { label: "删除", color: "error", bg: "#fff2f0", border: "#ffccc7" },
  unchanged: { label: "不变", color: "default", bg: "#fafafa", border: "#f0f0f0" },
};

function itemLine(item: AiPlanItem | ItineraryItemT): string {
  const parts: string[] = [];
  if (item.startTime) parts.push(`${item.startTime}${item.endTime ? `-${item.endTime}` : ""}`);
  if (item.placeName) parts.push(`📍${item.placeName}`);
  if (item.estimatedCost != null && item.estimatedCost > 0) parts.push(`¥${item.estimatedCost}`);
  return parts.join(" · ");
}

function ChangeLine({ change }: { change: DiffChange }) {
  return (
    <div style={{ fontSize: 12, lineHeight: "20px" }}>
      <Typography.Text type="secondary">{change.label}：</Typography.Text>
      <Typography.Text delete type="danger" style={{ fontSize: 12 }}>
        {change.from}
      </Typography.Text>
      <span style={{ margin: "0 6px", color: "#999" }}>→</span>
      <Typography.Text type="success" style={{ fontSize: 12 }}>
        {change.to}
      </Typography.Text>
    </div>
  );
}

export default function AiDiffPreview({
  entries,
  startDate,
  selected,
  onSelectionChange,
  oldDayCount,
  planDays,
}: Props) {
  const [showUnchanged, setShowUnchanged] = useState(false);

  const changed = entries.filter((e) => e.kind !== "unchanged");
  const counts = {
    added: entries.filter((e) => e.kind === "added").length,
    modified: entries.filter((e) => e.kind === "modified").length,
    removed: entries.filter((e) => e.kind === "removed").length,
    unchanged: entries.filter((e) => e.kind === "unchanged").length,
  };
  const dayChanged = oldDayCount != null && planDays != null && oldDayCount !== planDays;
  const allSelected = changed.length > 0 && changed.every((e) => selected.has(e.key));
  const someSelected = changed.some((e) => selected.has(e.key));

  const toggle = (key: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(key);
    else next.delete(key);
    onSelectionChange(next);
  };

  const dayIndices = [...new Set(entries.map((e) => e.dayIndex))].sort((a, b) => a - b);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Alert
        type={changed.length > 0 ? "info" : "success"}
        showIcon
        message={
          changed.length > 0
            ? `对比结果：新增 ${counts.added} · 修改 ${counts.modified} · 删除 ${counts.removed} · 不变 ${counts.unchanged}，已勾选 ${changed.filter((e) => selected.has(e.key)).length} 项变更` +
              (dayChanged ? `；天数 ${oldDayCount} 天 → ${planDays} 天` : "")
            : "AI 方案与现有行程没有差异"
        }
      />
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <Checkbox
          checked={allSelected}
          indeterminate={someSelected && !allSelected}
          onChange={(e) =>
            onSelectionChange(new Set(e.target.checked ? changed.map((x) => x.key) : []))
          }
        >
          全选变更
        </Checkbox>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Switch size="small" checked={showUnchanged} onChange={setShowUnchanged} />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            显示未变化项（{counts.unchanged}）
          </Typography.Text>
        </span>
      </div>

      {dayIndices.map((d) => {
        const dayEntries = entries
          .filter((e) => e.dayIndex === d)
          .filter((e) => showUnchanged || e.kind !== "unchanged")
          .sort((a, b) => a.orderInDay - b.orderInDay);
        if (dayEntries.length === 0) return null;
        return (
          <div key={d}>
            <Typography.Text strong>
              第 {d + 1} 天
              {startDate ? (
                <Typography.Text type="secondary" style={{ fontWeight: 400, marginLeft: 8, fontSize: 12 }}>
                  {startDate.add(d, "day").format("M月D日 ddd")}
                </Typography.Text>
              ) : null}
              {oldDayCount != null && planDays != null && d >= oldDayCount && d < planDays && (
                <Tag color="success" style={{ marginLeft: 8 }}>
                  新增天
                </Tag>
              )}
              {planDays != null && d >= planDays && (
                <Tag color="error" style={{ marginLeft: 8 }}>
                  方案移除此天（未勾选删除的安排将保留）
                </Tag>
              )}
            </Typography.Text>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
              {dayEntries.map((entry) => {
                const meta = KIND_META[entry.kind];
                const display = entry.kind === "removed" ? entry.oldItem! : (entry.newItem ?? entry.oldItem!);
                const typeMeta = itemTypeMeta(display.type);
                const line = itemLine(display);
                return (
                  <div
                    key={entry.key}
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "flex-start",
                      background: meta.bg,
                      border: `1px solid ${meta.border}`,
                      borderRadius: 6,
                      padding: "6px 10px",
                    }}
                  >
                    {entry.kind !== "unchanged" ? (
                      <Checkbox
                        checked={selected.has(entry.key)}
                        onChange={(e) => toggle(entry.key, e.target.checked)}
                        style={{ marginTop: 2 }}
                      />
                    ) : (
                      <span style={{ width: 16 }} />
                    )}
                    <Tag color={meta.color} style={{ marginRight: 0, flexShrink: 0, marginTop: 2 }}>
                      {meta.label}
                    </Tag>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div>
                        <Tag style={{ marginRight: 6 }} color={typeMeta.color}>
                          {typeMeta.label}
                        </Tag>
                        <Typography.Text
                          strong
                          delete={entry.kind === "removed"}
                          type={entry.kind === "removed" ? "secondary" : undefined}
                        >
                          {display.title}
                        </Typography.Text>
                        {line && (
                          <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                            {line}
                          </Typography.Text>
                        )}
                      </div>
                      {entry.kind === "modified" &&
                        entry.changes.map((change, idx) => <ChangeLine key={idx} change={change} />)}
                      {entry.kind === "added" && entry.newItem?.notes && (
                        <div style={{ fontSize: 12, color: "#888" }}>{entry.newItem.notes}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
