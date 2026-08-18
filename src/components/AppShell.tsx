"use client";

import "@ant-design/v5-patch-for-react-19";
import "@/lib/dayjs-init";
import { useCallback, useEffect, useRef, useState } from "react";
import { App as AntApp, Button, ConfigProvider, Dropdown, Layout } from "antd";
import { AppstoreOutlined, DownOutlined, HomeOutlined, LogoutOutlined, SafetyOutlined, SettingOutlined } from "@ant-design/icons";
import zhCN from "antd/locale/zh_CN";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import SecurityModal from "@/components/SecurityModal";
import { useHeaderContent } from "@/lib/header-context";
import type { UserPublic } from "@/types";

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname === "/login";
  const isTripDetail = pathname.startsWith("/trips/") && pathname.split("/").length >= 3;
  const selectedKey = pathname.startsWith("/admin")
    ? "/admin"
    : pathname.startsWith("/settings")
      ? "/settings"
      : "/";
  const [user, setUser] = useState<UserPublic | null>(null);
  const [securityOpen, setSecurityOpen] = useState(false);
  const { headerContent } = useHeaderContent();

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

  // 修复 TimePicker 时间列滚轮直接滚到顶/底的问题
  const wheelFixRef = useRef<((e: WheelEvent) => void) | null>(null);
  useEffect(() => {
    const ROW_HEIGHT = 28; // 每个时间选项的高度
    const handler = (e: WheelEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // 找到时间列容器
      const column = target.closest?.('.ant-picker-time-panel-column') as HTMLElement | null;
      if (!column) return;
      const ul = column.querySelector('ul');
      if (!ul) return;

      e.preventDefault();
      e.stopPropagation();

      // 用固定步长滚动，避免 deltaY 过大导致直接跳到底
      const step = e.deltaY > 0 ? ROW_HEIGHT : -ROW_HEIGHT;
      ul.scrollTop = Math.max(0, Math.min(ul.scrollTop + step, ul.scrollHeight - ul.clientHeight));
    };
    wheelFixRef.current = handler;
    document.addEventListener('wheel', handler, { passive: false });
    return () => {
      if (wheelFixRef.current) {
        document.removeEventListener('wheel', wheelFixRef.current);
      }
    };
  }, []);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/login";
  };

  const isHome = pathname === "/";

  const navDropdownItems = [
    ...(!isHome
      ? [{ key: "/", icon: <HomeOutlined />, label: "首页" }]
      : []),
    { key: "/trips", icon: <HomeOutlined />, label: "我的行程" },
    ...(user?.isAdmin
      ? [
          { key: "/settings", icon: <SettingOutlined />, label: "设置" },
          { key: "/admin", icon: <AppstoreOutlined />, label: "管理" },
        ]
      : []),
  ];

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: "#0d9488",
          colorInfo: "#0d9488",
          borderRadius: 8,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif',
        },
      }}
    >
      <AntApp>
        <Layout style={{ minHeight: "100vh", background: "#eef4f5" }}>
          <Layout.Header
            style={{
              display: "flex",
              alignItems: "center",
              background: "rgba(255, 255, 255, 0.85)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              borderBottom: "1px solid rgba(0, 0, 0, 0.06)",
              paddingInline: 16,
              position: "sticky",
              top: 0,
              zIndex: 100,
              height: isTripDetail ? 56 : 48,
              lineHeight: isTripDetail ? "56px" : "48px",
              boxShadow: "0 1px 8px rgba(0, 0, 0, 0.04)",
            }}
          >
            {/* 左侧：Logo（点击展开导航菜单） */}
            {!isLogin && navDropdownItems.length > 0 ? (
              <Dropdown
                trigger={["click"]}
                menu={{
                  items: navDropdownItems,
                  selectedKeys: [selectedKey],
                  onClick: ({ key }) => {
                    if (key === "/") router.push("/");
                    else if (key === "/trips") router.push("/");
                    else if (key === "/settings") router.push("/settings");
                    else if (key === "/admin") router.push("/admin");
                  },
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 2, cursor: "pointer", flexShrink: 0 }}>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 32,
                      height: 32,
                      borderRadius: 7,
                      background: "linear-gradient(135deg, #0d9488, #0891b2)",
                      fontSize: 18,
                      boxShadow: "0 2px 8px rgba(13, 148, 136, 0.3)",
                    }}
                  >
                    🧳
                  </span>
                  <DownOutlined style={{ fontSize: 10, color: "#999" }} />
                </span>
              </Dropdown>
            ) : (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 32,
                  height: 32,
                  borderRadius: 7,
                  background: "linear-gradient(135deg, #0d9488, #0891b2)",
                  fontSize: 18,
                  boxShadow: "0 2px 8px rgba(13, 148, 136, 0.3)",
                  flexShrink: 0,
                }}
              >
                🧳
              </span>
            )}

            {/* 中间：页面自定义头部内容 */}
            {!isLogin && headerContent && (
              <div style={{ flex: 1, minWidth: 0, marginLeft: 10 }}>
                {headerContent}
              </div>
            )}

            {/* 右侧：用户 */}
            {!isLogin && user && (
              <div style={{ marginLeft: "auto", flexShrink: 0 }}>
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
                <Button
                  type="text"
                  size="middle"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    height: 36,
                    padding: "0 8px",
                    borderRadius: 8,
                    flexShrink: 0,
                    marginLeft: 8,
                  }}
                >
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 30,
                      height: 30,
                      borderRadius: 7,
                      background: "linear-gradient(135deg, #0d9488, #0891b2)",
                      color: "#fff",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {(user.displayName || user.username).slice(0, 1).toUpperCase()}
                  </span>
                  <DownOutlined style={{ fontSize: 10, color: "#999" }} />
                </Button>
              </Dropdown>
              </div>
            )}
          </Layout.Header>
          <Layout.Content style={{ width: "100%", margin: "0 auto", padding: isTripDetail ? "12px" : "16px" }}>
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

