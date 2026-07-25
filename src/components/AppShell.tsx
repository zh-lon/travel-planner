"use client";

import "@ant-design/v5-patch-for-react-19";
import { useCallback, useEffect, useState } from "react";
import { App as AntApp, Button, ConfigProvider, Dropdown, Layout, Menu } from "antd";
import { DownOutlined, LogoutOutlined, SafetyOutlined } from "@ant-design/icons";
import zhCN from "antd/locale/zh_CN";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import SecurityModal from "@/components/SecurityModal";
import type { UserPublic } from "@/types";

dayjs.locale("zh-cn");

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isLogin = pathname === "/login";
  const selectedKey = pathname.startsWith("/admin")
    ? "/admin"
    : pathname.startsWith("/settings")
      ? "/settings"
      : "/";
  const [user, setUser] = useState<UserPublic | null>(null);
  const [securityOpen, setSecurityOpen] = useState(false);

  const refreshUser = useCallback(() => {
    fetch("/api/auth/status")
      .then((res) => res.json())
      .then((data: { authed?: boolean; user?: UserPublic | null }) =>
        setUser(data.authed && data.user ? data.user : null),
      )
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isLogin) refreshUser();
  }, [pathname, isLogin, refreshUser]);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/login";
  };

  const navItems = [
    { key: "/", label: <Link href="/">我的行程</Link> },
    ...(user?.isAdmin
      ? [
          { key: "/settings", label: <Link href="/settings">设置</Link> },
          { key: "/admin", label: <Link href="/admin">管理</Link> },
        ]
      : []),
  ];

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
                items={navItems}
                style={{ flex: 1, borderBottom: "none" }}
              />
            )}
            {!isLogin && user && (
              <Dropdown
                trigger={["click"]}
                menu={{
                  items: [
                    {
                      key: "security",
                      icon: <SafetyOutlined />,
                      label: `安全设置${user.totpEnabled ? "（两步验证已开启）" : ""}`,
                    },
                    { type: "divider" },
                    { key: "logout", icon: <LogoutOutlined />, label: "退出登录", danger: true },
                  ],
                  onClick: ({ key }) => {
                    if (key === "logout") handleLogout();
                    else if (key === "security") setSecurityOpen(true);
                  },
                }}
              >
                <Button type="text" size="small">
                  {user.displayName || user.username}
                  {user.isAdmin ? "（管理员）" : ""} <DownOutlined style={{ fontSize: 10 }} />
                </Button>
              </Dropdown>
            )}
          </Layout.Header>
          <Layout.Content
            style={{ maxWidth: 1200, width: "100%", margin: "0 auto", padding: 24 }}
          >
            {children}
          </Layout.Content>
        </Layout>
        <SecurityModal
          open={securityOpen}
          user={user}
          onCancel={() => setSecurityOpen(false)}
          onChanged={refreshUser}
        />
      </AntApp>
    </ConfigProvider>
  );
}

