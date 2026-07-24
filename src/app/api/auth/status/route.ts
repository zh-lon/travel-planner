import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, authEnabled, verifyToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const enabled = authEnabled();
  const authed = enabled
    ? await verifyToken(request.cookies.get(AUTH_COOKIE)?.value)
    : true;
  return NextResponse.json({ enabled, authed });
}
