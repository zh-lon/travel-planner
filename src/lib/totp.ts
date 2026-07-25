// TOTP 两步验证（RFC 6238，SHA1/6位/30秒，与主流验证器 App 兼容），纯 Node crypto 实现
import { createHmac, randomBytes } from "crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

// 生成 20 字节随机密钥的 base32 编码（无填充）
export function generateTotpSecret(): string {
  const bytes = randomBytes(20);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(buf).digest();
  const offset = digest[digest.length - 1] & 0xf;
  const code =
    (((digest[offset] & 0x7f) << 24) |
      (digest[offset + 1] << 16) |
      (digest[offset + 2] << 8) |
      digest[offset + 3]) %
    1000000;
  return String(code).padStart(6, "0");
}

// 校验 6 位验证码，允许 ±1 个时间窗（30 秒）的时钟偏差
export function verifyTotp(secretBase32: string, code: string, window = 1): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const secret = base32Decode(secretBase32);
  if (secret.length === 0) return false;
  const step = Math.floor(Date.now() / 30000);
  for (let i = -window; i <= window; i++) {
    if (hotp(secret, step + i) === code) return true;
  }
  return false;
}

// 生成验证器 App 扫码用的 otpauth:// 链接
export function otpauthUri(username: string, secretBase32: string): string {
  const issuer = encodeURIComponent("旅行规划");
  return `otpauth://totp/${issuer}:${encodeURIComponent(username)}?secret=${secretBase32}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}
