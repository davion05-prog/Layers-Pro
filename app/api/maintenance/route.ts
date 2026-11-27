import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import webpush from "web-push";
import { addDays, dateLabel, dayNow, defaultReferences, fmt, inventory, rowsOf, scheduleRows, type Farm, type Row } from "../../../lib/model";
import { browserSubscription } from "../../../lib/push";
import { fail, response, serviceClient } from "../../../lib/server";

export const runtime = "nodejs";
export const maxDuration = 60;
const PAGE = 500;
type Db = ReturnType<typeof serviceClient>;
type Account = { owner: string; suspended: boolean; deletion_at: string | null; push_subscription: unknown };
type Reminder = { id: string; farmId: string; message: string; farm: Farm; day: string; send: boolean };

function constantTimeMatch(value: string, secret: string) {
  const digest = (input: string) => createHash("sha256").update(input).digest();
  return timingSafeEqual(digest(value), digest(secret));
}
async function selectAll<T>(read: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const result: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await read(offset, offset + PAGE - 1);
    if (error || !data) throw new Error("Maintenance query failed");
    result.push(...data);
    if (data.length < PAGE) return result;
  }
}
async function deliver(db: Db, owner: string, entry: Reminder, channel: "email" | "push", send: () => Promise<void>) {
  const id = entry.day + ":" + entry.id;
  const prior = await db.from("layer_deliveries").select("id").eq("owner", owner).eq("id", id).eq("channel", channel).maybeSingle();
  if (prior.error) throw new Error("Could not check reminder delivery");
  if (!prior.data) {
    await send();
    const { error } = await db.from("layer_deliveries").upsert({ owner, id, channel }, { onConflict: "owner,id,channel", ignoreDuplicates: true });
    if (error) throw error;
  }
}
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !constantTimeMatch(req.headers.get("authorization") || "", "Bearer " + secret)) return fail("Maintenance credential required", 401);
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return fail("Supabase maintenance is unconfigured", 503);
  try {
    const db = serviceClient();
    const { data: refRows, error: refError } = await db.from("layer_references").select("key,value");
    if (refError) throw refError;
    const references = { ...defaultReferences, ...Object.fromEntries(refRows.map(r => [r.key, r.value])) };
    const farms = await selectAll<{ owner: string; record: Farm }>((lo, hi) => db.from("layer_records").select("owner,record").eq("kind", "farm").order("owner").order("id").range(lo, hi));
    const accounts = await selectAll<Account>((lo, hi) => db.from("layer_accounts").select("owner,suspended,deletion_at,push_subscription").order("owner").range(lo, hi));
    const accountMap = new Map(accounts.map(a => [a.owner, a]));
    const purge = new Set(accounts.filter(a => a.deletion_at && Date.parse(a.deletion_at) <= Date.now()).map(a => a.owner));
    const deletion = await db.rpc("layer_purge_expired", { max_accounts: 100 });
    let errors = deletion.error ? 1 : 0;
    const removed = deletion.error ? 0 : Number(deletion.data);
    let reminders = 0;
    const owners = [...new Set(farms.map(r => r.owner))].filter(id => !accountMap.get(id)?.suspended && !purge.has(id));
    for (const owner of owners) {
      try {
        const records = await selectAll<{ record: Row }>((lo, hi) =>
          db.from("layer_records").select("record").eq("owner", owner).order("id").range(lo, hi));
        const all = records.map(r => r.record);
        const remindersForOwner: Reminder[] = [];
        for (const farm of rowsOf(all, "farm")) {
          const day = dayNow(farm.data.timezone);
          const items = all.filter(r => r.farmId === farm.id);
          const active = new Map(rowsOf(items, "flock").filter(f => !f.data.archived).map(f => [f.id, f]));
          const current = scheduleRows(items, day, references).filter(r => {
            const f = active.get(r.data.flock);
            return f && r.data.status === "Pending" && r.date >= f.date && r.date <= addDays(day, farm.data.lead)
              && (!r.id.startsWith("v:") || farm.data.vaccinesApproved);
          });
          const stock = rowsOf(items, "product").map(product => ({ product, ...inventory(items, product, day) }));
          for (const r of current) {
            const available = stock.filter(s => s.product.data.stage === r.data.name && s.units > s.product.data.threshold);
            const short = r.data.kind === "Feed change" && !available.length;
            const send = r.data.kind === "Vaccination" ? r.date <= day || r.date === addDays(day, farm.data.lead) :
              r.date === day || r.date === addDays(day, farm.data.lead);
            const when = r.date < day ? "overdue since " + dateLabel(r.date) : r.date === day ? "due today" : "due " + dateLabel(r.date);
            remindersForOwner.push({ id: r.id, farmId: farm.id, message: r.data.name + " is " + when + " for " + active.get(r.data.flock)!.data.name + (short ? ". Check stock for the next feed stage." : "."), farm, day, send });
          }
          for (const item of stock.filter(s => s.units <= s.product.data.threshold))
            remindersForOwner.push({ id: "low:" + item.product.id, farmId: farm.id, message: item.product.data.name + " is low at " + fmt(item.units, 2) + " kg.", farm, day, send: true });
        }
        const current = remindersForOwner.filter(r => r.farm.data.inApp);
        const existing = await selectAll<{ id: string }>((lo, hi) => db.from("layer_notifications").select("id").eq("owner", owner).order("id").range(lo, hi));
        const currentIds = new Set(current.map(r => r.id));
        const stale = existing.filter(r => !currentIds.has(r.id));
        for (const item of stale) {
          const { error } = await db.from("layer_notifications").delete().eq("owner", owner).eq("id", item.id);
          if (error) errors++;
        }
        for (const reminder of current) {
          const { error } = await db.from("layer_notifications").upsert({ owner, id: reminder.id, farm_id: reminder.farmId, message: reminder.message });
          if (error) errors++; else reminders++;
        }
        const subscription = browserSubscription.safeParse(accountMap.get(owner)?.push_subscription);
        const pushKey = process.env.NEXT_PUBLIC_WEB_PUSH_KEY;
        const pushPrivate = process.env.WEB_PUSH_PRIVATE_KEY;
        const pushSubject = process.env.WEB_PUSH_SUBJECT;
        const canEmail = Boolean(process.env.RESEND_API_KEY && process.env.REMINDER_EMAIL_FROM && remindersForOwner.some(r => r.farm.data.email));
        const email = canEmail ? (await db.auth.admin.getUserById(owner)).data.user?.email : undefined;
        for (const reminder of remindersForOwner.filter(r => r.send)) {
          if (reminder.farm.data.push && subscription.success && pushKey && pushPrivate && pushSubject) {
            try {
              await deliver(db, owner, reminder, "push", async () => {
                await webpush.sendNotification(subscription.data, JSON.stringify({ id: reminder.id, message: reminder.message }), { timeout: 5000, vapidDetails: { subject: pushSubject, publicKey: pushKey, privateKey: pushPrivate } });
              });
            } catch { errors++; }
          }
          if (reminder.farm.data.email && email) {
            try {
              await deliver(db, owner, reminder, "email", async () => {
                const result = await fetch("https://api.resend.com/emails", {
                  method: "POST", signal: AbortSignal.timeout(5000),
                  headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json",
                    "Idempotency-Key": createHash("sha256").update(owner + reminder.id + reminder.day).digest("hex") },
                  body: JSON.stringify({ from: process.env.REMINDER_EMAIL_FROM, to: [email], subject: "Layers Pro farm reminder", text: reminder.farm.data.name + "\n\n" + reminder.message }),
                });
                if (!result.ok) throw new Error("Email delivery failed");
              });
            } catch { errors++; }
          }
        }
      } catch { errors++; }
    }
    return response({ reminders, removed, errors }, errors ? 207 : 200);
  } catch { return fail("Maintenance failed", 500); }
}
export const POST = GET;
