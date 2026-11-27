import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import {
  allowAccountRequest,
  recoveryCookie,
  RESET_SESSION,
  securityEvent,
} from "../../../lib/account-security";
import {
  authenticated,
  fail,
  response,
  sameOrigin,
  sessionIdentity,
} from "../../../lib/server";

export async function GET() {
  const auth = await authenticated();
  if (!auth) return fail("Log in to view account security", 401);
  const [events, factors] = await Promise.all([
    auth.client
      .from("layer_security_events")
      .select("id,event,occurred_at")
      .eq("owner", auth.user.id)
      .order("occurred_at", { ascending: false })
      .limit(30),
    auth.client.auth.mfa.listFactors(),
  ]);
  if (events.error || factors.error)
    return fail("Could not load account security", 503);
  return response({
    events: events.data,
    enabled: factors.data.totp.length > 0,
  });
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const auth = await sessionIdentity();
  if (!auth) return fail("Log in to manage account security", 401);
  const body = await req.json().catch(() => null);
  const action = body?.action;
  const { client } = auth;
  if (!["enroll", "verify", "cancel", "remove"].includes(action))
    return fail("Invalid security action");
  if (auth.mfaRequired && action !== "verify")
    return fail("Verify your authenticator first", 403);
  try {
    if (!(await allowAccountRequest(req, "mfa:" + action, auth.user.id, 10)))
      return fail("Too many attempts. Try again in 15 minutes.", 429);
  } catch {
    return fail("Account security is temporarily unavailable", 503);
  }
  const { data: factors, error: listError } =
    await client.auth.mfa.listFactors();
  if (listError) return fail("Could not check authenticator settings", 503);
  if (action === "enroll") {
    if (factors.totp.length)
      return fail("This account already has an authenticator.");
    for (const pending of factors.all.filter(
      (f) => f.status === "unverified" && f.factor_type === "totp",
    )) {
      await client.auth.mfa.unenroll({ factorId: pending.id });
    }
    const { data, error } = await client.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Layers Pro",
    });
    return error
      ? fail(error.message)
      : response({ id: data.id, qr: data.totp.qr_code, key: data.totp.secret });
  }
  const factorId = z.uuid().safeParse(body.factor);
  const factor = factorId.success
    ? factors.all.find(
        (f) => f.id === factorId.data && f.factor_type === "totp",
      )
    : factors.totp[0];
  if (!factor) return fail("Authenticator is unavailable");
  if (action === "cancel" || action === "remove") {
    if (action === "cancel" && factor.status !== "unverified")
      return fail("Only pending setup can be cancelled");
    if (action === "remove" && auth.assurance !== "aal2")
      return fail("Verify your authenticator before removing it", 403);
    const { error } = await client.auth.mfa.unenroll({ factorId: factor.id });
    if (error) return fail(error.message);
    if (action === "remove")
      await securityEvent(auth.user.id, "Authenticator removed");
    return response({ success: true });
  }
  if (auth.mfaRequired && factor.status !== "verified")
    return fail("Verify your existing authenticator", 403);
  const code = z
    .string()
    .regex(/^\d{6}$/)
    .safeParse(body.code);
  if (!code.success) return fail("Enter the six-digit authenticator code");
  const jar = await cookies();
  const before = await client.auth.getClaims();
  const wasRecovering =
    before.data?.claims.session_id === jar.get(RESET_SESSION)?.value &&
    jar.has(RESET_SESSION);
  const { error } = await client.auth.mfa.challengeAndVerify({
    factorId: factor.id,
    code: code.data,
  });
  if (error)
    return fail(
      "That code could not be verified. Enter the latest code.",
      error.status || 400,
    );
  if (wasRecovering) {
    const after = await client.auth.getClaims();
    if (typeof after.data?.claims.session_id === "string")
      jar.set(RESET_SESSION, after.data.claims.session_id, recoveryCookie);
  }
  const device = z.uuid().safeParse(body.device);
  await securityEvent(
    auth.user.id,
    factor.status === "unverified" ? "Authenticator enabled" : "Sign-in",
    device.success ? device.data : undefined,
  );
  return response({ success: true });
}
