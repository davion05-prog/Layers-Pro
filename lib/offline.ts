import type { Operation, Snapshot } from "./model";

export type WorkspaceCache = {
  snapshot: Snapshot;
  outbox: Operation[];
  rejected?: Record<string, string>;
};
const DB = "layers-pro";
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("workspaces");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function transaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("workspaces", mode);
      const req = action(tx.objectStore("workspaces"));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export const readCache = (id: string): Promise<WorkspaceCache | undefined> =>
  transaction("readonly", (store) => store.get(id));
export const saveCache = (id: string, data: WorkspaceCache) =>
  transaction("readwrite", (store) => store.put(data, id));
export const clearCache = (id: string) =>
  transaction("readwrite", (store) => store.delete(id));
