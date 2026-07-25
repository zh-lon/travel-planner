"use client";

import { useCallback, useEffect, useState } from "react";
import { App, Button, Card, Checkbox, Empty, Input, Popconfirm, Progress, Space, Typography } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import type { ChecklistItemT } from "@/types";

const PRESET_ITEMS = [
  "身份证/证件",
  "手机充电器",
  "充电宝",
  "换洗衣物",
  "洗漱用品",
  "防晒霜",
  "雨伞",
  "常用药品",
  "纸巾/湿巾",
  "水杯",
];

export default function ChecklistPanel({
  tripId,
  readOnly,
}: {
  tripId: string;
  readOnly?: boolean;
}) {
  const { message } = App.useApp();
  const [items, setItems] = useState<ChecklistItemT[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/trips/${tripId}/checklist`);
      if (!res.ok) throw new Error();
      setItems(await res.json());
    } catch {
      message.error("加载清单失败");
    } finally {
      setLoading(false);
    }
  }, [tripId, message]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async (payload: { text?: string; texts?: string[] }) => {
    setAdding(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/checklist`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      setText("");
      load();
    } catch {
      message.error("添加失败");
    } finally {
      setAdding(false);
    }
  };

  const toggle = async (item: ChecklistItemT, checked: boolean) => {
    setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, checked } : x)));
    const res = await fetch(`/api/checklist/${item.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ checked }),
    }).catch(() => null);
    if (!res || !res.ok) {
      message.error("保存失败");
      load();
    }
  };

  const remove = async (id: string) => {
    const res = await fetch(`/api/checklist/${id}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok) load();
    else message.error("删除失败");
  };

  const done = items.filter((i) => i.checked).length;

  return (
    <Card size="small" title="行前清单" loading={loading}>
      <Space direction="vertical" size="middle" style={{ display: "flex", maxWidth: 560 }}>
        {items.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Progress
              percent={items.length > 0 ? Math.round((done / items.length) * 100) : 0}
              style={{ flex: 1, marginBottom: 0 }}
            />
            <Typography.Text type="secondary" style={{ whiteSpace: "nowrap" }}>
              {done} / {items.length}
            </Typography.Text>
          </div>
        )}

        {!readOnly && (
          <Space.Compact style={{ width: "100%" }}>
            <Input
              placeholder="添加物品或待办，回车确认"
              value={text}
              maxLength={60}
              onChange={(e) => setText(e.target.value)}
              onPressEnter={() => text.trim() && add({ text })}
            />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              loading={adding}
              onClick={() => text.trim() && add({ text })}
            >
              添加
            </Button>
          </Space.Compact>
        )}

        {items.length === 0 ? (
          <Empty description="清单为空" image={Empty.PRESENTED_IMAGE_SIMPLE}>
            {!readOnly && (
              <Button onClick={() => add({ texts: PRESET_ITEMS })} loading={adding}>
                一键添加常用物品
              </Button>
            )}
          </Empty>
        ) : (
          <div>
            {items.map((item) => (
              <div
                key={item.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 4px",
                  borderBottom: "1px solid #f5f5f5",
                }}
              >
                <Checkbox
                  checked={item.checked}
                  disabled={readOnly}
                  onChange={(e) => toggle(item, e.target.checked)}
                >
                  <span
                    style={
                      item.checked ? { textDecoration: "line-through", color: "#bbb" } : undefined
                    }
                  >
                    {item.text}
                  </span>
                </Checkbox>
                <span style={{ flex: 1 }} />
                {!readOnly && (
                  <Popconfirm title="删除该条目？" okText="删除" cancelText="取消" onConfirm={() => remove(item.id)}>
                    <Button type="text" size="small" icon={<DeleteOutlined />} />
                  </Popconfirm>
                )}
              </div>
            ))}
            {!readOnly && (
              <Button
                type="link"
                size="small"
                style={{ paddingInline: 0, marginTop: 8 }}
                onClick={() => add({ texts: PRESET_ITEMS })}
              >
                补充常用物品
              </Button>
            )}
          </div>
        )}
      </Space>
    </Card>
  );
}
