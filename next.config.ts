import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 支持用环境变量隔离构建目录（本地并行起测试实例时避免与 dev 冲突）
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
