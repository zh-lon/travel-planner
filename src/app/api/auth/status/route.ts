import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { currentUser, publicUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const needSetup = (await prisma.user.count()) === 0;
  const user = needSetup ? null : await currentUser(request);
  return NextResponse.json({
    needSetup,
    authed: !!user,
    user: user ? publicUser(user) : null,
  });
}
