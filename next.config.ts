import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 支持用环境变量隔离构建目录（本地并行起测试实例时避免与 dev 冲突）
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // 允许局域网设备（手机/平板预览）跨源访问开发资源
  allowedDevOrigins: ["192.168.*.*"],
};

export default nextConfig;
