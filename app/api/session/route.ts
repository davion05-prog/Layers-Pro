import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { browserSubscription } from "../../../lib/push";
import {
  allowAccountRequest,
  recoveryCookie,
  RESET_PENDING,
  RESET_SESSION,
  securityEvent,
} from "../../../lib/account-security";
import {
  appOrigin,
  configured,
  fail,
  response,
  sameOrigin,
  serviceClient,
  sessionIdentity,
  userClient,
} from "../../../lib/server";

const emailField = z.string().trim().toLowerCase().pipe(z.email());
const passwordField = z.string().min(8).max(72);
const credentials = z.object({ email: emailField, password: passwordField });

export async function GET() {
  const auth = await sessionIdentity();
  return response({
    configured: configured(),
    mfaRequired: auth?.mfaRequired ?? false,
    user:
      auth && !auth.mfaRequired
        ? { id: auth.user.id, email: auth.user.email }
        : null,
  });
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  if (!configured())
    return fail("Account access requires Supabase configuration", 503);
  const body = await req.json().catch(() => null);
  const client = await userClient();
  const jar = await cookies();
  const emailRedirectTo = new URL("/auth/confirm", appOrigin(req)).toString();
  const action = body?.action;

  async function allow(subject: string, limit: number) {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
      return fail("Account security is unavailable", 503);
    try {
      return (await allowAccountRequest(req, action, subject, limit))
        ? null
        : fail("Too many attempts. Try again in 15 minutes.", 429);
    } catch {
      return fail("Account security is temporarily unavailable.", 503);
    }
  }

  if (action === "resend" || action === "password-reset") {
    const email = emailField.safeParse(body.email);
    if (!email.success) return fail("Enter a valid email address");
    const limit = await allow(email.data, 4);
    if (limit) return limit;
    if (action === "password-reset") {
      jar.set(RESET_PENDING, "1", recoveryCookie);
      const { error } = await client.auth.resetPasswordForEmail(email.data, {
        redirectTo: emailRedirectTo,
      });
      if (error && (error.status ?? 0) >= 500)
        return fail("Email service is temporarily unavailable.", 503);
    } else {
      const { error } = await client.auth.resend({
        type: "signup",
        email: email.data,
        options: { emailRedirectTo },
      });
      if (error && (error.status ?? 0) >= 500)
        return fail("Email service is temporarily unavailable.", 503);
    }
    // A valid address receives the same response regardless of account state.
    return response({ success: true });
  }

  if (action === "logout" || action === "logout-all") {
    const auth = action === "logout-all" ? await sessionIdentity() : null;
    if (action === "logout-all" && (!auth || auth.mfaRequired))
      return fail("Log in fully before signing out all devices", 401);
    const { error } = await client.auth.signOut({
      scope: action === "logout-all" ? "global" : "local",
    });
    if (error && error.code !== "session_not_found") return fail(error.message);
    if (auth) await securityEvent(auth.user.id, "Signed out all devices");
    jar.delete(RESET_PENDING);
    jar.delete(RESET_SESSION);
    return response({ success: true });
  }

  if (action === "password-update") {
    const password = passwordField.safeParse(body.password);
    if (!password.success) return fail("Use 8 to 72 characters");
    const auth = await sessionIdentity();
    const claims = await client.auth.getClaims();
    const identity = claims.data?.claims.session_id;
    if (!auth || !identity || jar.get(RESET_SESSION)?.value !== identity)
      return fail("Request a fresh password reset link.", 401);
    if (auth.mfaRequired)
      return response(
        {
          error: "Verify your authenticator code first.",
          code: "mfa_required",
        },
        403,
      );
    const { error } = await client.auth.updateUser({ password: password.data });
    if (error) return fail(error.message, error.status || 400);
    jar.delete(RESET_SESSION);
    const { error: signOutError } = await client.auth.signOut({
      scope: "global",
    });
    if (signOutError) return response({ success: true, signOutFailed: true });
    return response({ success: true });
  }

  if (
    action === "deletion-request" ||
    action === "deletion-cancel" ||
    action === "push"
  ) {
    const payload =
      action === "push" && body.subscription ? body.subscription : null;
    if (payload && !browserSubscription.safeParse(payload).success)
      return fail("Browser push subscription is unsupported");
    const accountAction = {
      "deletion-request": "request-deletion",
      "deletion-cancel": "cancel-deletion",
      push: "push",
    }[action as "push"];
    const { error } = await client.rpc("layer_account", {
      action: accountAction,
      payload,
    });
    return error ? fail(error.message) : response({ success: true });
  }

  const parsed = credentials.safeParse(body);
  if (!parsed.success || !["login", "register"].includes(action))
    return fail(
      "Enter a valid email and a password between 8 and 72 characters",
    );
  const limit = await allow(parsed.data.email, action === "register" ? 4 : 10);
  if (limit) return limit;
  jar.delete(RESET_PENDING);
  jar.delete(RESET_SESSION);

  if (action === "register") {
    const { data: registered, error: lookupError } = await serviceClient().rpc(
      "layer_email_registered",
      { address: parsed.data.email },
    );
    if (lookupError)
      return fail("Registration is temporarily unavailable.", 503);
    if (registered) return response({ verify: true });

    const result = await client.auth.signUp({
      ...parsed.data,
      options: { emailRedirectTo },
    });
    if (
      result.error &&
      !["user_already_exists", "email_exists"].includes(result.error.code ?? "")
    ) {
      return response(
        { error: result.error.message, code: result.error.code },
        result.error.status || 400,
      );
    }
    return response({ verify: !result.data?.session });
  }

  const result = await client.auth.signInWithPassword(parsed.data);
  if (result.error)
    return response(
      { error: result.error.message, code: result.error.code },
      result.error.status || 400,
    );
  const auth = await sessionIdentity();
  if (!auth)
    return fail("Could not verify this session. Please try again.", 503);
  const device = z.uuid().safeParse(body.device);
  if (!auth.mfaRequired)
    await securityEvent(
      auth.user.id,
      "Sign-in",
      device.success ? device.data : undefined,
    );
  return response({ verify: false, mfaRequired: auth.mfaRequired });
}
