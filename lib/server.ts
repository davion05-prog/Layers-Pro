import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { defaultReferences, type Snapshot } from "./model";

export const configured = () => Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
export async function userClient() {
  const jar = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" && process.env.ALLOW_INSECURE_COOKIES !== "true", path: "/" },
    cookies: {
      getAll: () => jar.getAll(),
      setAll: values => { for (const { name, value, options } of values) jar.set(name, value, options); },
    },
  });
}
export function serviceClient() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase service key");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
export function sameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  const expected = process.env.APP_ORIGIN || req.nextUrl.origin;
  return !origin || origin === expected;
}
export const response = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
export const fail = (error: string, status = 400) => response({ error }, status);
export async function authenticated() {
  if (!configured()) return null;
  const client = await userClient();
  const { data } = await client.auth.getUser();
  return data.user ? { client, user: data.user } : null;
}
export function withReferences(data: Snapshot): Snapshot {
  return { ...data, references: { ...defaultReferences, ...data.references } };
}
