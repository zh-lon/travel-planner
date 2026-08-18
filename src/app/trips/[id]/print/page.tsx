"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button, Spin, Typography } from "antd";
import { PrinterOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import { expenseCategoryMeta, itemTypeMeta } from "@/types/constants";
import type { ExpenseT, TripDetail } from "@/types";

dayjs.locale("zh-cn");

// 打印友好页面：浏览器打印可另存为 PDF
export default function TripPrintPage() {
  const { id } = useParams<{ id: string }>();
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [expenses, setExpenses] = useState<ExpenseT[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [tripRes, expRes] = await Promise.all([
        fetch(`/api/trips/${id}`),
        fetch(`/api/trips/${id}/expenses`),
      ]);
      if (tripRes.ok) setTrip(await tripRes.json());
      if (expRes.ok) setExpenses(await expRes.json());
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (!trip) return <Typography.Text type="secondary">行程不存在</Typography.Text>;

  const start = dayjs(trip.startDate);
  const dayCount = dayjs(trip.endDate).diff(start, "day") + 1;
  const totalSpent = expenses.reduce((s, e) => s + e.amount, 0);

  return (
    <div style={{ background: "#fff", padding: 32, borderRadius: 8 }}>
      <div className="no-print" style={{ textAlign: "right", marginBottom: 16 }}>
        <Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()}>
          打印 / 另存为 PDF
        </Button>
      </div>

      <Typography.Title level={2} style={{ marginTop: 0 }}>
        {trip.title}
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        {trip.destination} · {start.format("YYYY年M月D日")} - {dayjs(trip.endDate).format("M月D日")} · 共 {dayCount} 天
        {trip.budgetTotal != null && ` · 预算 ¥${trip.budgetTotal.toLocaleString()}`}
      </Typography.Paragraph>
      {trip.notes && <Typography.Paragraph>备注:{trip.notes}</Typography.Paragraph>}

      {Array.from({ length: dayCount }, (_, d) => {
        const items = trip.items
          .filter((i) => i.dayIndex === d)
          .sort((a, b) => a.sortOrder - b.sortOrder);
        return (
          <div key={d} style={{ marginTop: 20, breakInside: "avoid" }}>
            <Typography.Title level={4} style={{ borderBottom: "2px solid #333", paddingBottom: 4 }}>
              第 {d + 1} 天 · {start.add(d, "day").format("M月D日 dddd")}
            </Typography.Title>
            {items.length === 0 ? (
              <Typography.Text type="secondary">（无安排）</Typography.Text>
            ) : (
              items.map((item) => (
                <div key={item.id} style={{ padding: "6px 0", borderBottom: "1px dashed #ddd", display: "flex", gap: 12 }}>
                  <span style={{ width: 96, flexShrink: 0, color: "#555" }}>
                    {item.startTime ? `${item.startTime}${item.endTime ? `-${item.endTime}` : ""}` : "—"}
                  </span>
                  <span style={{ width: 44, flexShrink: 0, color: "#555" }}>{itemTypeMeta(item.type).label}</span>
                  <span style={{ flex: 1 }}>
                    <b>{item.title}</b>
                    {item.placeName && <span style={{ color: "#666" }}>（{item.placeName}）</span>}
                    {item.needBooking && <span style={{ color: "#d46b08" }}>【需预约】</span>}
                    {item.notes && <div style={{ fontSize: 12, color: "#888" }}>{item.notes}</div>}
                  </span>
                  <span style={{ width: 80, textAlign: "right", color: "#555" }}>
                    {item.estimatedCost != null ? `¥${item.estimatedCost}` : ""}
                  </span>
                </div>
              ))
            )}
          </div>
        );
      })}

      {expenses.length > 0 && (
        <div style={{ marginTop: 24, breakInside: "avoid" }}>
          <Typography.Title level={4} style={{ borderBottom: "2px solid #333", paddingBottom: 4 }}>
            开销记录（合计 ¥{totalSpent.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}）
          </Typography.Title>
          {expenses.map((e) => (
            <div key={e.id} style={{ display: "flex", gap: 12, padding: "4px 0", borderBottom: "1px dashed #eee" }}>
              <span style={{ width: 60, color: "#555" }}>{dayjs(e.date).format("M/D")}</span>
              <span style={{ width: 44, color: "#555" }}>{expenseCategoryMeta(e.category).label}</span>
              <span style={{ flex: 1 }}>{e.title}</span>
              <span style={{ width: 90, textAlign: "right" }}>¥{e.amount}</span>
            </div>
          ))}
        </div>
      )}

      <Typography.Paragraph type="secondary" style={{ marginTop: 24, fontSize: 12 }}>
        由旅行规划工具生成 · {dayjs().format("YYYY-MM-DD HH:mm")}
      </Typography.Paragraph>
    </div>
  );
}
