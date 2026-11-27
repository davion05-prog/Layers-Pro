import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { appOrigin, configured, userClient } from "../../../lib/server";
import {
  recoveryCookie,
  RESET_PENDING,
  RESET_SESSION,
} from "../../../lib/account-security";

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
  const jar = await cookies();
  const recovery =
    searchParams.get("type") === "recovery" ||
    (!hash && jar.has(RESET_PENDING));

  if (configured() && (code || hash)) {
    const client = await userClient();
    const exchanged =
      !hash && code ? await client.auth.exchangeCodeForSession(code) : null;
    const result = hash
      ? await client.auth.verifyOtp({
          token_hash: hash,
          type: recovery ? "recovery" : "email",
        })
      : exchanged;
    if (result && !result.error && result.data.session) {
      const isRecoveryLink = hash
        ? recovery
        : Boolean(
            exchanged &&
            "redirectType" in exchanged.data &&
            exchanged.data.redirectType === "recovery",
          );
      if (isRecoveryLink) {
        const claims = await client.auth.getClaims();
        const sessionId = claims.data?.claims.session_id;
        jar.delete(RESET_PENDING);
        if (typeof sessionId === "string") {
          jar.set(RESET_SESSION, sessionId, recoveryCookie);
          return NextResponse.redirect(new URL("/reset-password", origin), {
            headers,
          });
        }
      } else {
        return NextResponse.redirect(new URL("/", origin), { headers });
      }
    }
  }

  if (recovery) {
    jar.delete(RESET_PENDING);
    return NextResponse.redirect(
      new URL("/forgot-password?expired=1", origin),
      { headers },
    );
  }
  const failed = Boolean(code || hash || searchParams.has("error"));
  login.searchParams.set("confirmation", failed ? "failed" : "continue");
  return NextResponse.redirect(login, { headers });
}
