import type { NextRequest } from "next/server";
import { z } from "zod";
import { browserSubscription } from "../../../lib/push";
import {
  appOrigin,
  authenticated,
  configured,
  fail,
  response,
  sameOrigin,
  userClient,
} from "../../../lib/server";

const credentials = z.object({
  email: z.email(),
  password: z.string().min(8).max(72),
});
export async function GET() {
  const auth = await authenticated();
  return response({
    configured: configured(),
    user: auth ? { id: auth.user.id, email: auth.user.email } : null,
  });
}
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  if (!configured())
    return fail("Account access requires Supabase configuration", 503);
  const body = await req.json().catch(() => null);
  const client = await userClient();
  const emailRedirectTo = new URL("/auth/confirm", appOrigin(req)).toString();
  if (body?.action === "resend") {
    const email = z.email().safeParse(body.email);
    if (!email.success) return fail("Enter a valid email address");
    const { error } = await client.auth.resend({
      type: "signup",
      email: email.data,
      options: { emailRedirectTo },
    });
    if (error && error.code !== "user_not_found")
      return response(
        { error: error.message, code: error.code },
        error.status || 400,
      );
    return response({ success: true });
  }
  if (body?.action === "logout") {
    const { error } = await client.auth.signOut({ scope: "local" });
    return error ? fail(error.message) : response({ success: true });
  }
  if (
    body?.action === "deletion-request" ||
    body?.action === "deletion-cancel" ||
    body?.action === "push"
  ) {
    const payload =
      body.action === "push" && body.subscription ? body.subscription : null;
    if (payload) {
      const check = browserSubscription.safeParse(payload);
      if (!check.success)
        return fail("Browser push subscription is unsupported");
    }
    const action = {
      "deletion-request": "request-deletion",
      "deletion-cancel": "cancel-deletion",
      push: "push",
    }[body.action as "push"];
    const { error } = await client.rpc("layer_account", { action, payload });
    return error ? fail(error.message) : response({ success: true });
  }
  const parsed = credentials.safeParse(body);
  if (!parsed.success || !["login", "register"].includes(body?.action))
    return fail(
      "Enter a valid email and a password between 8 and 72 characters",
    );
  const result =
    body.action === "register"
      ? await client.auth.signUp({
          ...parsed.data,
          options: { emailRedirectTo },
        })
      : await client.auth.signInWithPassword(parsed.data);
  if (result.error)
    return response(
      { error: result.error.message, code: result.error.code },
      result.error.status || 400,
    );
  return response({ verify: !result.data.session });
}
