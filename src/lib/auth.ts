// 会话令牌签发/校验（Web Crypto，middleware 的 edge 运行时与 Node 路由通用）。
// 注意：本文件不得引入 prisma（middleware 无法访问数据库）。
export const AUTH_COOKIE = "lxgh_session";

function secret(): string {
  // 部署时务必设置 AUTH_SECRET（随机长字符串）；未设置时使用开发默认值
  return process.env.AUTH_SECRET?.trim() || "lxgh-dev-secret-change-me";
}

async function signingKey(): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`lxgh-auth-v2:${secret()}`),
  );
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function sign(data: string): Promise<string> {
  const key = await signingKey();
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// 令牌格式：userId.过期时间戳.签名
export async function createToken(userId: string, days = 30): Promise<string> {
  const exp = Date.now() + days * 86400000;
  return `${userId}.${exp}.${await sign(`${userId}.${exp}`)}`;
}

export async function parseToken(token: string | undefined): Promise<{ userId: string } | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!userId || !Number.isFinite(exp) || exp < Date.now()) return null;
  const expected = await sign(`${userId}.${expStr}`);
  if (sig.length !== expected.length || sig !== expected) return null;
  return { userId };
}

// 从 Cookie 头解析令牌
export function tokenFromCookieHeader(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === AUTH_COOKIE) return rest.join("=");
  }
  return undefined;
}

// ---- 两步验证的预认证令牌：密码校验通过但还差验证码时签发，5 分钟有效 ----
// 格式：2fa.userId.过期时间戳.签名
export async function createPreAuthToken(userId: string): Promise<string> {
  const exp = Date.now() + 5 * 60000;
  return `2fa.${userId}.${exp}.${await sign(`2fa.${userId}.${exp}`)}`;
}

export async function parsePreAuthToken(token: string | undefined): Promise<{ userId: string } | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "2fa") return null;
  const [, userId, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!userId || !Number.isFinite(exp) || exp < Date.now()) return null;
  const expected = await sign(`2fa.${userId}.${expStr}`);
  if (sig.length !== expected.length || sig !== expected) return null;
  return { userId };
}
