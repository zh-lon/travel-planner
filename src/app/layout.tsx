import "@/lib/dayjs-init";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import AppShell from "@/components/AppShell";
import { HeaderProvider } from "@/lib/header-context";
import "./globals.css";

export const metadata: Metadata = {
  title: "旅行规划",
  description: "本地运行的旅行规划工具：行程编排、地图路线、预算开销、AI 生成",
  viewport: {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    viewportFit: "cover",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <AntdRegistry>
          <HeaderProvider>
            <AppShell>{children}</AppShell>
          </HeaderProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
