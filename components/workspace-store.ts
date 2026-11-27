"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { sample } from "../lib/demo";
import { session, type User } from "../lib/session";
import {
  daysBetween,
  dayNow,
  type Audit,
  type Operation,
  type Row,
  type Snapshot,
} from "../lib/model";
import {
  clearCache,
  readCache,
  saveCache,
  type WorkspaceCache,
} from "../lib/offline";

const DEMO = "demo";
const empty: Snapshot = { rows: [], audits: [], notifications: [] };
const emptyWorkspace: WorkspaceCache = { snapshot: empty, outbox: [] };
const lastUserKey = "layers-pro-user";
const logoutPending = "layers-pro-logout-pending";
const sampleWorkspace = (day?: string): WorkspaceCache => ({
  snapshot: sample(day),
  outbox: [],
});

export function useWorkspace(initialDay: string, demo: boolean) {
  const [cache, setCache] = useState<WorkspaceCache>(() =>
    demo ? sampleWorkspace(initialDay) : emptyWorkspace,
  );
  const cacheRef = useRef(cache);
  const owner = useRef<string | null>(demo ? DEMO : null);
  const [user, setUser] = useState<User | null>(null);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [failure, setFailure] = useState("");
  const syncingRef = useRef(false);
  const accountRefresh = useRef(0);
  const serialization = useRef<Promise<unknown>>(Promise.resolve());

  const persist = useCallback(<T>(callback: () => Promise<T>) => {
    const run = async (): Promise<T> => {
      if (typeof navigator !== "undefined" && navigator.locks)
        return await navigator.locks.request("layers-pro-cache", callback);
      return callback();
    };
    const work = serialization.current.then(run, run);
    serialization.current = work.catch(() => undefined);
    return work;
  }, []);
  const publish = useCallback((data: WorkspaceCache) => {
    cacheRef.current = data;
    setCache(data);
  }, []);
  const lockCachedAccount = useCallback(
    async (id?: string) => {
      try {
        const local = localStorage.getItem(lastUserKey);
        const cached = local ? (JSON.parse(local) as User) : null;
        if (!cached || (id && id !== cached.id)) return;
        localStorage.removeItem(lastUserKey);
        await persist(async () => {
          const workspace = await readCache(cached.id);
          if (workspace?.outbox.length)
            await saveCache(cached.id, { ...workspace, snapshot: empty });
          else await clearCache(cached.id);
        });
      } catch {}
    },
    [persist],
  );
  const sync = useCallback(
    async (retryId?: string) => {
      const id = owner.current;
      if (!id || id === DEMO || syncingRef.current || !navigator.onLine) return;
      syncingRef.current = true;
      setSyncing(true);
      const read = async () =>
        (await readCache(id).catch(() => undefined)) ?? cacheRef.current;
      const update = async (
        change: (current: WorkspaceCache) => WorkspaceCache,
      ) => {
        await persist(async () => {
          if (owner.current !== id) return;
          const next = change(await read());
          await saveCache(id, next);
          if (owner.current === id) publish(next);
        });
      };
      const send = async (batch: Operation[]) => {
        const result = await fetch(
          "/api/records",
          batch.length
            ? {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ops: batch }),
              }
            : { cache: "no-store" },
        );
        const payload = await result.json();
        if (!result.ok) {
          if (result.status === 401 || result.status === 403) {
            const account = await session();
            if (!account.user && owner.current === id) {
              await lockCachedAccount(id);
              window.location.replace(
                account.mfaRequired ? "/login?step=mfa" : "/login",
              );
            }
          }
          if (result.status !== 400 && result.status !== 422)
            throw new Error(payload.error || "Could not sync.");
          let split = Math.floor(batch.length / 2);
          if (
            split > 0 &&
            batch[split - 1].group &&
            batch[split - 1].group === batch[split].group
          )
            split--;
          if (split > 0 && split < batch.length) {
            await send(batch.slice(0, split));
            await send(batch.slice(split));
          } else {
            await update((current) => ({
              ...current,
              rejected: {
                ...current.rejected,
                ...Object.fromEntries(
                  batch.map((op) => [
                    op.id,
                    payload.error || "Review this record.",
                  ]),
                ),
              },
            }));
          }
          return;
        }
        const sent = new Set(batch.map((op) => op.id));
        await update((current) => ({
          snapshot:
            (current.snapshot.syncedAt || "") > (payload.syncedAt || "")
              ? current.snapshot
              : payload,
          outbox: current.outbox.filter((op) => !sent.has(op.id)),
          rejected: Object.fromEntries(
            Object.entries(current.rejected ?? {}).filter(
              ([id]) => !sent.has(id),
            ),
          ),
        }));
      };
      try {
        const current = await read();
        const retryGroup = current.outbox.find(
          (op) => op.id === retryId,
        )?.group;
        const pending = current.outbox.filter((op) =>
          retryId
            ? op.id === retryId || (retryGroup && op.group === retryGroup)
            : !current.rejected?.[op.id],
        );
        if (!pending.length) await send([]);
        for (let offset = 0; offset < pending.length && owner.current === id;) {
          const end = offset + 100;
          const limit =
            pending[end - 1]?.group &&
            pending[end - 1].group === pending[end]?.group
              ? end - 1
              : end;
          await send(pending.slice(offset, limit));
          offset = limit;
        }
        setFailure("");
        const attempted = new Set(pending.map((op) => op.id));
        if (
          !retryId &&
          cacheRef.current.outbox.some(
            (op) =>
              !attempted.has(op.id) && !cacheRef.current.rejected?.[op.id],
          )
        )
          window.setTimeout(() => void sync(), 0);
      } catch (cause) {
        if (owner.current === id)
          setFailure(cause instanceof Error ? cause.message : "Could not sync");
      } finally {
        syncingRef.current = false;
        setSyncing(false);
      }
    },
    [persist, publish, lockCachedAccount],
  );
  const load = useCallback(async () => {
    const sequence = ++accountRefresh.current;
    if (demo) {
      const stored = await readCache(DEMO).catch(() => undefined);
      if (sequence !== accountRefresh.current) return;
      publish(stored ?? sampleWorkspace());
      setReady(true);
      return;
    }

    let account: User | null = null;
    let active = false;
    try {
      if (localStorage.getItem(logoutPending)) {
        if (!navigator.onLine) {
          setReady(true);
          return;
        }
        await session({ action: "logout" });
        localStorage.removeItem(logoutPending);
      }
      const data = await session();
      if (sequence !== accountRefresh.current) return;
      setMfaRequired(data.mfaRequired);
      account = data.user;
      active = Boolean(account);
      if (!active) await lockCachedAccount();
    } catch {
      // Open the last workspace only when the session service cannot be
      // reached. An explicit signed-out response goes to the login page.
      try {
        const local = localStorage.getItem(lastUserKey);
        if (local) account = JSON.parse(local);
      } catch {}
    }

    const id = account?.id ?? null;
    const needsInitialSync = await persist(async () => {
      let stored = id ? await readCache(id).catch(() => undefined) : undefined;
      if (
        account &&
        !active &&
        (!stored?.snapshot.syncedAt ||
          daysBetween(stored.snapshot.syncedAt.slice(0, 10), dayNow()) > 30)
      ) {
        stored = stored ? { ...stored, snapshot: empty } : undefined;
      }
      if (sequence !== accountRefresh.current) return false;
      owner.current = id;
      setUser(account);
      setFailure(
        account && !active && navigator.onLine
          ? "Sign in again to resume sync."
          : "",
      );
      publish(stored ?? emptyWorkspace);
      if (active && account) {
        try {
          localStorage.setItem(lastUserKey, JSON.stringify(account));
        } catch {}
      }
      return active && !stored;
    });

    if (sequence !== accountRefresh.current) return;
    if (active) {
      const refresh = sync();
      if (needsInitialSync) await refresh;
    }
    if (sequence === accountRefresh.current) setReady(true);
  }, [demo, persist, publish, sync, lockCachedAccount]);

  useEffect(() => {
    setOnline(navigator.onLine);
    void load();
    const connected = () => {
      setOnline(true);
      void load();
    };
    const disconnected = () => setOnline(false);
    window.addEventListener("online", connected);
    window.addEventListener("offline", disconnected);
    const refresh = () => {
      if (document.visibilityState === "visible") void sync();
    };
    document.addEventListener("visibilitychange", refresh);
    const interval = window.setInterval(refresh, 60_000);
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator)
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    return () => {
      window.removeEventListener("online", connected);
      window.removeEventListener("offline", disconnected);
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(interval);
    };
  }, [load, sync]);

  async function addBatch(rows: Row[], previous?: Row) {
    if (!rows.length) return;
    const id = owner.current;
    if (!id) throw new Error("Log in before saving farm records.");
    await persist(async () => {
      if (owner.current !== id) throw new Error("The current account changed");
      const current =
        (await readCache(id).catch(() => undefined)) ?? cacheRef.current;
      const group =
        rows.length === 2 &&
        rows.every((row) => row.type === "movement" && row.data.transfer)
          ? crypto.randomUUID()
          : undefined;
      const ops = rows.map((entry) => ({
        id: crypto.randomUUID(),
        row: entry,
        group,
      }));
      let data: WorkspaceCache;
      if (id === DEMO) {
        const audits: Audit[] = ops.map((op, index) => ({
          id: op.id,
          record_id: op.row.id,
          changed_at: new Date().toISOString(),
          previous:
            (index === 0 ? previous : undefined) ??
            current.snapshot.rows.find((r) => r.id === op.row.id) ??
            null,
          current: op.row,
        }));
        const updated = new Set(ops.map((op) => op.row.id));
        data = {
          outbox: [],
          snapshot: {
            ...current.snapshot,
            rows: [
              ...current.snapshot.rows.filter((r) => !updated.has(r.id)),
              ...ops.map((op) => op.row),
            ],
            audits: [...audits, ...current.snapshot.audits],
          },
        };
      } else {
        const outbox = [...current.outbox];
        const revising = new Set(ops.map((op) => op.row.id));
        const stale = syncingRef.current
          ? []
          : outbox.filter(
              (item) =>
                revising.has(item.row.id) && current.rejected?.[item.id],
            );
        const excluded = new Set(stale.map((item) => item.id));
        const first = outbox.findIndex((item) => excluded.has(item.id));
        const retained = outbox.filter((item) => !excluded.has(item.id));
        retained.splice(first < 0 ? retained.length : first, 0, ...ops);
        data = {
          snapshot: current.snapshot,
          outbox: retained,
          rejected: Object.fromEntries(
            Object.entries(current.rejected ?? {}).filter(
              ([id]) => !excluded.has(id),
            ),
          ),
        };
      }
      await saveCache(id, data);
      if (owner.current === id) publish(data);
    });
    if (owner.current === id) void sync();
  }

  async function add(row: Row, previous?: Row, companion?: Row) {
    await addBatch(companion ? [row, companion] : [row], previous);
  }

  async function logout(allDevices = false, clearPending = false) {
    if (!clearPending && cacheRef.current.outbox.length)
      throw new Error(
        "Sync your pending records before signing out on this device.",
      );
    if (navigator.onLine || allDevices)
      await session({ action: allDevices ? "logout-all" : "logout" });
    else if (!clearPending)
      throw new Error("Connect to the internet to sign out.");
    else localStorage.setItem(logoutPending, "1");
    const id = owner.current;
    ++accountRefresh.current;
    owner.current = null;
    if (id && id !== DEMO)
      await persist(() => clearCache(id)).catch(() => undefined);
    localStorage.removeItem(lastUserKey);
    if (clearPending) localStorage.removeItem("layers-pro-device");
    window.location.replace(navigator.onLine ? "/login" : "/");
  }
  return {
    cache,
    user,
    ready,
    mfaRequired,
    online,
    syncing,
    failure,
    sync,
    add,
    addBatch,
    logout,
  };
}
