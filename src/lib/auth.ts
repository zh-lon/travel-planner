// 简单访问密码认证：设置环境变量 AUTH_PASSWORD 即启用，未设置则全站免登录。
// 使用 Web Crypto（middleware 的 edge 运行时与 Node 路由通用）。
export const AUTH_COOKIE = "lxgh_auth";

export function authEnabled(): boolean {
  return !!process.env.AUTH_PASSWORD?.trim();
}

export function authPassword(): string {
  return process.env.AUTH_PASSWORD?.trim() ?? "";
}

// 签名密钥由访问密码派生：改密码即令所有已发 Cookie 失效
async function signingKey(): Promise<CryptoKey> {
  const secret = `lxgh-auth-v1:${authPassword()}`;
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function sign(data: string): Promise<string> {
  const key = await signingKey();
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function createToken(days = 30): Promise<string> {
  const exp = Date.now() + days * 86400000;
  return `${exp}.${await sign(String(exp))}`;
}

export async function verifyToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expStr = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = await sign(expStr);
  return sig.length === expected.length && sig === expected;
}
