"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Modal, Spin, Typography } from "antd";
import { AimOutlined } from "@ant-design/icons";
import { loadAMap } from "@/lib/map/amap";

interface Props {
  open: boolean;
  cityHint?: string; // 用于初始地图中心定位
  onCancel: () => void;
  onPick: (data: { name: string; lng: number; lat: number; address: string }) => void;
}

export default function MapPickerModal({ open, cityHint, onCancel, onPick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const amapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markerRef = useRef<any>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "nokey" | "error">("loading");
  const [errorText, setErrorText] = useState("");
  const [picked, setPicked] = useState<{ lng: number; lat: number } | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    setPicked(null);
    setStatus("loading");
    setErrorText("");

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
        const AMap = await loadAMap(jsKey, securityCode || undefined);
        if (disposed || !containerRef.current) return;
        amapRef.current = AMap;

        const map = new AMap.Map(containerRef.current, {
          zoom: 12,
          viewMode: "2D",
        });
        mapRef.current = map;

        // 点击地图放置标记
        map.on("click", (e: { lnglat?: { getLng?: () => number; getLat?: () => number; lng?: number; lat?: number } }) => {
          const lng = e.lnglat?.getLng?.() ?? e.lnglat?.lng;
          const lat = e.lnglat?.getLat?.() ?? e.lnglat?.lat;
          if (typeof lng !== "number" || typeof lat !== "number") return;
          // 移除旧标记
          if (markerRef.current) {
            map.remove(markerRef.current);
            markerRef.current = null;
          }
          // 放置新标记
          markerRef.current = new AMap.Marker({
            position: [lng, lat],
            anchor: "center",
          });
          map.add(markerRef.current);
          setPicked({ lng, lat });
        });

        // 尝试根据城市名定位地图中心
        let centered = false;
        if (cityHint) {
          try {
            const geoRes = await fetch(
              `/api/geo/search?keywords=${encodeURIComponent(cityHint)}&city=${encodeURIComponent(cityHint)}`,
            );
            const data = (await geoRes.json()) as { ok?: boolean; pois?: { lng: number; lat: number }[] };
            if (data.ok && data.pois?.length) {
              map.setCenter([data.pois[0].lng, data.pois[0].lat]);
              centered = true;
            }
          } catch {
            // 城市定位失败，使用默认中心
          }
        }
        if (!centered) {
          // 默认中心：中国中部
          map.setCenter([104.07, 30.67]);
          map.setZoom(5);
        }

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
      markerRef.current = null;
    };
  }, [open, cityHint]);

  const handleConfirm = async () => {
    if (!picked) return;
    setConfirming(true);
    let address = "";
    try {
      const regeoRes = await fetch(`/api/geo/regeo?lng=${picked.lng}&lat=${picked.lat}`);
      const regeo = (await regeoRes.json()) as { ok?: boolean; address?: string | null };
      if (regeo.ok && typeof regeo.address === "string") address = regeo.address;
    } catch {
      // 地址反查失败不阻塞
    }
    const name = address || `${picked.lng.toFixed(6)}, ${picked.lat.toFixed(6)}`;
    onPick({ name, lng: picked.lng, lat: picked.lat, address });
    setConfirming(false);
  };

  return (
    <Modal
      title="地图选点 — 点击地图上的目标位置"
      open={open}
      onCancel={onCancel}
      width={720}
      footer={[
        <Button key="cancel" onClick={onCancel}>
          取消
        </Button>,
        <Button key="ok" type="primary" loading={confirming} disabled={!picked} onClick={handleConfirm}>
          确认选点
        </Button>,
      ]}
      destroyOnClose
    >
      {status === "loading" && (
        <div style={{ textAlign: "center", padding: 60 }}>
          <Spin size="large" />
          <div style={{ marginTop: 12, color: "#999" }}>加载地图中…</div>
        </div>
      )}
      {status === "nokey" && (
        <div style={{ textAlign: "center", padding: 60, color: "#999" }}>
          尚未配置高德地图 JS Key，请到设置页填写
        </div>
      )}
      {status === "error" && (
        <div style={{ textAlign: "center", padding: 60, color: "#ff4d4f" }}>{errorText}</div>
      )}
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: 420,
          display: status === "ready" ? "block" : "none",
          borderRadius: 8,
          overflow: "hidden",
        }}
      />
      {picked && status === "ready" && (
        <Typography.Text type="secondary" style={{ display: "block", marginTop: 8, fontSize: 12 }}>
          <AimOutlined style={{ color: "#0d9488", marginRight: 4 }} />
          已选点：{picked.lng.toFixed(6)}, {picked.lat.toFixed(6)}（点击地图可重新选择）
        </Typography.Text>
      )}
    </Modal>
  );
}