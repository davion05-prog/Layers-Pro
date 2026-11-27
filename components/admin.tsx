"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { References } from "../lib/model";
import { Badge, Field, Panel, Table } from "./ui";

type Management = {
  stats: { accounts: number; farms: number; flocks: number; suspended: number };
  accounts: {
    id: string;
    email?: string;
    created_at: string;
    suspended?: boolean;
    deletion_at?: string;
  }[];
  references: References;
  audit: { action: string; target: string; created_at: string }[];
};
export function Admin() {
  const [data, setData] = useState<Management>();
  const [search, setSearch] = useState("");
  const [find, setFind] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const result = await fetch("/api/admin?q=" + encodeURIComponent(find), {
        cache: "no-store",
      });
      const payload = await result.json();
      if (!result.ok) throw new Error(payload.error);
      setData(payload);
    } catch (e) {
      setMessage((e as Error).message);
    }
  }, [find]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function submit(body: object) {
    setBusy(true);
    setMessage("");
    try {
      const result = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!result.ok) throw new Error((await result.json()).error);
      await refresh();
      setMessage("Changes saved");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function saveRefs(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    try {
      void submit({
        action: "references",
        data: {
          breeds: String(values.get("breeds"))
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
          feed: JSON.parse(String(values.get("feed"))),
          vaccines: JSON.parse(String(values.get("vaccines"))),
        },
      });
    } catch {
      setMessage("Enter valid JSON for feed and vaccination templates.");
    }
  }
  return (
    <>
      {message && (
        <p className="form-warning" role="status">
          {message}
        </p>
      )}
      <Panel
        title="Platform adoption"
        description="Aggregate counts across all accounts"
      >
        <div className="report-summary">
          {data &&
            Object.entries(data.stats).map(([key, value]) => (
              <Badge tone="green" key={key}>
                {value} {key}
              </Badge>
            ))}
        </div>
      </Panel>
      <Panel title="Find accounts">
        <form
          className="inline-filters"
          onSubmit={(e) => {
            e.preventDefault();
            setFind(search);
            if (search === find) void refresh();
          }}
        >
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Email or account ID"
            aria-label="Email or account ID"
            required
          />
          <button className="button secondary">Search</button>
        </form>
        {find && (
          <Table
            headers={["Account", "Status", ""]}
            rows={(data?.accounts ?? []).map((u) => [
              u.email || u.id,
              u.suspended
                ? "Suspended"
                : u.deletion_at
                  ? "Deletion pending"
                  : "Active",
              <button
                key={u.id}
                className="mini-button"
                disabled={busy}
                onClick={() =>
                  void submit({
                    action: u.suspended ? "reactivate" : "suspend",
                    account: u.id,
                  })
                }
              >
                {u.suspended ? "Reactivate" : "Suspend"}
              </button>,
            ])}
          />
        )}
      </Panel>
      {data && (
        <Panel
          title="Reference data"
          description="Changes apply across the platform. Review vaccine templates with a veterinarian before use."
        >
          <form className="editor-form" onSubmit={saveRefs}>
            <Field label="Breeds (one per line)">
              <textarea
                name="breeds"
                defaultValue={data.references.breeds.join("\n")}
                rows={4}
                required
              />
            </Field>
            <Field label="Feed stages (JSON)">
              <textarea
                name="feed"
                defaultValue={JSON.stringify(data.references.feed, null, 2)}
                rows={6}
                required
              />
            </Field>
            <Field label="Vaccination templates (JSON)">
              <textarea
                name="vaccines"
                defaultValue={JSON.stringify(data.references.vaccines, null, 2)}
                rows={6}
                required
              />
            </Field>
            <div>
              <button className="button primary" disabled={busy}>
                Save reference data
              </button>
            </div>
          </form>
        </Panel>
      )}
      <Panel title="Administrative audit">
        <Table
          headers={["Date", "Action", "Target"]}
          rows={(data?.audit || []).map((r) => [
            new Date(r.created_at).toLocaleString("en-KE"),
            r.action,
            r.target,
          ])}
        />
      </Panel>
    </>
  );
}
