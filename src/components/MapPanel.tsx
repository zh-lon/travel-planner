"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, App, Button, Empty, Segmented, Select, Spin, Tag, Tooltip, Typography } from "antd";
import { AimOutlined, EditOutlined, PushpinOutlined } from "@ant-design/icons";
import type { Dayjs } from "dayjs";
import { loadAMap } from "@/lib/map/amap";
import { dayColor, itemTypeMeta } from "@/types/constants";
import type { ItineraryItemT } from "@/types";

type SegMode = "line" | "driving" | "walking" | "riding";

const VALID_MODES: SegMode[] = ["line", "driving", "walking", "riding"];
const MODE_LABEL: Record<SegMode, string> = {
  line: "直线",
  driving: "驾车",
  walking: "步行",
  riding: "骑行",
};
const MODE_EMOJI: Record<SegMode, string> = {
  line: "📏",
  driving: "🚗",
  walking: "🚶",
  riding: "🚴",
};

interface SegRoute {
  path: [number, number][];
  distance: number; // 米
  duration: number; // 秒
  tolls: number; // 元
  taxiCost: number; // 元
}

// 段统计（key = 段终点行程项 id）
interface SegStat {
  mode: SegMode;
  distance: number;
  duration: number;
  tolls: number;
  taxiCost: number;
  straight: boolean; // 规划失败回退直线
}

