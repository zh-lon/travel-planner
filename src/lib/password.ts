// 密码哈希（Node scrypt，无外部依赖）
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  try {
    const computed = scryptSync(password, salt, 32);
    const expected = Buffer.from(hash, "hex");
    return computed.length === expected.length && timingSafeEqual(computed, expected);
  } catch {
    return false;
  }
}
