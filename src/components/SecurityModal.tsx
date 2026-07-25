"use client";

import { useEffect, useState } from "react";
import { Alert, App, Button, Input, Modal, Space, Spin, Tag, Typography } from "antd";
import { SafetyOutlined } from "@ant-design/icons";
import QRCode from "qrcode";
import type { UserPublic } from "@/types";

interface Props {
  open: boolean;
  user: UserPublic | null;
  onCancel: () => void;
  onChanged: () => void; // 开关状态变化后刷新用户信息
}

type Phase = "info" | "binding";

// 账户安全设置：两步验证（TOTP）开关，可选功能
export default function SecurityModal({ open, user, onCancel, onChanged }: Props) {
  const { message } = App.useApp();
  const [phase, setPhase] = useState<Phase>("info");
  const [loading, setLoading] = useState(false);
  const [setup, setSetup] = useState<{ secret: string; uri: string; qr: string } | null>(null);
  const [code, setCode] = useState("");

  useEffect(() => {
    if (!open) {
      setPhase("info");
      setSetup(null);
      setCode("");
    }
  }, [open]);

  const startBinding = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/totp/setup", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        secret?: string;
        uri?: string;
        error?: string;
      };
      if (!res.ok || !data.secret || !data.uri) throw new Error(data.error);
      const qr = await QRCode.toDataURL(data.uri, { width: 200, margin: 1 });
      setSetup({ secret: data.secret, uri: data.uri, qr });
      setCode("");
      setPhase("binding");
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : "生成失败");
    } finally {
      setLoading(false);
    }
  };

  const confirmEnable = async (value: string) => {
    if (!/^\d{6}$/.test(value)) return;
    setLoading(true);
    try {
      const res = await fetch("/api/auth/totp/enable", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: value }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error);
      message.success("两步验证已开启");
      setPhase("info");
      onChanged();
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : "验证失败");
      setCode("");
    } finally {
      setLoading(false);
    }
  };

  const disable = async (value: string) => {
    if (!/^\d{6}$/.test(value)) return;
    setLoading(true);
    try {
      const res = await fetch("/api/auth/totp/disable", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: value }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error);
      message.success("两步验证已关闭");
      setCode("");
      onChanged();
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : "操作失败");
      setCode("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={
        <span>
          <SafetyOutlined style={{ color: "#52c41a", marginRight: 8 }} />
          安全设置
        </span>
      }
      open={open}
      onCancel={onCancel}
      footer={null}
      width={480}
    >
      {phase === "info" && (
        <Space direction="vertical" size="middle" style={{ display: "flex" }}>
          <div>
            <Typography.Text strong>两步验证（可选）</Typography.Text>{" "}
            {user?.totpEnabled ? <Tag color="success">已开启</Tag> : <Tag>未开启</Tag>}
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
              开启后，登录除密码外还需输入手机验证器 App（Google Authenticator、Microsoft
              Authenticator、1Password 等）生成的 6 位动态码，可有效防止密码泄露导致的账号被盗。
            </Typography.Paragraph>
          </div>

          {!user?.totpEnabled ? (
            <Button type="primary" loading={loading} onClick={startBinding}>
              开启两步验证
            </Button>
          ) : (
            <Space direction="vertical" size="small" style={{ display: "flex" }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                输入当前动态码以关闭两步验证：
              </Typography.Text>
              <Space>
                <Input.OTP
                  length={6}
                  value={code}
                  onChange={(v) => {
                    setCode(v);
                    if (v.length === 6) disable(v);
                  }}
                />
                <Button danger loading={loading} onClick={() => disable(code)}>
                  关闭
                </Button>
              </Space>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                验证器丢失时，可请管理员在「管理」页为你解除两步验证。
              </Typography.Text>
            </Space>
          )}
        </Space>
      )}

      {phase === "binding" && setup && (
        <Space direction="vertical" size="middle" style={{ display: "flex" }}>
          <Alert
            type="info"
            showIcon
            message="第 1 步：用验证器 App 扫描二维码"
            description="Google Authenticator / Microsoft Authenticator / 1Password 等均可。无法扫码时可手动输入下方密钥。"
          />
          <div style={{ textAlign: "center" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qr} alt="TOTP 绑定二维码" width={200} height={200} />
            <Typography.Paragraph copyable={{ text: setup.secret }} style={{ fontSize: 12 }}>
              <Typography.Text type="secondary">密钥：</Typography.Text>
              <Typography.Text code>{setup.secret}</Typography.Text>
            </Typography.Paragraph>
          </div>
          <Alert type="info" showIcon message="第 2 步：输入 App 显示的 6 位动态码完成绑定" />
          <div style={{ display: "flex", justifyContent: "center" }}>
            <Input.OTP
              length={6}
              autoFocus
              value={code}
              onChange={(v) => {
                setCode(v);
                if (v.length === 6) confirmEnable(v);
              }}
            />
          </div>
          <Space style={{ justifyContent: "center", display: "flex" }}>
            <Button onClick={() => setPhase("info")}>取消</Button>
            <Button type="primary" loading={loading} onClick={() => confirmEnable(code)}>
              确认开启
            </Button>
          </Space>
        </Space>
      )}
    </Modal>
  );
}
