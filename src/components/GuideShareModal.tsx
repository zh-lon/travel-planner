"use client";

import { useCallback, useEffect, useState } from "react";
import { App, Button, Modal, Popconfirm, Space, Spin, Typography } from "antd";
import { CopyOutlined, DownloadOutlined, ReloadOutlined, QrcodeOutlined } from "@ant-design/icons";
import QRCode from "qrcode";
import type { TripDetail } from "@/types";
import { tripToHtmlGuide, downloadText } from "@/lib/export";

interface Props {
  open: boolean;
  trip: TripDetail | null;
  onCancel: () => void;
  // 分享码变化后同步给父组件（生成/刷新/停用）
  onTokenChanged: (token: string | null) => void;
}

// 随身行程手册：扫码在线查看。生成分享码 → 二维码 + 链接，免登录访问
export default function GuideShareModal({ open, trip, onCancel, onTokenChanged }: Props) {
  const { message } = App.useApp();
  const [token, setToken] = useState<string | null>(null);
  const [tokenAt, setTokenAt] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const [origin, setOrigin] = useState("");
  useEffect(() => { setOrigin(window.location.origin); }, []);
  const link = token ? `${origin}/api/public/guide/${token}` : "";

  const ensureToken = useCallback(
    async (regenerate = false) => {
      if (!trip) return;
      setLoading(true);
      try {
        const res = await fetch(`/api/trips/${trip.id}/share-token`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ regenerate }),
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        setToken(data.shareToken);
        setTokenAt(data.shareTokenAt ?? null);
        onTokenChanged(data.shareToken);
      } catch {
        message.error("生成分享码失败");
      } finally {
        setLoading(false);
      }
    },
    [trip, message, onTokenChanged],
  );

  useEffect(() => {
    if (!open || !trip) return;
    // token 未变时不清空二维码（避免父组件回传 trip 引起竞态：qrUrl 被清空后不再重建）
    if (trip.shareToken && trip.shareToken !== token) {
      setQrUrl("");
    }
    if (trip.shareToken) {
      setToken(trip.shareToken);
      setTokenAt(trip.shareTokenAt ?? null);
    } else {
      setToken(null);
      setTokenAt(null);
      ensureToken(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, trip?.id, trip?.shareToken]);

  useEffect(() => {
    if (!token) return;
    QRCode.toDataURL(`${window.location.origin}/api/public/guide/${token}`, {
      width: 220,
      margin: 1,
    })
      .then(setQrUrl)
      .catch(() => message.error("二维码生成失败"));
  }, [token, message]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      message.success("链接已复制");
    } catch {
      message.error("复制失败，请手动选择复制");
    }
  };

  const revoke = async () => {
    if (!trip) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/trips/${trip.id}/share-token`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setToken(null);
      setTokenAt(null);
      setQrUrl("");
      onTokenChanged(null);
      message.success("已停用，旧二维码与链接立即失效");
    } catch {
      message.error("操作失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="随身行程手册" open={open} onCancel={onCancel} footer={null} width={420}>
      <div style={{ textAlign: "center", padding: "4px 0 8px" }}>
        {loading ? (
          <div style={{ padding: 48 }}>
            <Spin />
          </div>
        ) : token ? (
          <>
            {qrUrl ? (
              <img
                src={qrUrl}
                alt="行程手册二维码"
                style={{ width: 220, height: 220, borderRadius: 12, border: "1px solid #eee" }}
              />
            ) : (
              <div style={{ width: 220, height: 220, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Spin />
              </div>
            )}
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: "10px 0 4px" }}>
              <QrcodeOutlined /> 用手机扫码即可在线查看，无需登录；也可复制链接发给同伴
            </Typography.Paragraph>
            <Typography.Text
              copyable={false}
              style={{ fontSize: 12, wordBreak: "break-all", color: "#888", display: "block", marginBottom: 12 }}
            >
              {link}
            </Typography.Text>
            <Space wrap style={{ justifyContent: "center" }}>
              <Button icon={<CopyOutlined />} onClick={copyLink}>
                复制链接
              </Button>
              <Button
                icon={<DownloadOutlined />}
                onClick={() => trip && downloadText(`${trip.title}·行程手册.html`, tripToHtmlGuide(trip), "text/html")}
              >
                离线 HTML
              </Button>
              <Button icon={<ReloadOutlined />} loading={busy} onClick={() => ensureToken(true)}>
                刷新二维码
              </Button>
              <Popconfirm
                title="停用后旧二维码与链接立即失效"
                okText="停用"
                okButtonProps={{ danger: true }}
                cancelText="取消"
                onConfirm={revoke}
              >
                <Button danger loading={busy}>
                  停用
                </Button>
              </Popconfirm>
            </Space>
          </>
        ) : (
          <div style={{ padding: 32 }}>
            <Spin />
          </div>
        )}
        {tokenAt && (
          <Typography.Paragraph type="secondary" style={{ fontSize: 11, marginTop: 12, marginBottom: 0 }}>
            分享码生成于 {new Date(tokenAt).toLocaleString("zh-CN")} · 行程更新后扫码看到的是最新内容
          </Typography.Paragraph>
        )}
      </div>
    </Modal>
  );
}
