import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { reportData } from "../lib/reports";
import { farmDefaults, rowSchema, type Row } from "../lib/model";

const date = "2026-11-27";
const migrations = new URL("../supabase/migrations/", import.meta.url);
const first = randomUUID();
const second = randomUUID();
const sessionA = randomUUID();
const sessionB = randomUUID();
const db = new PGlite();

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    grant usage on schema auth to authenticated, service_role;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, encrypted_password text);
    create table auth.sessions(id uuid primary key, user_id uuid references auth.users on delete cascade, not_after timestamptz);
    create table auth.mfa_factors(user_id uuid references auth.users on delete cascade, status text);
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)
    $$;
    create function auth.uid() returns uuid language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''), auth.jwt()->>'sub')::uuid
    $$;
  `);
  for (const file of (await readdir(migrations)).sort()) {
    if (file.endsWith(".sql"))
      await db.exec(await readFile(new URL(file, migrations), "utf8"));
  }
  await db.query(
    "insert into auth.users (id,email) values ($1,'farmer-a@example.com'),($2,'farmer-b@example.com')",
    [first, second],
  );
  await assert.rejects(
    db.query(
      "insert into auth.users (id,email) values ($1,' Farmer-A@example.com ')",
      [randomUUID()],
    ),
    /already registered|duplicate key/i,
  );
  await db.query(
    "insert into auth.sessions (id,user_id) values ($1,$2),($3,$4)",
    [sessionA, first, sessionB, second],
  );

  const assume = async (
    role: "anon" | "authenticated" | "service_role",
    sub?: string,
    sessionId?: string,
    aal = "aal1",
  ) => {
    await db.exec(`reset role; set role ${role}`);
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ role, sub, session_id: sessionId, aal }),
    ]);
  };
  const farm = (id: string, name: string) =>
    rowSchema.parse({
      id,
      farmId: id,
      type: "farm",
      date,
      data: { ...farmDefaults, name },
    });
  const operation = (row: Row) => ({ id: randomUUID(), row });
  const farmA = farm("farm-a", "Farm A");
  const farmB = farm("farm-b", "Farm B");
  const moneyA = rowSchema.parse({
    id: "income-a",
    farmId: farmA.id,
    type: "money",
    date,
    data: {
      kind: "Income",
      flock: "",
      category: "Egg sales",
      amount: 200,
      reference: "",
      notes: "",
    },
  });
  const write = async (owner: string, ops: ReturnType<typeof operation>[]) =>
    (
      await db.query<{ snapshot: { rows: Row[]; audits: unknown[] } }>(
        "select public.layer_sync_for($1,$2) as snapshot",
        [owner, JSON.stringify(ops)],
      )
    ).rows[0].snapshot;
  const snapshot = async () =>
    (
      await db.query<{ snapshot: { rows: Row[] } }>(
        "select public.layer_snapshot() as snapshot",
      )
    ).rows[0].snapshot.rows;

  await assume("service_role");
  const firstSale = [operation(farmA), operation(moneyA)];
  assert.equal((await write(first, firstSale)).audits.length, 2);
  assert.equal((await write(first, firstSale)).audits.length, 2);
  await write(second, [operation(farmB)]);
  await assert.rejects(
    write(second, [operation(moneyA)]),
    /Farm is unavailable/,
  );
  await db.query(
    "select public.layer_security_record($1,'Sign-in','device-hash')",
    [first],
  );
  const limited = () =>
    db.query<{ allowed: boolean }>(
      "select public.layer_auth_limit('shared-key',2) as allowed",
    );
  assert.equal((await limited()).rows[0].allowed, true);
  assert.equal((await limited()).rows[0].allowed, true);
  assert.equal((await limited()).rows[0].allowed, false);

  const idA = randomUUID();
  const idB = randomUUID();
  const saleWith = (id: string, amount: number) =>
    rowSchema.parse({
      ...moneyA,
      data: {
        ...moneyA.data,
        sale: {
          customer: "Test customer",
          trays: 2,
          pricePerTray: 100,
          payments: [{ id, date, amount }],
        },
      },
    });
  await write(first, [operation(saleWith(idA, 40))]);
  const merged = await write(first, [operation(saleWith(idB, 60))]);
  const mergedSale = merged.rows.find((r) => r.id === moneyA.id);
  assert.ok(mergedSale?.type === "money");
  assert.equal(
    mergedSale.data.sale?.payments.reduce((n, p) => n + p.amount, 0),
    100,
  );
  await assert.rejects(
    write(first, [operation(saleWith(randomUUID(), 110))]),
    /exceed the sale total/,
  );

  await assume("authenticated", second, sessionB);
  assert.deepEqual(
    (await snapshot()).map((r) => r.id),
    [farmB.id],
  );
  assert.deepEqual(
    (await db.query("select id from public.layer_records")).rows,
    [{ id: farmB.id }],
  );
  assert.equal(
    (await db.query("select id from public.layer_security_events")).rows.length,
    0,
  );
  await assert.rejects(
    db.query(
      "update public.layer_records set record = '{}' where farm_id = 'farm-a'",
    ),
    /permission denied/i,
  );
  await assert.rejects(
    db.query("select public.layer_sync_for($1,'[]')", [first]),
    /permission denied/i,
  );
  await assert.rejects(
    db.query("select public.layer_security_record($1,'Sign-in','spoof')", [
      first,
    ]),
    /permission denied/i,
  );
  assert.equal(
    reportData(await snapshot(), "Finances", {
      farm: farmA.id,
      start: date,
      end: date,
    }).length,
    1,
  );

  await assume("authenticated", first, sessionA);
  assert.equal(
    reportData(await snapshot(), "Finances", {
      farm: farmA.id,
      start: date,
      end: date,
    }).length,
    2,
  );
  assert.equal(
    (await db.query("select event from public.layer_security_events")).rows
      .length,
    1,
  );
  await db.exec("reset role");
  await db.query("insert into auth.mfa_factors values ($1,'verified')", [
    first,
  ]);
  await assume("authenticated", first, sessionA);
  assert.equal(
    (await db.query("select id from public.layer_records")).rows.length,
    0,
  );
  await assert.rejects(snapshot(), /Account is unavailable/);
  await assume("authenticated", first, sessionA, "aal2");
  assert.equal((await snapshot()).length, 2);
  await db.exec("reset role");
  await db.query("delete from auth.sessions where id=$1", [sessionA]);
  await assume("authenticated", first, sessionA, "aal2");
  await assert.rejects(snapshot(), /Account is unavailable/);
  await assume("anon");
  await assert.rejects(snapshot(), /permission denied/i);
  console.log(
    "Passed email uniqueness, tenant reads/writes/sync/exports, activity isolation, rate limits, MFA and session revocation.",
  );
} finally {
  await db.close();
}
