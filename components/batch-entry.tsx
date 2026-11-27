"use client";

import { useState, type FormEvent } from "react";
import { causes, rowSchema, type Row, type RowOf } from "../lib/model";
import { Empty, Field, Panel, Table } from "./ui";

export function BatchEntry({
  farms,
  rows,
  today,
  activeFarm,
  save,
}: {
  farms: RowOf<"farm">[];
  rows: Row[];
  today: string;
  activeFarm: string;
  save: (rows: Row[]) => Promise<void>;
}) {
  const [farm, setFarm] = useState(activeFarm || farms[0]?.id || "");
  const [date, setDate] = useState(today);
  const [review, setReview] =
    useState<{ row: Row; summary: string; flockName: string }[]>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const flocks = rows.filter(
    (row): row is RowOf<"flock"> =>
      row.type === "flock" &&
      row.farmId === farm &&
      !row.data.archived &&
      row.date <= date,
  );
  const products = rows.filter(
    (row): row is RowOf<"product"> =>
      row.type === "product" && row.farmId === farm,
  );
  const existing = new Set(
    rows.filter((r) => r.type === "egg").map((r) => r.id),
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const element = event.currentTarget;
    if (review) {
      setBusy(true);
      try {
        await save(review.map((item) => item.row));
        setReview(undefined);
        element.reset();
        setMessage("Daily entries saved on this device.");
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "Could not save entries.",
        );
      } finally {
        setBusy(false);
      }
      return;
    }
    const form = new FormData(element);
    const items = [];
    for (const flock of flocks) {
      const value = (name: string) =>
        String(form.get(flock.id + "-" + name) || "");
      const eggs = value("eggs");
      const broken = value("broken");
      const deaths = Number(value("deaths"));
      const kg = Number(value("kg"));
      const product = value("product");
      const base = { farmId: farm, date, id: crypto.randomUUID() };
      const eggId = `egg:${flock.id}:${date}`;
      if (eggs !== "" || broken !== "")
        items.push({
          row: {
            ...base,
            id: eggId,
            type: "egg",
            data: {
              flock: flock.id,
              eggs: Number(eggs),
              broken: Number(broken),
            },
          },
          summary: `${Number(eggs)} collected · ${Number(broken)} damaged${existing.has(eggId) ? " · Replaces the previous egg count" : ""}`,
          flockName: flock.data.name,
        });
      if (deaths)
        items.push({
          row: {
            ...base,
            type: "movement",
            data: {
              flock: flock.id,
              kind: "Mortality",
              count: deaths,
              cause: value("cause"),
              notes: "",
            },
          },
          summary: `${deaths} deaths · ${value("cause")}`,
          flockName: flock.data.name,
        });
      if (kg)
        items.push({
          row: {
            ...base,
            id: crypto.randomUUID(),
            type: "stock",
            data: {
              flock: flock.id,
              product,
              kind: "Consumption",
              kg,
              cost: 0,
              notes: "",
            },
          },
          summary: `${kg} kg feed · ${products.find((p) => p.id === product)?.data.name ?? "Select a feed product"}`,
          flockName: flock.data.name,
        });
    }
    if (!items.length) {
      setMessage("Enter at least one daily record.");
      return;
    }
    const parsed = items.map((item) => ({
      ...item,
      result: rowSchema.safeParse(item.row),
    }));
    const invalid = parsed.find((item) => !item.result.success);
    if (invalid) {
      setMessage(
        invalid.flockName +
          ": " +
          (invalid.result.error?.issues[0]?.message || "Check the entry."),
      );
      return;
    }
    setReview(
      parsed.flatMap((item) =>
        item.result.success ? [{ ...item, row: item.result.data }] : [],
      ),
    );
  }

  const entryNumber = (id: string, label: string, step = 1) => (
    <input name={id} aria-label={label} type="number" min={0} step={step} />
  );

  return (
    <Panel
      title="Batch daily entry"
      description="Leave fields empty to skip them, then review all changes before saving."
    >
      <form className="editor-form" onSubmit={submit}>
        <div className="form-row">
          <Field label="Farm">
            <select
              value={farm}
              disabled={Boolean(review)}
              onChange={(e) => setFarm(e.target.value)}
            >
              {farms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.data.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Entry date">
            <input
              type="date"
              value={date}
              max={today}
              required
              disabled={Boolean(review)}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
        </div>
        <div hidden={Boolean(review)}>
          {flocks.length ? (
            <Table
              key={farm + date}
              headers={[
                "Flock",
                "Eggs",
                "Damaged",
                "Deaths",
                "Cause",
                "Feed",
                "Kg used",
              ]}
              rows={flocks.map((f) => [
                f.data.name,
                entryNumber(f.id + "-eggs", f.data.name + " eggs"),
                entryNumber(f.id + "-broken", f.data.name + " damaged eggs"),
                entryNumber(f.id + "-deaths", f.data.name + " deaths"),
                <select
                  key="cause"
                  name={f.id + "-cause"}
                  defaultValue="Unknown"
                  aria-label={f.data.name + " mortality cause"}
                >
                  {causes.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>,
                <select
                  key={farm}
                  name={f.id + "-product"}
                  aria-label={f.data.name + " feed product"}
                >
                  <option value="">Select product</option>
                  {products.map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.data.name}
                    </option>
                  ))}
                </select>,
                entryNumber(f.id + "-kg", f.data.name + " feed used", 0.01),
              ])}
            />
          ) : (
            <Empty>Add an active flock to record daily activity.</Empty>
          )}
        </div>
        {review && (
          <Table
            headers={["Flock", "Review proposed changes"]}
            rows={review.map((item) => [item.flockName, item.summary])}
          />
        )}
        {message && (
          <p className="form-warning" role="status">
            {message}
          </p>
        )}
        <div className="row-actions">
          {review && (
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => setReview(undefined)}
            >
              Edit entries
            </button>
          )}
          <button className="button primary" disabled={!flocks.length || busy}>
            {review
              ? busy
                ? "Saving…"
                : "Save reviewed entries"
              : "Review entries"}
          </button>
        </div>
      </form>
    </Panel>
  );
}
