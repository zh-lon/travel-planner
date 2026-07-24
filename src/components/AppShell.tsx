"use client";

import "@ant-design/v5-patch-for-react-19";
import { App as AntApp, ConfigProvider, Layout, Menu } from "antd";
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
            <Menu
              mode="horizontal"
              selectedKeys={[selectedKey]}
              items={NAV_ITEMS}
              style={{ flex: 1, borderBottom: "none" }}
            />
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
