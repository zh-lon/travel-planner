"use client";

import { Alert, Collapse, Tag, Typography } from "antd";
import { EnvironmentOutlined } from "@ant-design/icons";
import type { Dayjs } from "dayjs";
import { itemTypeMeta } from "@/types/constants";
import type { AiPlan } from "@/types";

interface Props {
  plan: AiPlan;
  startDate?: Dayjs;
}

export default function AiPlanPreview({ plan, startDate }: Props) {
  const totalItems = plan.days.reduce((s, d) => s + d.items.length, 0);
  const unlocated = plan.days.reduce(
    (s, d) => s + d.items.filter((i) => i.placeName && (i.lng == null || i.lat == null)).length,
    0,
  );
  const totalCost = plan.days.reduce(
    (s, d) => s + d.items.reduce((x, i) => x + (i.estimatedCost ?? 0), 0),
    0,
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Alert
        type={unlocated > 0 ? "warning" : "success"}
        showIcon
        message={
          `共 ${plan.days.length} 天 · ${totalItems} 个行程项 · 人均预估 ¥${Math.round(totalCost).toLocaleString()}` +
          (unlocated > 0 ? ` · ${unlocated} 个地点未能自动定位（导入后可在编辑中手动搜索）` : " · 地点已全部定位")
        }
      />
      <Collapse
        defaultActiveKey={plan.days.map((_, i) => String(i))}
        items={plan.days.map((day, dayIndex) => ({
          key: String(dayIndex),
          label: (
            <span>
              第 {dayIndex + 1} 天
              {startDate ? ` · ${startDate.add(dayIndex, "day").format("M月D日 ddd")}` : ""}
              {day.theme ? ` · ${day.theme}` : ""}
              <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                {day.items.length} 项
              </Typography.Text>
            </span>
          ),
          children: (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {day.items.length === 0 && (
                <Typography.Text type="secondary">（空）</Typography.Text>
              )}
              {day.items.map((item, idx) => {
                const meta = itemTypeMeta(item.type);
                return (
                  <div key={idx} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <Tag color={meta.color} style={{ marginRight: 0, flexShrink: 0 }}>
                      {meta.label}
                    </Tag>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Typography.Text strong>{item.title}</Typography.Text>
                      <span style={{ marginLeft: 8, fontSize: 12, color: "#888" }}>
                        {item.startTime && `${item.startTime}${item.endTime ? ` - ${item.endTime}` : ""}`}
                        {item.estimatedCost != null && item.estimatedCost > 0 && (
                          <span style={{ marginLeft: 8 }}>¥{item.estimatedCost}</span>
                        )}
                        {item.placeName && (
                          <span style={{ marginLeft: 8 }}>
                            <EnvironmentOutlined style={{ color: item.lng != null ? "#52c41a" : "#faad14" }} />{" "}
                            {item.placeName}
                            {item.lng == null && (
                              <Typography.Text type="warning" style={{ fontSize: 12 }}>
                                （未定位）
                              </Typography.Text>
                            )}
                          </span>
                        )}
                      </span>
                      {item.notes && (
                        <div style={{ fontSize: 12, color: "#999" }}>{item.notes}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ),
        }))}
      />
    </div>
  );
}
