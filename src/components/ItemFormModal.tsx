"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  App,
  AutoComplete,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Spin,
  Switch,
  TimePicker,
  Typography,
  type InputRef,
} from "antd";
import { EnvironmentOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import MapPickerModal from "@/components/MapPickerModal";
import { ITEM_TYPES } from "@/types/constants";
import type { ItineraryItemT } from "@/types";

interface Props {
  open: boolean;
  tripId: string;
  dayIndex: number;
  dayLabel: string;
  cityHint?: string; // 地点搜索的城市偏好（行程目的地）
  item: ItineraryItemT | null; // null = 新增
  insertAfterSortOrder?: number; // 新增时指定插入位置（插入到该 sortOrder 之后）
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
  insertAfterSortOrder,
  onCancel,
  onSaved,
}: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [coords, setCoords] = useState<Located | null>(null);
  const [placeOptions, setPlaceOptions] = useState<{ value: string; label: ReactNode; poi: PoiOption }[]>([]);
  const [searching, setSearching] = useState(false);
  // 拆分多城市目的地（如「昆明、大理、丽江」→ ["昆明","大理","丽江"]）
  const cities = useMemo(() => {
    if (!cityHint) return [];
    return cityHint
      .trim()
      .split(/[、,，/\s]+/)
      .map((c) => c.trim())
      .filter((c) => c.length >= 2 && c.length <= 10);
  }, [cityHint]);

  const [searchCity, setSearchCity] = useState<string>("all");
  const [mapPickerOpen, setMapPickerOpen] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const placeInputRef = useRef<InputRef>(null);

  useEffect(() => {
    if (!open) {
      // 关闭时重置表单，防止 AutoComplete 内部状态残留
      form.resetFields();
      setCoords(null);
      setPlaceOptions([]);
      setSearching(false);
      return;
    }
    setPlaceOptions([]);
    setSearchCity(cities[0] ?? "all");
    setSearching(false);
    if (item) {
      form.setFieldsValue({
        type: item.type,
        title: item.title,
        time: item.startTime
          ? [dayjs(item.startTime, "HH:mm"), item.endTime ? dayjs(item.endTime, "HH:mm") : null]
          : undefined,
        placeName: item.placeName ?? "",
        estimatedCost: item.estimatedCost ?? undefined,
        needBooking: item.needBooking === true,
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
  }, [open, item, form, cities]);

  const handlePlaceSearch = (text: string) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const keywords = text.trim();
    if (!keywords) {
      setPlaceOptions([]);
      setSearching(false);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({ keywords });
        if (searchCity !== "all") params.set("city", searchCity);
        const res = await fetch(`/api/geo/search?${params.toString()}`);
        const data = (await res.json()) as { ok: boolean; pois?: PoiOption[]; error?: string };
        if (!data.ok || !data.pois) {
          setPlaceOptions([]);
          if (!data.ok && data.error) message.warning(data.error);
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
        message.error("地点搜索失败，请重试");
      } finally {
        setSearching(false);
      }
    }, 350);
  };

  const handleMapPick = (data: { name: string; lng: number; lat: number; address: string }) => {
    setCoords({ name: data.name, lng: data.lng, lat: data.lat, address: data.address });
    form.setFieldValue("placeName", data.name);
    setMapPickerOpen(false);
  };

  const handleSave = async () => {
    const values = await form.validateFields().catch(() => null);
    if (!values) return;
    const time = values.time as [Dayjs | null, Dayjs | null] | null | undefined;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
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
        needBooking: values.needBooking === true,
        notes: values.notes ?? "",
      };
      // 新增时指定插入位置
      if (!item && insertAfterSortOrder != null) {
        body.sortOrder = insertAfterSortOrder + 1;
      }
      const res = await fetch(item ? `/api/items/${item.id}` : `/api/trips/${tripId}/items`, {
        method: item ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
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
      destroyOnClose
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
                输入关键词搜索并选择，即可定位到地图；也可只填文字不定位{" "}
                <a onClick={() => setMapPickerOpen(true)}>地图选点</a>
              </Typography.Text>
            )
          }
        >
          {cities.length > 0 && (
            <div style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: "#888", whiteSpace: "nowrap" }}>搜索范围：</span>
              <Segmented
                size="small"
                value={searchCity}
                onChange={(val) => setSearchCity(val as string)}
                options={[
                  ...cities.map((c) => ({ value: c, label: c.length > 8 ? `${c.slice(0, 8)}…` : c })),
                  { value: "all", label: "全部地区" },
                ]}
              />
            </div>
          )}
          <AutoComplete
                maxLength={80}
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
                <Input ref={placeInputRef} placeholder="如：宽窄巷子" allowClear suffix={searching ? <Spin size="small" /> : undefined} />
              </AutoComplete>
        </Form.Item>
        <Form.Item label="预估费用" name="estimatedCost">
          <InputNumber min={0} prefix="¥" style={{ width: 200 }} placeholder="选填" />
        </Form.Item>
        <Form.Item
          label="需要预约"
          name="needBooking"
          valuePropName="checked"
          extra="如博物馆、热门餐厅等需提前预约的地点建议开启"
        >
          <Switch checkedChildren="需预约" unCheckedChildren="无需预约" />
        </Form.Item>
        <Form.Item label="备注" name="notes" style={{ marginBottom: 0 }}>
          <Input.TextArea rows={2} placeholder="选填" maxLength={500} />
        </Form.Item>
      </Form>
      <MapPickerModal
        open={mapPickerOpen}
        cityHint={cities[0]}
        onCancel={() => setMapPickerOpen(false)}
        onPick={handleMapPick}
      />
    </Modal>
  );
}