interface Props {
  items: ItineraryItemT[];
  startDate: Dayjs;
  dayCount: number;
  readOnly?: boolean; // 只读共享：隐藏定位编辑入口、禁用交通方式修改
  onEditItem: (item: ItineraryItemT) => void;
  onItemsChanged?: () => void;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)}米` : `${(m / 1000).toFixed(1)}公里`;
}

function fmtDuration(sec: number): string {
  const min = Math.max(1, Math.round(sec / 60));
  if (min < 60) return `${min}分钟`;
  return `${Math.floor(min / 60)}小时${min % 60 > 0 ? `${min % 60}分` : ""}`;
}

// 球面直线距离（米）
function straightDistance(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLng = (b[0] - a[0]) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// 调高德 JS API 插件规划两点路线
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function searchRoute(AMap: any, mode: SegMode, from: [number, number], to: [number, number]): Promise<SegRoute | null> {
  return new Promise((resolve) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handle = (status: string, result: any) => {
      if (status !== "complete" || !result?.routes?.length) {
        resolve(null);
        return;
      }
      const route = result.routes[0];
      const path: [number, number][] = [];
      for (const step of route.steps ?? []) {
        for (const p of step.path ?? []) {
          const lng = typeof p.lng === "number" ? p.lng : p.getLng?.();
          const lat = typeof p.lat === "number" ? p.lat : p.getLat?.();
          if (typeof lng === "number" && typeof lat === "number") path.push([lng, lat]);
        }
      }
      resolve({
        path: path.length >= 2 ? path : [from, to],
        distance: Number(route.distance ?? 0) || 0,
        duration: Number(route.time ?? 0) || 0,
        tolls: Number(route.tolls ?? 0) || 0,
        taxiCost: Number(result.taxi_cost ?? 0) || 0,
      });
    };
    try {
      const options = { autoFitView: false };
      const planner =
        mode === "driving"
          ? new AMap.Driving(options)
          : mode === "walking"
            ? new AMap.Walking(options)
            : new AMap.Riding(options);
      planner.search(new AMap.LngLat(from[0], from[1]), new AMap.LngLat(to[0], to[1]), handle);
    } catch {
      resolve(null);
    }
  });
}

export default function MapPanel({ items, dayCount, readOnly, onEditItem, onItemsChanged }: Props) {
  const { message } = App.useApp();
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const amapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const overlaysRef = useRef<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const infoWindowRef = useRef<any>(null);
  const routeCacheRef = useRef(new Map<string, SegRoute | null>());
  const genRef = useRef(0);
  const fitKeyRef = useRef("");

  const [status, setStatus] = useState<"loading" | "ready" | "nokey" | "error">("loading");
  const [errorText, setErrorText] = useState("");
  const [dayFilter, setDayFilter] = useState<number>(-1); // -1 = 全部
  const [globalMode, setGlobalMode] = useState<SegMode>("line");
  const [overrides, setOverrides] = useState<Record<string, SegMode | null>>({});
  const [segStats, setSegStats] = useState<Record<string, SegStat>>({});
  const [routing, setRouting] = useState(false);
  const [picking, setPicking] = useState<{ itemId: string; title: string } | null>(null);
  const pickHandlerRef = useRef<((lng: number, lat: number) => void) | null>(null);

  // 行程项数据更新后（含保存交通方式成功回读），清空本地乐观覆盖
  useEffect(() => {
    setOverrides((prev) => (Object.keys(prev).length > 0 ? {} : prev));
  }, [items]);

  // 段的生效交通方式：本地覆盖 > 行程项保存值 > 全局默认
  const effectiveMode = useCallback(
    (destItem: ItineraryItemT): SegMode => {
      const raw =
        destItem.id in overrides ? overrides[destItem.id] : (destItem.transportMode as SegMode | null);
      return raw && VALID_MODES.includes(raw) ? raw : globalMode;
    },
    [overrides, globalMode],
  );

  // 初始化地图（一次）
  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const res = await fetch("/api/config/public");
        const cfg = (await res.json()) as { amapJsKey?: string; amapSecurityCode?: string };
        const jsKey = cfg.amapJsKey?.trim();
        const securityCode = cfg.amapSecurityCode?.trim();
        if (!jsKey) {
          if (!disposed) setStatus("nokey");
          return;
        }
        const AMap = await loadAMap(jsKey, securityCode);
        if (disposed || !containerRef.current) return;
        amapRef.current = AMap;
        const map = new AMap.Map(containerRef.current, { zoom: 11, viewMode: "2D" });
        map.addControl(new AMap.ToolBar({ position: "RB" }));
        map.addControl(new AMap.Scale());
        mapRef.current = map;
        infoWindowRef.current = new AMap.InfoWindow({ offset: new AMap.Pixel(0, -20) });
        // 地图选点定位：处于选点模式时，点击地图即设置目标行程项的位置
        map.on("click", (e: { lnglat?: { getLng?: () => number; getLat?: () => number; lng?: number; lat?: number } }) => {
          const lng = e.lnglat?.getLng?.() ?? e.lnglat?.lng;
          const lat = e.lnglat?.getLat?.() ?? e.lnglat?.lat;
          if (typeof lng === "number" && typeof lat === "number") {
            pickHandlerRef.current?.(lng, lat);
          }
        });
        setStatus("ready");
      } catch (err) {
        if (!disposed) {
          setErrorText(err instanceof Error ? err.message : String(err));
          setStatus("error");
        }
      }
    })();
    return () => {
      disposed = true;
      mapRef.current?.destroy?.();
      mapRef.current = null;
    };
  }, []);

  const openInfo = useCallback((item: ItineraryItemT) => {
    const map = mapRef.current;
    if (!map || item.lng == null || item.lat == null) return;
    const meta = itemTypeMeta(item.type);
    const time = item.startTime
      ? `${item.startTime}${item.endTime ? ` - ${item.endTime}` : ""}`
      : "";
    const html = `<div style="max-width:240px;line-height:1.6">
      <b>${escapeHtml(item.title)}</b><br/>
      <span style="color:#888;font-size:12px">第 ${item.dayIndex + 1} 天 · ${meta.label}${time ? ` · ${escapeHtml(time)}` : ""}</span>
      ${item.address ? `<br/><span style="color:#888;font-size:12px">${escapeHtml(item.address)}</span>` : ""}
    </div>`;
    infoWindowRef.current?.setContent(html);
    infoWindowRef.current?.open(map, [item.lng, item.lat]);
  }, []);

  // 重建覆盖物：标注 + 逐段路线（按各段交通方式）
  useEffect(() => {
    if (status !== "ready") return;
    const AMap = amapRef.current;
    const map = mapRef.current;
    if (!AMap || !map) return;
    const gen = ++genRef.current;

    const run = async () => {
      const dayPoints: {
        dayIndex: number;
        points: { item: ItineraryItemT; seq: number; pos: [number, number] }[];
      }[] = [];
      for (let d = 0; d < dayCount; d++) {
        if (dayFilter !== -1 && dayFilter !== d) continue;
        const dayItems = items
          .filter((i) => i.dayIndex === d)
          .sort((a, b) => a.sortOrder - b.sortOrder);
        const points = dayItems
          .map((item, seq) => ({ item, seq, pos: [item.lng, item.lat] as [number, number] }))
          .filter((p) => p.item.lng != null && p.item.lat != null) as {
          item: ItineraryItemT;
          seq: number;
          pos: [number, number];
        }[];
        dayPoints.push({ dayIndex: d, points });
      }

      // 逐段确定方式并规划（带缓存）
      const segKey = (m: SegMode, a: [number, number], b: [number, number]) =>
        `${m}|${a[0]},${a[1]}|${b[0]},${b[1]}`;
      interface SegDraw {
        dayIndex: number;
        destId: string;
        mode: SegMode;
        from: [number, number];
        to: [number, number];
        route: SegRoute | null; // line 模式为 null
        failed: boolean;
      }
      const segments: SegDraw[] = [];
      const needFetch: SegDraw[] = [];
      for (const { dayIndex, points } of dayPoints) {
        for (let i = 0; i + 1 < points.length; i++) {
          const dest = points[i + 1];
          const mode = effectiveMode(dest.item);
          const seg: SegDraw = {
            dayIndex,
            destId: dest.item.id,
            mode,
            from: points[i].pos,
            to: dest.pos,
            route: null,
            failed: false,
          };
          if (mode !== "line" && !routeCacheRef.current.has(segKey(mode, seg.from, seg.to))) {
            needFetch.push(seg);
          }
          segments.push(seg);
        }
      }

      if (needFetch.length > 0) {
        setRouting(true);
        for (const seg of needFetch) {
          const key = segKey(seg.mode, seg.from, seg.to);
          if (!routeCacheRef.current.has(key)) {
            const route = await searchRoute(AMap, seg.mode, seg.from, seg.to);
            if (genRef.current !== gen) return;
            routeCacheRef.current.set(key, route);
          }
        }
        setRouting(false);
      }
      if (genRef.current !== gen) return;
      for (const seg of segments) {
        if (seg.mode === "line") continue;
        seg.route = routeCacheRef.current.get(segKey(seg.mode, seg.from, seg.to)) ?? null;
        seg.failed = seg.route == null;
      }

      // 绘制
      map.remove(overlaysRef.current);
      overlaysRef.current = [];
      infoWindowRef.current?.close();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const overlays: any[] = [];

      for (const { dayIndex, points } of dayPoints) {
        const color = dayColor(dayIndex);
        for (const { item, seq, pos } of points) {
          const content = `<div style="width:26px;height:26px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);color:#fff;font-size:12px;font-weight:600">${seq + 1}</div>`;
          const marker = new AMap.Marker({ position: pos, content, anchor: "center", title: item.title });
          marker.on("click", () => openInfo(item));
          overlays.push(marker);
        }
      }

      const stats: Record<string, SegStat> = {};
      for (const seg of segments) {
        const color = dayColor(seg.dayIndex);
        if (seg.mode === "line" || seg.failed) {
          overlays.push(
            new AMap.Polyline({
              path: [seg.from, seg.to],
              strokeColor: color,
              strokeWeight: seg.mode === "line" ? 4 : 4,
              strokeOpacity: 0.75,
              showDir: seg.mode === "line",
              strokeStyle: seg.mode === "line" ? "solid" : "dashed",
              lineJoin: "round",
            }),
          );
          stats[seg.destId] = {
            mode: seg.mode,
            distance: straightDistance(seg.from, seg.to),
            duration: 0,
            tolls: 0,
            taxiCost: 0,
            straight: seg.failed,
          };
        } else if (seg.route) {
          overlays.push(
            new AMap.Polyline({
              path: seg.route.path,
              strokeColor: color,
              strokeWeight: 5,
              strokeOpacity: 0.85,
              showDir: true,
              lineJoin: "round",
            }),
          );
          if (seg.route.duration > 0) {
            overlays.push(
              new AMap.Text({
                text: `${MODE_EMOJI[seg.mode]}${fmtDuration(seg.route.duration)}`,
                position: seg.route.path[Math.floor(seg.route.path.length / 2)],
                anchor: "center",
                style: {
                  "background-color": "#fff",
                  border: `1px solid ${color}`,
                  "border-radius": "10px",
                  "font-size": "11px",
                  color: "#555",
                  padding: "0 6px",
                },
              }),
            );
          }
          stats[seg.destId] = {
            mode: seg.mode,
            distance: seg.route.distance,
            duration: seg.route.duration,
            tolls: seg.route.tolls,
            taxiCost: seg.route.taxiCost,
            straight: false,
          };
        }
      }

      if (overlays.length > 0) {
        map.add(overlays);
        const fitKey = `${dayFilter}|${items.map((i) => i.id).join(",")}`;
        if (fitKeyRef.current !== fitKey) {
          map.setFitView(overlays, false, [60, 60, 60, 60]);
          fitKeyRef.current = fitKey;
        }
      }
      overlaysRef.current = overlays;
      setSegStats(stats);
    };

    run();
  }, [status, items, dayFilter, globalMode, overrides, dayCount, effectiveMode, openInfo]);

  // 地图选点定位：进入/退出选点模式与落点保存
  const startPick = (item: ItineraryItemT) => {
    setPicking({ itemId: item.id, title: item.title });
    mapRef.current?.setDefaultCursor?.("crosshair");
    infoWindowRef.current?.close();
  };
  const cancelPick = () => {
    setPicking(null);
    mapRef.current?.setDefaultCursor?.("default");
  };
  // 每次渲染刷新处理器，保证拿到最新的 picking 状态
  pickHandlerRef.current = async (lng: number, lat: number) => {
    const target = picking;
    if (!target) return;
    cancelPick();
    let address = "";
    try {
      const regeoRes = await fetch(`/api/geo/regeo?lng=${lng}&lat=${lat}`);
      const regeo = (await regeoRes.json()) as { ok?: boolean; address?: string | null };
      if (regeo.ok && typeof regeo.address === "string") address = regeo.address;
    } catch {
      // 反查地址失败不阻塞定位
    }
    const res = await fetch(`/api/items/${target.itemId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lng, lat, address }),
    }).catch(() => null);
    if (res?.ok) {
      message.success(`已更新「${target.title}」的位置`);
      onItemsChanged?.();
    } else {
      message.error("保存位置失败");
    }
  };

  // 保存某段的交通方式（存在段终点行程项上）
  const handleModeChange = async (destItem: ItineraryItemT, value: string) => {    const mode = value === "default" ? null : (value as SegMode);
    const prevValue = destItem.id in overrides ? overrides[destItem.id] : (destItem.transportMode as SegMode | null);
    setOverrides((prev) => ({ ...prev, [destItem.id]: mode }));
    const res = await fetch(`/api/items/${destItem.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transportMode: mode ?? "" }),
    }).catch(() => null);
    if (!res || !res.ok) {
      message.error("保存交通方式失败");
      setOverrides((prev) => ({ ...prev, [destItem.id]: prevValue }));
    } else {
      onItemsChanged?.();
    }
  };

  const visibleDayIndices = Array.from({ length: dayCount }, (_, d) => d).filter(
    (d) => dayFilter === -1 || dayFilter === d,
  );
  const allVisibleItems = items.filter((i) => dayFilter === -1 || i.dayIndex === dayFilter);
  const unlocatedCount = allVisibleItems.filter((i) => i.lng == null || i.lat == null).length;

  const segStatText = (stat: SegStat | undefined): string => {
    if (!stat) return "计算中…";
    if (stat.mode === "line" && !stat.straight) return `直线距离 ${fmtDistance(stat.distance)}`;
    if (stat.straight) return `规划失败 · 直线 ${fmtDistance(stat.distance)}`;
    let text = `${fmtDistance(stat.distance)} · ${fmtDuration(stat.duration)}`;
    if (stat.tolls > 0) text += ` · 过路费¥${Math.round(stat.tolls)}`;
    if (stat.taxiCost > 0) text += ` · 打车约¥${Math.round(stat.taxiCost)}`;
    return text;
  };

  const daySummaryText = (d: number): string | null => {
    const dayItems = items
      .filter((i) => i.dayIndex === d && i.lng != null && i.lat != null)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    if (dayItems.length < 2) return null;
    const stats = dayItems.slice(1).map((i) => segStats[i.id]).filter(Boolean) as SegStat[];
    if (stats.length === 0) return null;
    const sum = stats.reduce(
      (acc, s) => ({
        distance: acc.distance + s.distance,
        duration: acc.duration + s.duration,
        tolls: acc.tolls + s.tolls,
        taxiCost: acc.taxiCost + s.taxiCost,
        straight: acc.straight + (s.straight ? 1 : 0),
      }),
      { distance: 0, duration: 0, tolls: 0, taxiCost: 0, straight: 0 },
    );
    let text =
      sum.duration > 0
        ? `全程 ${fmtDistance(sum.distance)} · ${fmtDuration(sum.duration)}`
        : `直线距离合计 ${fmtDistance(sum.distance)}`;
    if (sum.tolls > 0) text += ` · 过路费¥${Math.round(sum.tolls)}`;
    if (sum.taxiCost > 0) text += ` · 打车约¥${Math.round(sum.taxiCost)}`;
    if (sum.straight > 0) text += ` · ${sum.straight}段规划失败`;
    return text;
  };

  if (status === "nokey") {
    return (
      <Alert
        type="warning"
        showIcon
        message="尚未配置高德地图"
        description={
          <span>
            请到<a href="/settings">设置页</a>填写高德 JS API Key 与安全密钥后再使用地图功能。
          </span>
        }
      />
    );
  }
  if (status === "error") {
    return <Alert type="error" showIcon message="地图加载失败" description={errorText} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {picking && (
        <Alert
          type="info"
          showIcon
          message={`点击地图上的目标位置，为「${picking.title}」重新定位`}
          action={
            <Button size="small" onClick={cancelPick}>
              取消选点
            </Button>
          }
        />
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Segmented
          value={dayFilter}
          onChange={(v) => setDayFilter(v as number)}
          options={[
            { label: "全部", value: -1 },
            ...Array.from({ length: dayCount }, (_, d) => ({
              label: (
                <span>
                  <span
                    style={{
                      display: "inline-block",
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: dayColor(d),
                      marginRight: 4,
                    }}
                  />
                  第{d + 1}天
                </span>
              ),
              value: d,
            })),
          ]}
        />
        <Segmented
          value={globalMode}
          onChange={(v) => setGlobalMode(v as SegMode)}
          options={VALID_MODES.map((m) => ({ label: `${MODE_EMOJI[m]} ${MODE_LABEL[m]}`, value: m }))}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          默认方式，右侧每段可单独选择
        </Typography.Text>
        {routing && <Spin size="small" />}
        {unlocatedCount > 0 && (
          <Typography.Text type="warning" style={{ fontSize: 12 }}>
            {unlocatedCount} 个行程项未定位（不参与路线）
          </Typography.Text>
        )}
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 320, position: "relative" }}>
          <div ref={containerRef} style={{ height: 520, borderRadius: 8, overflow: "hidden" }} />
          {status === "loading" && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#fafafa",
                borderRadius: 8,
              }}
            >
              <Spin tip="地图加载中…" />
            </div>
          )}
        </div>
        <div style={{ width: 320, maxHeight: 520, overflowY: "auto" }}>
          {allVisibleItems.length === 0 ? (
            <Empty description="暂无行程项" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            visibleDayIndices.map((d) => {
              const dayItems = items
                .filter((i) => i.dayIndex === d)
                .sort((a, b) => a.sortOrder - b.sortOrder);
              if (dayItems.length === 0) return null;
              const summary = daySummaryText(d);
              let prevLocated = false;
              return (
                <div key={d} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        background: dayColor(d),
                        flexShrink: 0,
                      }}
                    />
                    <Typography.Text strong style={{ fontSize: 13 }}>
                      第 {d + 1} 天
                    </Typography.Text>
                  </div>
                  {summary && (
                    <Typography.Text
                      type="secondary"
                      style={{ fontSize: 12, display: "block", marginBottom: 6, paddingLeft: 16 }}
                    >
                      {summary}
                    </Typography.Text>
                  )}
                  {dayItems.map((item, seq) => {
                    const located = item.lng != null && item.lat != null;
                    const showSegRow = located && prevLocated;
                    const row = (
                      <div key={item.id}>
                        {showSegRow && (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                              padding: "2px 0 2px 14px",
                              margin: "2px 0",
                            }}
                          >
                            <span style={{ color: "#ccc", fontSize: 12 }}>┆</span>
                            <Select
                              size="small"
                              variant="borderless"
                              disabled={readOnly}
                              value={
                                (item.id in overrides
                                  ? overrides[item.id]
                                  : (item.transportMode as SegMode | null)) ?? "default"
                              }
                              onChange={(v) => handleModeChange(item, v)}
                              popupMatchSelectWidth={false}
                              style={{ width: 116, flexShrink: 0 }}
                              options={[
                                { value: "default", label: `默认·${MODE_LABEL[globalMode]}` },
                                ...VALID_MODES.map((m) => ({
                                  value: m,
                                  label: `${MODE_EMOJI[m]} ${MODE_LABEL[m]}`,
                                })),
                              ]}
                            />
                            <Typography.Text
                              type="secondary"
                              style={{ fontSize: 12, flex: 1, minWidth: 0 }}
                              ellipsis
                            >
                              {segStatText(segStats[item.id])}
                            </Typography.Text>
                          </div>
                        )}
                        <div
                          onClick={() => {
                            if (located) {
                              mapRef.current?.setZoomAndCenter(15, [item.lng, item.lat]);
                              openInfo(item);
                            } else {
                              onEditItem(item);
                            }
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "6px 8px",
                            borderRadius: 6,
                            cursor: "pointer",
                            background: "#fff",
                            border: "1px solid #f0f0f0",
                          }}
                        >
                          <span
                            style={{
                              width: 20,
                              height: 20,
                              borderRadius: "50%",
                              background: dayColor(item.dayIndex),
                              color: "#fff",
                              fontSize: 12,
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                            }}
                          >
                            {seq + 1}
                          </span>
                          <span
                            style={{
                              flex: 1,
                              minWidth: 0,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {item.title}
                          </span>
                          <span
                            style={{ display: "flex", alignItems: "center", gap: 0, flexShrink: 0 }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {!readOnly && (
                              <>
                                <Tooltip title="在地图上点选新位置">
                                  <Button
                                    type="text"
                                    size="small"
                                    icon={<PushpinOutlined />}
                                    onClick={() => startPick(item)}
                                  />
                                </Tooltip>
                                <Tooltip title="编辑（可搜索重新定位）">
                                  <Button
                                    type="text"
                                    size="small"
                                    icon={<EditOutlined />}
                                    onClick={() => onEditItem(item)}
                                  />
                                </Tooltip>
                              </>
                            )}
                            {located ? (
                              <AimOutlined style={{ color: "#52c41a", marginLeft: 4 }} />
                            ) : (
                              <Tag color="warning" style={{ marginRight: 0, marginLeft: 4 }}>
                                未定位
                              </Tag>
                            )}
                          </span>
                        </div>
                      </div>
                    );
                    prevLocated = located || prevLocated;
                    return row;
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
