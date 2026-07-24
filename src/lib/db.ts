import { PrismaClient } from "@prisma/client";

// dev 模式热更新时复用同一个客户端，避免连接数膨胀
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
