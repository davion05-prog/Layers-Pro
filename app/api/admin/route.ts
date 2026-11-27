import { z } from "zod";
import type { NextRequest } from "next/server";
import { defaultReferences } from "../../../lib/model";
import { authenticated, fail, response, sameOrigin, serviceClient } from "../../../lib/server";

async function admin() {
  const auth = await authenticated();
  if (!auth || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const client = serviceClient();
  const { data } = await client.from("layer_admins").select("owner").eq("owner", auth.user.id).maybeSingle();
  const { data: active } = await auth.client.rpc("layer_active");
  return data && active ? { client, actor: auth.user.id } : null;
}

const name = z.string().trim().min(1).max(120);
const refsSchema = z.object({
  breeds: z.array(name).min(1).max(100),
  feed: z.array(z.object({ name, week: z.number().int().min(0).max(150) })).min(1).max(12)
    .refine(rows => rows[0].week === 0 && rows.every((r, i) => i === 0 || r.week > rows[i - 1].week), "Feed stages must start at week 0 and use increasing weeks"),
  vaccines: z.array(z.object({ name, day: z.number().int().min(0).max(730), through: z.number().int().min(0).max(730).optional(), repeat: z.number().int().min(7).max(730).optional() }).refine(v => !v.through || v.through >= v.day)).max(100),
});

export async function GET(req: NextRequest) {
  const access = await admin();
  if (!access) return fail("Administrator access is required", 403);
  const { client } = access;
  const search = (req.nextUrl.searchParams.get("q") || "").trim().toLowerCase().slice(0, 254);
  const [stats, references, audit] = await Promise.all([
    client.rpc("layer_stats"),
    client.from("layer_references").select("key,value"),
    client.from("layer_admin_audit").select("action,target,created_at").order("created_at", { ascending: false }).limit(25),
  ]);
  if (stats.error || references.error || audit.error) return fail("Could not load administrative data", 500);
  const matches: { id: string; email: string | undefined; created_at: string }[] = [];
  if (search) {
    let page = 1;
    while (matches.length < 30) {
      const { data, error } = await client.auth.admin.listUsers({ page, perPage: 200 });
      if (error) return fail("Could not search accounts", 500);
      for (const user of data.users) {
        if (user.id === search || user.email?.toLowerCase().includes(search)) matches.push({ id: user.id, email: user.email, created_at: user.created_at });
      }
      if (data.users.length < 200) break;
      page++;
    }
  }
  const found = matches.slice(0, 30);
  const states = found.length ? await client.from("layer_accounts").select("owner,suspended,deletion_at").in("owner", found.map(u => u.id)) : { data: [], error: null };
  if (states.error) return fail("Could not load account status", 500);
  return response({ stats: stats.data, accounts: found.map(u => ({ ...u, ...states.data.find(s => s.owner === u.id) })),
    references: { ...defaultReferences, ...Object.fromEntries(references.data.map(r => [r.key, r.value])) }, audit: audit.data });
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const access = await admin();
  if (!access) return fail("Administrator access is required", 403);
  const body = z.discriminatedUnion("action", [
    z.object({ action: z.enum(["suspend", "reactivate"]), account: z.uuid() }),
    z.object({ action: z.literal("references"), data: refsSchema }),
  ]).safeParse(await req.json().catch(() => null));
  if (!body.success) return fail(body.error.issues[0]?.message || "Invalid administrative action");
  const { client, actor } = access;
  const incoming = body.data;
  if (incoming.action === "references") {
    const { error } = await client.rpc("layer_reference_update", { actor_id: actor, values_json: incoming.data });
    return error ? fail("Could not update reference data", 500) : response({ success: true });
  }
  if (incoming.account === actor) return fail("You cannot suspend or reactivate your own account");
  const target = await client.auth.admin.getUserById(incoming.account);
  if (target.error || !target.data.user) return fail("Account unavailable", 404);
  const { error } = await client.rpc("layer_admin_update", { actor_id: actor, account_id: incoming.account, suspend: incoming.action === "suspend" });
  return error ? fail("Could not update account status", 500) : response({ success: true });
}
