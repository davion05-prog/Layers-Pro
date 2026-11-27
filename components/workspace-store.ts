"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { sample } from "../lib/demo";
import { session, type User } from "../lib/session";
import {
  daysBetween,
  dayNow,
  type Audit,
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
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [failure, setFailure] = useState("");
  const syncingRef = useRef(false);
  const accountRefresh = useRef(0);
  const rejected = useRef(new Set<string>());
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
  const sync = useCallback(async () => {
    const id = owner.current;
    if (!id || id === DEMO || syncingRef.current || !navigator.onLine) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      let pending = (
        (await readCache(id).catch(() => undefined)) ?? cacheRef.current
      ).outbox;
      do {
        const split =
          pending[99]?.group && pending[99].group === pending[100]?.group
            ? 99
            : 100;
        const batch = pending.slice(0, split);
        const res = await fetch(
          "/api/records",
          batch.length
            ? {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ops: batch }),
              }
            : { cache: "no-store" },
        );
        const result = await res.json();
        if (!res.ok) {
          if (res.status === 422 && owner.current === id)
            rejected.current = new Set(batch.map((op) => op.id));
          throw new Error(result.error || "Sync failed");
        }
        if (owner.current !== id) return;
        const ids = new Set(batch.map((op) => op.id));
        await persist(async () => {
          if (owner.current !== id) return;
          const current =
            (await readCache(id).catch(() => undefined)) ?? cacheRef.current;
          const snapshot =
            (current.snapshot.syncedAt || "") > (result.syncedAt || "")
              ? current.snapshot
              : result;
          const data: WorkspaceCache = {
            snapshot,
            outbox: current.outbox.filter((op) => !ids.has(op.id)),
          };
          await saveCache(id, data);
          if (owner.current === id) publish(data);
        });
        pending = cacheRef.current.outbox;
      } while (pending.length && owner.current === id);
      rejected.current.clear();
      setFailure("");
    } catch (e) {
      if (owner.current === id)
        setFailure(e instanceof Error ? e.message : "Could not sync");
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [persist, publish]);
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
      const data = await session();
      account = data.user;
      active = Boolean(account);
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
      if (owner.current !== id) rejected.current.clear();
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
  }, [demo, persist, publish, sync]);

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

  async function add(row: Row, previous?: Row, companion?: Row) {
    const id = owner.current;
    if (!id) throw new Error("Log in before saving farm records.");
    await persist(async () => {
      if (owner.current !== id) throw new Error("The current account changed");
      const current =
        (await readCache(id).catch(() => undefined)) ?? cacheRef.current;
      const group = companion ? crypto.randomUUID() : undefined;
      const ops = (companion ? [row, companion] : [row]).map((entry) => ({
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
                revising.has(item.row.id) && rejected.current.has(item.id),
            );
        const excluded = new Set(stale.map((item) => item.id));
        const first = outbox.findIndex((item) => excluded.has(item.id));
        const retained = outbox.filter((item) => !excluded.has(item.id));
        retained.splice(first < 0 ? retained.length : first, 0, ...ops);
        data = { snapshot: current.snapshot, outbox: retained };
      }
      await saveCache(id, data);
      if (owner.current === id) publish(data);
    });
    void sync();
  }

  async function logout() {
    if (cacheRef.current.outbox.length)
      throw new Error(
        "Sync your pending records before signing out on this device.",
      );
    await session({ action: "logout" });
    const id = owner.current;
    ++accountRefresh.current;
    owner.current = null;
    if (id && id !== DEMO)
      await persist(() => clearCache(id)).catch(() => undefined);
    localStorage.removeItem(lastUserKey);
    window.location.replace("/login");
  }
  return {
    cache,
    user,
    ready,
    online,
    syncing,
    failure,
    sync,
    add,
    logout,
  };
}
