"use client";

import { useEffect, useState } from "react";
import { App, DatePicker, Form, Input, InputNumber, Modal, Select } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { PREFERENCE_VALUES } from "@/types/constants";
import type { TripSummary } from "@/types";

const PREFERENCE_OPTIONS = PREFERENCE_VALUES.map((x) => ({ value: x, label: x }));

// 从行程的 planParams JSON 中安全读取已有规划参数
function readPlanParams(trip: TripSummary): Record<string, unknown> {
  if (!trip.planParams) return {};
  try {
    const p = JSON.parse(trip.planParams) as Record<string, unknown>;
    return p && typeof p === "object" ? p : {};
  } catch {
    return {};
  }
}

interface Props {
  open: boolean;
  trip: TripSummary | null; // null = 新建
  onCancel: () => void;
  onSaved: () => void;
}

export default function TripFormModal({ open, trip, onCancel, onSaved }: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (trip) {
      const params = readPlanParams(trip);
      form.setFieldsValue({
        title: trip.title,
        destination: trip.destination,
        dates: [dayjs(trip.startDate), dayjs(trip.endDate)],
        budgetTotal: trip.budgetTotal ?? undefined,
        notes: trip.notes ?? "",
        preferences: Array.isArray(params.preferences)
          ? (params.preferences as unknown[]).map((x) => String(x))
          : [],
      });
    } else {
      form.resetFields();
    }
  }, [open, trip, form]);

  const handleOk = async () => {
    const values = await form.validateFields().catch(() => null);
    if (!values) return;
    const [start, end] = values.dates as [Dayjs, Dayjs];
    const preferences = (values.preferences as string[]) ?? [];
    // 编辑时保留原 planParams 其他字段，仅同步偏好；新建且无偏好则不传
    const planParams = trip
      ? { ...readPlanParams(trip), preferences }
      : preferences.length > 0
        ? { preferences }
        : undefined;
    setSaving(true);
    try {
      const res = await fetch(trip ? `/api/trips/${trip.id}` : "/api/trips", {
        method: trip ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: values.title,
          destination: values.destination,
          startDate: start.format("YYYY-MM-DD"),
          endDate: end.format("YYYY-MM-DD"),
          budgetTotal: typeof values.budgetTotal === "number" ? values.budgetTotal : null,
          notes: values.notes ?? "",
          ...(planParams ? { planParams } : {}),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error);
      }
      message.success(trip ? "行程已更新" : "行程已创建");
      onSaved();
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={trip ? "编辑行程" : "新建行程"}
      open={open}
      onCancel={onCancel}
      onOk={handleOk}
      confirmLoading={saving}
      okText="保存"
      cancelText="取消"
      forceRender
    >
      <Form form={form} layout="vertical">
        <Form.Item label="行程标题" name="title" rules={[{ required: true, message: "请输入行程标题" }]}>
          <Input placeholder="如：国庆成都 5 日游" maxLength={50} />
        </Form.Item>
        <Form.Item label="目的地" name="destination" rules={[{ required: true, message: "请输入目的地" }]}>
          <Input placeholder="如：成都" maxLength={30} />
        </Form.Item>
        <Form.Item label="日期范围" name="dates" rules={[{ required: true, message: "请选择日期范围" }]}>
          <DatePicker.RangePicker style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item label="总预算" name="budgetTotal">
          <InputNumber min={0} prefix="¥" style={{ width: 200 }} placeholder="选填" />
        </Form.Item>
        <Form.Item label="旅行偏好" name="preferences" extra="供 AI 助手对话与调整行程时参考（如选了「自驾游」，AI 会按自驾出行给建议）">
          <Select mode="multiple" options={PREFERENCE_OPTIONS} placeholder="可多选" allowClear />
        </Form.Item>
        <Form.Item label="备注" name="notes" style={{ marginBottom: 0 }}>
          <Input.TextArea rows={2} placeholder="选填" maxLength={500} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
