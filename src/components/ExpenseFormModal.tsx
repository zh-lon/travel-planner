"use client";

import { useEffect, useState } from "react";
import { App, Button, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Select } from "antd";
import dayjs from "dayjs";
import { EXPENSE_CATEGORIES } from "@/types/constants";
import type { ExpenseT, TripDetail } from "@/types";

interface Props {
  open: boolean;
  trip: TripDetail;
  expense: ExpenseT | null; // null = 新增
  members: string[]; // 已出现过的成员名，用于下拉建议
  onCancel: () => void;
  onSaved: () => void;
}

export default function ExpenseFormModal({ open, trip, expense, members, onCancel, onSaved }: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (expense) {
      form.setFieldsValue({
        date: dayjs(expense.date),
        category: expense.category,
        title: expense.title,
        amount: expense.amount,
        payer: expense.payer ? [expense.payer] : [],
        participants: expense.participants,
        itemId: expense.itemId ?? undefined,
        notes: expense.notes ?? "",
      });
    } else {
      form.resetFields();
      // 默认日期：今天在行程内则用今天，否则用行程首日
      const today = dayjs();
      const start = dayjs(trip.startDate);
      const end = dayjs(trip.endDate);
      const defaultDate = today.isBefore(start) || today.isAfter(end.add(1, "day")) ? start : today;
      form.setFieldValue("date", defaultDate);
    }
  }, [open, expense, form, trip.startDate, trip.endDate]);

  const handleSave = async () => {
    const values = await form.validateFields().catch(() => null);
    if (!values) return;
    const payerArr = (values.payer ?? []) as string[];
    setSaving(true);
    try {
      const res = await fetch(expense ? `/api/expenses/${expense.id}` : `/api/trips/${trip.id}/expenses`, {
        method: expense ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          date: (values.date as dayjs.Dayjs).format("YYYY-MM-DD"),
          category: values.category,
          title: values.title,
          amount: values.amount,
          payer: payerArr[0] ?? "",
          participants: values.participants ?? [],
          itemId: values.itemId ?? "",
          notes: values.notes ?? "",
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error);
      }
      message.success(expense ? "开销已更新" : "开销已记录");
      onSaved();
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!expense) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/expenses/${expense.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      message.success("开销已删除");
      onSaved();
    } catch {
      message.error("删除失败");
    } finally {
      setDeleting(false);
    }
  };

  const memberOptions = members.map((name) => ({ value: name, label: name }));
  const itemOptions = [...trip.items]
    .sort((a, b) => a.dayIndex - b.dayIndex || a.sortOrder - b.sortOrder)
    .map((item) => ({ value: item.id, label: `第${item.dayIndex + 1}天 · ${item.title}` }));

  return (
    <Modal
      title={expense ? "编辑开销" : "记一笔开销"}
      open={open}
      onCancel={onCancel}
      forceRender
      footer={[
        expense ? (
          <Popconfirm
            key="delete"
            title="删除这条开销记录？"
            okText="删除"
            okButtonProps={{ danger: true }}
            cancelText="取消"
            onConfirm={handleDelete}
          >
            <Button danger loading={deleting} style={{ float: "left" }}>
              删除
            </Button>
          </Popconfirm>
        ) : null,
        <Button key="cancel" onClick={onCancel}>
          取消
        </Button>,
        <Button key="ok" type="primary" loading={saving} onClick={handleSave}>
          保存
        </Button>,
      ]}
    >
      <Form form={form} layout="vertical" initialValues={{ category: "FOOD" }}>
        <div style={{ display: "flex", gap: 12 }}>
          <Form.Item label="日期" name="date" rules={[{ required: true, message: "请选择日期" }]} style={{ flex: 1 }}>
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="分类" name="category" rules={[{ required: true }]} style={{ flex: 1 }}>
            <Select options={EXPENSE_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))} />
          </Form.Item>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <Form.Item label="标题" name="title" rules={[{ required: true, message: "请输入标题" }]} style={{ flex: 2 }}>
            <Input placeholder="如：午饭、门票、打车" maxLength={60} />
          </Form.Item>
          <Form.Item label="金额" name="amount" rules={[{ required: true, message: "请输入金额" }]} style={{ flex: 1 }}>
            <InputNumber min={0.01} prefix="¥" style={{ width: "100%" }} />
          </Form.Item>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <Form.Item
            label="垫付人"
            name="payer"
            style={{ flex: 1 }}
            extra={<span style={{ fontSize: 12 }}>多人分摊时填写；可输入新名字回车</span>}
          >
            <Select mode="tags" maxCount={1} options={memberOptions} placeholder="选填" allowClear />
          </Form.Item>
          <Form.Item
            label="分摊人"
            name="participants"
            style={{ flex: 1 }}
            extra={<span style={{ fontSize: 12 }}>参与均摊的所有人（含垫付人自己）</span>}
          >
            <Select mode="tags" options={memberOptions} placeholder="选填" allowClear />
          </Form.Item>
        </div>
        <Form.Item label="关联行程项" name="itemId">
          <Select options={itemOptions} placeholder="选填" allowClear showSearch optionFilterProp="label" />
        </Form.Item>
        <Form.Item label="备注" name="notes" style={{ marginBottom: 0 }}>
          <Input.TextArea rows={2} placeholder="选填" maxLength={300} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
