"use client";

import { useEffect, useState } from "react";
import { App, Button, Card, Form, Input, Spin, Typography } from "antd";
import { LockOutlined, UserOutlined } from "@ant-design/icons";

type Mode = "loading" | "login" | "setup" | "totp";

export default function LoginPage() {
  const { message } = App.useApp();
  const [mode, setMode] = useState<Mode>("loading");
  const [loading, setLoading] = useState(false);
  const [preToken, setPreToken] = useState("");
  const [otpCode, setOtpCode] = useState("");

  useEffect(() => {
    fetch("/api/auth/status")
      .then((res) => res.json())
      .then((data: { needSetup?: boolean; authed?: boolean }) => {
        if (data.authed) {
          window.location.href = "/";
          return;
        }
        setMode(data.needSetup ? "setup" : "login");
      })
      .catch(() => setMode("login"));
  }, []);

  const redirectAfterAuth = () => {
    const from = new URLSearchParams(window.location.search).get("from");
    window.location.href = from && from.startsWith("/") && !from.startsWith("//") ? from : "/";
  };

  const handleLogin = async (values: { username?: string; password?: string }) => {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: values.username, password: values.password }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        need2fa?: boolean;
        preToken?: string;
        error?: string;
      };
      if (data.need2fa && data.preToken) {
        setPreToken(data.preToken);
        setOtpCode("");
        setMode("totp");
        return;
      }
      if (!res.ok || !data.ok) {
        message.error(data.error ?? "登录失败");
        return;
      }
      redirectAfterAuth();
    } catch {
      message.error("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  };

  const handleTotp = async (code: string) => {
    if (!/^\d{6}$/.test(code)) return;
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login-2fa", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ preToken, code }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        message.error(data.error ?? "验证失败");
        setOtpCode("");
        if (res.status === 401 && (data.error ?? "").includes("过期")) setMode("login");
        return;
      }
      redirectAfterAuth();
    } catch {
      message.error("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  };

  const handleSetup = async (values: {
    username?: string;
    displayName?: string;
    password?: string;
  }) => {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: values.username,
          displayName: values.displayName,
          password: values.password,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        message.error(data.error ?? "初始化失败");
        return;
      }
      message.success("管理员账号已创建");
      redirectAfterAuth();
    } catch {
      message.error("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", justifyContent: "center", paddingTop: 80 }}>
      <Card style={{ width: 380 }}>
        <Typography.Title level={4} style={{ textAlign: "center", marginTop: 0 }}>
          🧳 旅行规划
        </Typography.Title>

        {mode === "loading" && (
          <div style={{ textAlign: "center", padding: 32 }}>
            <Spin />
          </div>
        )}

        {mode === "login" && (
          <>
            <Typography.Paragraph type="secondary" style={{ textAlign: "center" }}>
              请登录（账号由管理员创建）
            </Typography.Paragraph>
            <Form onFinish={handleLogin}>
              <Form.Item name="username" rules={[{ required: true, message: "请输入用户名" }]}>
                <Input prefix={<UserOutlined />} placeholder="用户名" size="large" autoFocus />
              </Form.Item>
              <Form.Item name="password" rules={[{ required: true, message: "请输入密码" }]}>
                <Input.Password prefix={<LockOutlined />} placeholder="密码" size="large" />
              </Form.Item>
              <Button type="primary" htmlType="submit" block size="large" loading={loading}>
                登录
              </Button>
            </Form>
          </>
        )}

        {mode === "totp" && (
          <>
            <Typography.Paragraph type="secondary" style={{ textAlign: "center" }}>
              两步验证：请输入验证器 App 中的 6 位动态码
            </Typography.Paragraph>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
              <Input.OTP
                length={6}
                autoFocus
                value={otpCode}
                onChange={(v) => {
                  setOtpCode(v);
                  if (v.length === 6) handleTotp(v);
                }}
              />
            </div>
            <Button
              type="primary"
              block
              size="large"
              loading={loading}
              onClick={() => handleTotp(otpCode)}
            >
              验证并登录
            </Button>
            <Button type="link" block onClick={() => setMode("login")}>
              返回重新输入密码
            </Button>
          </>
        )}

        {mode === "setup" && (
          <>
            <Typography.Paragraph type="secondary" style={{ textAlign: "center" }}>
              首次使用：创建管理员账号
              <br />
              （已有的行程数据会自动归属到该账号）
            </Typography.Paragraph>
            <Form onFinish={handleSetup}>
              <Form.Item
                name="username"
                rules={[
                  { required: true, message: "请输入用户名" },
                  { pattern: /^[a-zA-Z0-9_-]{2,32}$/, message: "2~32 位字母/数字/下划线/短横线" },
                ]}
              >
                <Input prefix={<UserOutlined />} placeholder="管理员用户名" size="large" autoFocus />
              </Form.Item>
              <Form.Item name="displayName">
                <Input placeholder="昵称（选填）" size="large" maxLength={20} />
              </Form.Item>
              <Form.Item
                name="password"
                rules={[
                  { required: true, message: "请输入密码" },
                  { min: 6, message: "密码至少 6 位" },
                ]}
              >
                <Input.Password prefix={<LockOutlined />} placeholder="密码（至少 6 位）" size="large" />
              </Form.Item>
              <Form.Item
                name="confirm"
                dependencies={["password"]}
                rules={[
                  { required: true, message: "请再次输入密码" },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      return !value || getFieldValue("password") === value
                        ? Promise.resolve()
                        : Promise.reject(new Error("两次输入的密码不一致"));
                    },
                  }),
                ]}
              >
                <Input.Password prefix={<LockOutlined />} placeholder="确认密码" size="large" />
              </Form.Item>
              <Button type="primary" htmlType="submit" block size="large" loading={loading}>
                创建并进入
              </Button>
            </Form>
          </>
        )}
      </Card>
    </div>
  );
}
