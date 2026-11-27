import { NextRequest, NextResponse } from "next/server";
import { configured, userClient } from "../../../lib/server";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const hash = req.nextUrl.searchParams.get("token_hash");
  if (configured() && (code || hash)) {
    const client = await userClient();
    const { error } = code
      ? await client.auth.exchangeCodeForSession(code)
      : await client.auth.verifyOtp({ token_hash: hash!, type: "email" });
    if (!error) return NextResponse.redirect(new URL("/", req.url));
  }
  return NextResponse.redirect(new URL("/?auth=confirmation-failed", req.url));
}
