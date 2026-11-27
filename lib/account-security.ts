import "server-only";
import { createHmac } from "node:crypto";
import type { NextRequest } from "next/server";
import { serviceClient } from "./server";

export const RESET_PENDING = "layers-reset-pending";
export const RESET_SESSION = "layers-reset-session";

export const recoveryCookie = {
  httpOnly: true,
  secure:
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_INSECURE_COOKIES !== "true",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 15 * 60,
};

function digest(value: string) {
  return createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY!)
    .update(value)
    .digest("hex");
}

export async function allowAccountRequest(
  req: NextRequest,
  operation: string,
  subject: string | undefined,
  limit: number,
) {
  const client = serviceClient();
  const ip = req.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
  const checks = [
    ...(subject
      ? [{ key: digest(operation + ":account:" + subject), maximum: limit }]
      : []),
    ...(ip
      ? [
          {
            key: digest(operation + ":ip:" + ip),
            maximum: Math.max(limit * 4, 24),
          },
        ]
      : []),
  ];
  for (const { key, maximum } of checks) {
    const { data, error } = await client.rpc("layer_auth_limit", {
      limit_key: key,
      maximum,
    });
    if (error) throw new Error("Could not check the request limit.");
    if (!data) return false;
  }
  return true;
}

export async function securityEvent(
  account: string,
  action: string,
  device?: string,
) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  const { error } = await serviceClient().rpc("layer_security_record", {
    account,
    action,
    fingerprint: device ? digest(device) : null,
  });
  if (error) console.warn("Could not store a security event", error.code);
}
