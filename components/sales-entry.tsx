"use client";

import { useState, type FormEvent } from "react";
import { cash, dateLabel, rowSchema, type Row, type RowOf } from "../lib/model";
import { Field, Modal, Table } from "./ui";

export function SalesEntry({
  farms,
  farmId,
  today,
  existing,
  save,
  close,
}: {
  farms: RowOf<"farm">[];
  farmId: string;
  today: string;
  existing?: RowOf<"money">;
  save: (row: Row) => Promise<void>;
  close: () => void;
}) {
  const [farm, setFarm] = useState(
    existing?.farmId || farmId || farms[0]?.id || "",
  );
  const [saleDate, setSaleDate] = useState(existing?.date || today);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const sale = existing?.data.sale;
  const currency = farms.find((f) => f.id === farm)?.data.currency;
  const paid = sale?.payments.reduce((n, p) => n + p.amount, 0) ?? 0;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const payment = Number(fields.get("paid"));
    const trays = Number(fields.get("trays"));
    const pricePerTray = Number(fields.get("price"));
    const parsed = rowSchema.safeParse({
      id: existing?.id || crypto.randomUUID(),
      farmId: farm,
      type: "money",
      date: saleDate,
      data: {
        kind: "Income",
        category: "Egg sales",
        amount: Math.round(trays * pricePerTray * 100) / 100,
        flock: existing?.data.flock || "",
        reference: existing?.data.reference || "",
        notes: existing?.data.notes || "",
        sale: {
          customer: fields.get("customer"),
          trays,
          pricePerTray,
          payments: [
            ...(sale?.payments ?? []),
            ...(payment > 0
              ? [
                  {
                    id: crypto.randomUUID(),
                    date: String(fields.get("paymentDate")),
                    amount: payment,
                  },
                ]
              : []),
          ],
        },
      },
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message || "Check sale details.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await save(parsed.data);
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save sale.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={existing ? "Sale and payments" : "Record an egg sale"}
      onClose={close}
    >
      <form className="editor-form" onSubmit={submit}>
        <Field label="Farm">
          <select
            value={farm}
            disabled={Boolean(existing)}
            onChange={(e) => setFarm(e.target.value)}
          >
            {farms.map((f) => (
              <option value={f.id} key={f.id}>
                {f.data.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Sale date">
          <input
            type="date"
            required
            value={saleDate}
            max={today}
            onChange={(e) => setSaleDate(e.target.value)}
          />
        </Field>
        <Field label="Customer">
          <input
            name="customer"
            required
            maxLength={120}
            defaultValue={sale?.customer}
          />
        </Field>
        <div className="form-row">
          <Field label="Trays sold">
            <input
              type="number"
              name="trays"
              required
              min="0.01"
              step="0.01"
              defaultValue={sale?.trays}
            />
          </Field>
          <Field label="Price per tray">
            <input
              type="number"
              name="price"
              required
              min="0.01"
              step="0.01"
              defaultValue={sale?.pricePerTray}
            />
          </Field>
        </div>
        {sale && (
          <p>
            Received {cash(paid, currency)} · Outstanding{" "}
            {cash(Math.max(0, (existing?.data.amount ?? 0) - paid), currency)}
          </p>
        )}
        {Boolean(sale?.payments.length) && (
          <Table
            headers={["Payment date", "Received"]}
            rows={sale!.payments.map((p) => [
              dateLabel(p.date),
              cash(p.amount, currency),
            ])}
          />
        )}
        <div className="form-row">
          <Field label={sale ? "Additional payment" : "Amount received"}>
            <input
              type="number"
              name="paid"
              min={0}
              step="0.01"
              defaultValue="0"
            />
          </Field>
          <Field label="Payment date">
            <input
              type="date"
              name="paymentDate"
              min={saleDate}
              max={today}
              defaultValue={today}
              required
            />
          </Field>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy || !farm}>
          {busy ? "Saving…" : "Save sale"}
        </button>
      </form>
    </Modal>
  );
}
