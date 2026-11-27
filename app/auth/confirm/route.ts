import { NextRequest, NextResponse } from "next/server";
import { appOrigin, configured, userClient } from "../../../lib/server";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const hash = searchParams.get("token_hash");
  const origin = appOrigin(req);
  const login = new URL("/login", origin);
  const headers = {
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
  };

  if (configured() && (code || hash)) {
    const client = await userClient();
    const result = hash
      ? await client.auth.verifyOtp({ token_hash: hash, type: "email" })
      : await client.auth.exchangeCodeForSession(code!);
    if (!result.error && result.data.session) {
      return NextResponse.redirect(new URL("/", origin), { headers });
    }
  }

  const failed = Boolean(code || hash || searchParams.has("error"));
  login.searchParams.set("confirmation", failed ? "failed" : "continue");
  return NextResponse.redirect(login, { headers });
}
