"use client";

import "@ant-design/v5-patch-for-react-19";
import { useEffect, useState } from "react";
import { App as AntApp, Button, ConfigProvider, Layout, Menu } from "antd";
import { LogoutOutlined } from "@ant-design/icons";
import zhCN from "antd/locale/zh_CN";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

dayjs.locale("zh-cn");

const NAV_ITEMS = [
  { key: "/", label: <Link href="/">我的行程</Link> },
  { key: "/settings", label: <Link href="/settings">设置</Link> },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const selectedKey = pathname.startsWith("/settings") ? "/settings" : "/";
  const isLogin = pathname === "/login";
  const [authInfo, setAuthInfo] = useState<{ enabled: boolean; authed: boolean }>({
    enabled: false,
    authed: false,
  });

  useEffect(() => {
    fetch("/api/auth/status")
      .then((res) => res.json())
      .then((data: { enabled?: boolean; authed?: boolean }) =>
        setAuthInfo({ enabled: !!data.enabled, authed: !!data.authed }),
      )
      .catch(() => {});
  }, [pathname]);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/login";
  };

  return (
    <ConfigProvider locale={zhCN}>
      <AntApp>
        <Layout style={{ minHeight: "100vh" }}>
          <Layout.Header
            style={{
              display: "flex",
              alignItems: "center",
              background: "#fff",
              borderBottom: "1px solid #f0f0f0",
              paddingInline: 24,
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 600, marginRight: 40, whiteSpace: "nowrap" }}>
              🧳 旅行规划
            </div>
            {!isLogin && (
              <Menu
                mode="horizontal"
                selectedKeys={[selectedKey]}
                items={NAV_ITEMS}
                style={{ flex: 1, borderBottom: "none" }}
              />
            )}
            {!isLogin && authInfo.enabled && authInfo.authed && (
              <Button type="text" size="small" icon={<LogoutOutlined />} onClick={handleLogout}>
                退出
              </Button>
            )}
          </Layout.Header>
          <Layout.Content
            style={{ maxWidth: 1200, width: "100%", margin: "0 auto", padding: 24 }}
          >
            {children}
          </Layout.Content>
        </Layout>
      </AntApp>
    </ConfigProvider>
  );
}
