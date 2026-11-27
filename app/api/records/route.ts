import type { NextRequest } from "next/server";
import { z } from "zod";
import { operationSchema, type Operation } from "../../../lib/model";
import { authenticated, fail, response, sameOrigin, serviceClient, withReferences } from "../../../lib/server";

function validTransfers(operations: Operation[]) {
  const pairs = new Map<string, Operation[]>();
  for (const op of operations) {
    const transfer = op.row.type === "movement" ? op.row.data.transfer : undefined;
    if (Boolean(transfer) !== Boolean(op.group)) return false;
    if (op.group) pairs.set(op.group, [...(pairs.get(op.group) ?? []), op]);
  }
  return [...pairs.values()].every(group => {
    if (group.length !== 2) return false;
    const [a, b] = group.map(op => op.row);
    return a.type === "movement" && b.type === "movement" && a.id !== b.id &&
      a.data.transfer === b.data.transfer && a.data.flock !== b.data.flock && a.data.count === b.data.count &&
      a.date === b.date && [a.data.kind, b.data.kind].includes("Transfer out") && [a.data.kind, b.data.kind].includes("Transfer in");
  });
}

export async function GET() {
  const auth = await authenticated();
  if (!auth) return fail("Sign in to sync this workspace", 401);
  const { data, error } = await auth.client.rpc("layer_snapshot");
  if (error) return fail(error.message, 403);
  return response(withReferences(data));
}
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Invalid request origin", 403);
  const auth = await authenticated();
  if (!auth) return fail("Sign in to sync this workspace", 401);
  const body = z.object({ ops: z.array(operationSchema).min(1).max(100) }).safeParse(await req.json().catch(() => null));
  if (!body.success) return fail(body.error.issues[0]?.message || "Invalid records");
  if (!validTransfers(body.data.ops)) return fail("A flock transfer requires matching outgoing and incoming records", 422);
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return fail("Server sync is missing the Supabase service key", 503);
  const { data, error } = await serviceClient().rpc("layer_sync_for", { account: auth.user.id, ops: body.data.ops });
  if (error) return fail(error.message, 422);
  return response(withReferences(data));
}
