"use client";

import { useState } from "react";
import { App, Button, Card, Form, Input, Typography } from "antd";
import { LockOutlined } from "@ant-design/icons";

export default function LoginPage() {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);

  const handleLogin = async (values: { password?: string }) => {
    const password = values.password ?? "";
    if (!password) return;
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        message.error(data.error ?? "登录失败");
        return;
      }
      const from = new URLSearchParams(window.location.search).get("from");
      window.location.href = from && from.startsWith("/") && !from.startsWith("//") ? from : "/";
    } catch {
      message.error("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", justifyContent: "center", paddingTop: 80 }}>
      <Card style={{ width: 360 }}>
        <Typography.Title level={4} style={{ textAlign: "center", marginTop: 0 }}>
          🧳 旅行规划
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ textAlign: "center" }}>
          请输入访问密码
        </Typography.Paragraph>
        <Form onFinish={handleLogin}>
          <Form.Item name="password" rules={[{ required: true, message: "请输入密码" }]}>
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="访问密码"
              size="large"
              autoFocus
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" block size="large" loading={loading}>
            进入
          </Button>
        </Form>
      </Card>
    </div>
  );
}
