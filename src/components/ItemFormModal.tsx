"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  App,
  AutoComplete,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  TimePicker,
  Typography,
  type InputRef,
} from "antd";
import { EnvironmentOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { ITEM_TYPES } from "@/types/constants";
import type { ItineraryItemT } from "@/types";

interface Props {
  open: boolean;
  tripId: string;
  dayIndex: number;
  dayLabel: string;
  cityHint?: string; // 地点搜索的城市偏好（行程目的地）
  item: ItineraryItemT | null; // null = 新增
  onCancel: () => void;
  onSaved: () => void;
}

interface PoiOption {
  name: string;
  address: string | null;
  district: string;
  lng: number;
  lat: number;
}

interface Located {
  name: string;
  lng: number;
  lat: number;
  address: string | null;
}

export default function ItemFormModal({
  open,
  tripId,
  dayIndex,
  dayLabel,
  cityHint,
  item,
  onCancel,
  onSaved,
}: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [coords, setCoords] = useState<Located | null>(null);
  const [placeOptions, setPlaceOptions] = useState<{ value: string; label: ReactNode; poi: PoiOption }[]>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const placeInputRef = useRef<InputRef>(null);

  useEffect(() => {
    if (!open) return;
    setPlaceOptions([]);
    if (item) {
      form.setFieldsValue({
        type: item.type,
        title: item.title,
        time: item.startTime
          ? [dayjs(item.startTime, "HH:mm"), item.endTime ? dayjs(item.endTime, "HH:mm") : null]
          : undefined,
        placeName: item.placeName ?? "",
        estimatedCost: item.estimatedCost ?? undefined,
        notes: item.notes ?? "",
      });
      setCoords(
        item.lng != null && item.lat != null && item.placeName
          ? { name: item.placeName, lng: item.lng, lat: item.lat, address: item.address }
          : null,
      );
    } else {
      form.resetFields();
      setCoords(null);
    }
  }, [open, item, form]);

  const handlePlaceSearch = (text: string) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const keywords = text.trim();
    if (!keywords) {
      setPlaceOptions([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ keywords });
        if (cityHint) params.set("city", cityHint);
        const res = await fetch(`/api/geo/search?${params.toString()}`);
        const data = (await res.json()) as { ok: boolean; pois?: PoiOption[]; error?: string };
        if (!data.ok || !data.pois) {
          setPlaceOptions([]);
          return;
        }
        setPlaceOptions(
          data.pois.map((poi, idx) => ({
            value: `${poi.name}#${idx}`,
            poi,
            label: (
              <div>
                <div>{poi.name}</div>
                <div style={{ fontSize: 12, color: "#999" }}>
                  {poi.district}
                  {poi.address ? ` · ${poi.address}` : ""}
                </div>
              </div>
            ),
          })),
        );
      } catch {
        setPlaceOptions([]);
      }
    }, 350);
  };

  const handleSave = async () => {
    const values = await form.validateFields().catch(() => null);
    if (!values) return;
    const time = values.time as [Dayjs | null, Dayjs | null] | null | undefined;
    setSaving(true);
    try {
      const res = await fetch(item ? `/api/items/${item.id}` : `/api/trips/${tripId}/items`, {
        method: item ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dayIndex,
          type: values.type,
          title: values.title,
          startTime: time?.[0] ? time[0].format("HH:mm") : "",
          endTime: time?.[1] ? time[1].format("HH:mm") : "",
          placeName: values.placeName ?? "",
          lng: coords?.lng ?? null,
          lat: coords?.lat ?? null,
          address: coords?.address ?? "",
          estimatedCost: typeof values.estimatedCost === "number" ? values.estimatedCost : null,
          notes: values.notes ?? "",
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error);
      }
      message.success(item ? "行程项已更新" : "行程项已添加");
      onSaved();
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!item) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/items/${item.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      message.success("行程项已删除");
      onSaved();
    } catch {
      message.error("删除失败");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal
      title={`${item ? "编辑" : "添加"}行程项 · ${dayLabel}`}
      open={open}
      onCancel={onCancel}
      forceRender
      footer={[
        item ? (
          <Popconfirm
            key="delete"
            title="删除这个行程项？"
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
      <Form form={form} layout="vertical" initialValues={{ type: "SIGHT" }}>
        <Form.Item label="类型" name="type" rules={[{ required: true, message: "请选择类型" }]}>
          <Select options={ITEM_TYPES.map((t) => ({ value: t.value, label: t.label }))} style={{ maxWidth: 200 }} />
        </Form.Item>
        <Form.Item label="标题" name="title" rules={[{ required: true, message: "请输入标题" }]}>
          <Input placeholder="如：宽窄巷子、高铁 G8511、入住民宿" maxLength={60} />
        </Form.Item>
        <Form.Item label="时间段" name="time">
          <TimePicker.RangePicker format="HH:mm" minuteStep={5} style={{ width: "100%" }} allowEmpty={[true, true]} />
        </Form.Item>
        <Form.Item
          label="地点"
          name="placeName"
          extra={
            coords ? (
              <Typography.Text type="success" style={{ fontSize: 12 }}>
                <EnvironmentOutlined /> 已定位
                {coords.address ? `：${coords.address}` : ""}{" "}
                <a
                  onClick={() => {
                    const text = (form.getFieldValue("placeName") as string | undefined)?.trim();
                    setCoords(null);
                    if (text) handlePlaceSearch(text);
                    placeInputRef.current?.focus();
                  }}
                >
                  重新定位
                </a>{" "}
                <a
                  onClick={() => {
                    setCoords(null);
                  }}
                >
                  取消定位
                </a>
              </Typography.Text>
            ) : (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                输入关键词搜索并选择，即可定位到地图；也可只填文字不定位
              </Typography.Text>
            )
          }
        >
          <AutoComplete
            options={placeOptions}
            onSearch={handlePlaceSearch}
            onSelect={(_value, option) => {
              const poi = (option as { poi: PoiOption }).poi;
              setCoords({ name: poi.name, lng: poi.lng, lat: poi.lat, address: poi.address });
              setPlaceOptions([]);
              // 等 Form 内部 onChange 先写入带序号的选项值，再覆盖为干净的地点名
              setTimeout(() => form.setFieldValue("placeName", poi.name), 0);
            }}
            onChange={(text: string) => {
              // 用函数式更新拿到最新 coords，避免 onSelect/onChange 竞争时误清刚设置的坐标；
              // 选项值带 "#序号" 后缀，比较时剥掉
              setCoords((prev) => {
                if (!prev) return prev;
                const base = text.includes("#") ? text.slice(0, text.lastIndexOf("#")) : text;
                return base === prev.name || text === prev.name ? prev : null;
              });
            }}
          >
            <Input ref={placeInputRef} placeholder="如：宽窄巷子" maxLength={80} allowClear />
          </AutoComplete>
        </Form.Item>
        <Form.Item label="预估费用" name="estimatedCost">
          <InputNumber min={0} prefix="¥" style={{ width: 200 }} placeholder="选填" />
        </Form.Item>
        <Form.Item label="备注" name="notes" style={{ marginBottom: 0 }}>
          <Input.TextArea rows={2} placeholder="选填" maxLength={500} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
