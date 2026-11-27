"use client";

import { useState, type FormEvent } from "react";
import {
  addDays,
  age,
  categories,
  causes,
  defaultReferences,
  flockKey,
  population,
  rowsOf,
  rowSchema,
  stockBalance,
  type References,
  type Row,
} from "../lib/model";
import { Field, Modal } from "./ui";

export type EditorState = {
  type: Row["type"];
  existing?: Row;
  initial?: string;
};
const titles = {
  farm: "Farm settings",
  house: "Poultry house",
  flock: "Flock details",
  egg: "Record eggs",
  movement: "Bird movement",
  product: "Feed product",
  stock: "Feed transaction",
  money: "Financial entry",
  schedule: "Schedule item",
};
const defaults = {
  name: "",
  location: "",
  currency: "KES",
  timezone: "Africa/Nairobi",
  traySize: 30,
  lead: 7,
  email: false,
  push: false,
  inApp: true,
  feedStages: [] as References["feed"],
  vaccinesApproved: false,
  categories,
  capacity: 500,
  breed: "",
  hatch: "",
  house: "",
  archived: false,
  cost: 0,
  initial: 100,
  flock: "",
  eggs: 0,
  broken: 0,
  count: 1,
  cause: "",
  notes: "",
  stage: "",
  bag: 50,
  threshold: 50,
  product: "",
  kg: 0,
  category: "",
  amount: 0,
  reference: "",
  status: "Pending",
  completed: "",
  route: "",
  batch: "",
  dose: "",
};
export function Editor({
  editor,
  rows,
  farm,
  flock,
  today,
  references = defaultReferences,
  close,
  save,
}: {
  editor: EditorState;
  rows: Row[];
  farm: string;
  flock: string;
  today: string;
  references?: References;
  close: () => void;
  save: (row: Row, replace?: Row, companion?: Row) => Promise<void>;
}) {
  const { type, existing, initial } = editor;
  const old = { ...defaults, ...existing?.data };
  const farms = rowsOf(rows, "farm");
  const [scope, setScope] = useState(
    existing?.farmId || farm || farms[0]?.id || "",
  );
  const flocks = rowsOf(rows, "flock").filter(
    (f) =>
      f.farmId === scope &&
      (!f.data.archived || f.id === (existing && flockKey(existing))),
  );
  const products = rowsOf(rows, "product").filter((f) => f.farmId === scope);
  const settings = farms.find((f) => f.id === scope)?.data;
  const [selectedFlock, setFlock] = useState(old.flock || flock);
  const [productId, setProduct] = useState(
    old.product || products[0]?.id || "",
  );
  const linked =
    existing?.type === "movement" && existing.data.transfer
      ? rowsOf(rows, "movement").find(
          (r) =>
            r.id !== existing.id && r.data.transfer === existing.data.transfer,
        )
      : undefined;
  const [destination, setDestination] = useState(linked?.data.flock || "");
  const [kind, setKind] = useState(
    (linked ? "Transfer" : "kind" in old ? String(old.kind) : "") ||
      initial ||
      (
        {
          movement: "Mortality",
          stock: "Consumption",
          money: "Income",
          schedule: "Vaccination",
        } as Record<string, string>
      )[type] ||
      "",
  );
  const [status, setStatus] = useState(
    initial === "Complete" ? "Done" : old.status,
  );
  const [inputDate, setDate] = useState(existing?.date || today);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [ageMode, setAgeMode] = useState(existing ? "date" : "weeks");
  const [unit, setUnit] = useState(type === "egg" ? "Eggs" : "kg");
  const selected = flocks.find((f) => f.id === selectedFlock) ?? flocks[0];
  const destinationFlocks = rowsOf(rows, "flock").filter(
    (f) => f.id !== selected?.id && (!f.data.archived || f.id === destination),
  );
  const currentProduct =
    products.find((p) => p.id === productId) ?? products[0];
  const stageOptions = settings?.feedStages ?? references.feed;
  const options = (items: string[]) =>
    items.map((v) => <option key={v}>{v}</option>);
  const input = (
    label: string,
    key: keyof typeof defaults,
    required = true,
  ) => (
    <Field label={label}>
      <input
        name={key}
        defaultValue={String(old[key])}
        required={required}
        maxLength={key === "notes" ? 2000 : 120}
      />
    </Field>
  );
  const num = (
    label: string,
    key: keyof typeof defaults,
    min = 0,
    step: string | number = 1,
  ) => (
    <Field label={label}>
      <input
        name={key}
        type="number"
        min={min === -Infinity ? undefined : min}
        step={step}
        defaultValue={Number(old[key])}
        required
      />
    </Field>
  );
  const select = (
    label: string,
    name: string,
    items: string[],
    value: string,
  ) => (
    <Field label={label}>
      <select name={name} defaultValue={value || items[0]}>
        {options(items)}
      </select>
    </Field>
  );
  const kindSelect = (items: string[]) => (
    <Field label="Type">
      <select
        value={kind}
        onChange={(e) => {
          setKind(e.target.value);
          setConfirm("");
        }}
      >
        {options(items)}
      </select>
    </Field>
  );
  const flockSelect = (required: boolean) => (
    <Field label={required ? "Flock" : "Flock (optional)"}>
      <select
        value={required ? selected?.id || "" : selectedFlock}
        onChange={(e) => {
          setFlock(e.target.value);
          setConfirm("");
        }}
        required={required}
        disabled={(type === "egg" && Boolean(existing)) || Boolean(linked)}
      >
        <option value="">{required ? "Select a flock" : "Farm-wide"}</option>
        {flocks.map((f) => (
          <option value={f.id} key={f.id}>
            {f.data.name}
          </option>
        ))}
      </select>
    </Field>
  );
  const notes = (
    <Field label="Notes (optional)">
      <textarea name="notes" defaultValue={old.notes} rows={3} />
    </Field>
  );
  const dateInput = (
    <Field label={type === "schedule" ? "Due date" : "Date"}>
      <input
        type="date"
        value={inputDate}
        onChange={(e) => {
          setDate(e.target.value);
          setConfirm("");
        }}
        disabled={type === "egg" && Boolean(existing)}
        required
      />
    </Field>
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const data = new FormData(event.currentTarget);
    const s = (key: string) => String(data.get(key) || "").trim();
    const n = (key: string) => Number(data.get(key));
    const b = (key: string) => data.has(key);
    let id = existing?.id || crypto.randomUUID();
    const farmId = type === "farm" ? id : scope;
    const date =
      type === "farm" || type === "product" || type === "house"
        ? existing?.date || today
        : inputDate;
    let payload: unknown;
    let replacement: Row | undefined;
    let companion: Row | undefined;
    let warning = "";
    if (type === "farm") {
      const feedStages = s("feedStages")
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const split = line.indexOf(":");
          return {
            week: split > 0 ? Number(line.slice(0, split)) : NaN,
            name: line.slice(split + 1).trim(),
          };
        });
      payload = {
        name: s("name"),
        location: s("location"),
        currency: s("currency").toUpperCase(),
        timezone: s("timezone"),
        traySize: n("traySize"),
        lead: n("lead"),
        email: b("email"),
        push: b("push"),
        inApp: b("inApp"),
        feedStages,
        vaccinesApproved: b("vaccinesApproved"),
        categories: [
          ...new Set(
            s("categories")
              .split("\n")
              .map((v) => v.trim())
              .filter(Boolean),
          ),
        ],
      };
    } else if (type === "house")
      payload = { name: s("name"), capacity: n("capacity") };
    else if (type === "flock") {
      const hatch =
        s("hatch") ||
        addDays(date, -7 * n(ageMode === "group" ? "groupWeek" : "weeks"));
      if (hatch > date)
        return setError(
          "Hatch date must be on or before the registration date.",
        );
      payload = {
        name: s("name"),
        breed: s("breed"),
        hatch,
        house: s("house"),
        archived: b("archived"),
        initial:
          existing?.type === "flock" ? existing.data.initial : n("initial"),
        cost: n("cost"),
      };
      const house = rowsOf(rows, "house").find((r) => r.id === s("house"));
      if (house && !b("archived")) {
        const occupied = flocks
          .filter((f) => f.id !== id && f.data.house === house.id)
          .reduce((sum, f) => sum + Math.max(0, population(rows, f, date)), 0);
        if (
          occupied +
            (existing?.type === "flock"
              ? population(rows, existing, date)
              : n("initial")) >
          house.data.capacity
        )
          warning = "This flock exceeds the selected house capacity.";
      }
    } else if (type === "egg") {
      id = "egg:" + selected?.id + ":" + date;
      replacement = rows.find((r) => r.id === id && r.id !== existing?.id);
      const eggs =
        n("eggs") * (unit === "Trays" ? settings?.traySize || 30 : 1);
      payload = {
        flock: selected?.id,
        eggs: Math.round(eggs),
        broken: n("broken"),
      };
      if (replacement)
        warning =
          "An egg record already exists on this date. Saving will replace it and preserve the previous values in the audit log.";
    } else if (type === "movement") {
      const count = n("count");
      const transfer =
        kind === "Transfer"
          ? (existing?.type === "movement" && existing.data.transfer) ||
            crypto.randomUUID()
          : undefined;
      payload = {
        flock: selected?.id,
        kind: kind === "Transfer" ? "Transfer out" : kind,
        count,
        cause: s("cause"),
        notes: s("notes"),
        transfer,
      };
      if (transfer) {
        const target = destinationFlocks.find((f) => f.id === destination);
        if (!target) return setError("Select a different destination flock.");
        if (date < target.date || (selected && date < selected.date))
          return setError(
            "Transfer date must be on or after both flocks were registered.",
          );
        const result = rowSchema.safeParse({
          id: linked?.id || crypto.randomUUID(),
          farmId: target.farmId,
          date,
          type: "movement",
          data: {
            flock: target.id,
            kind: "Transfer in",
            count,
            cause: "",
            notes: s("notes"),
            transfer,
          },
        });
        if (!result.success)
          return setError("Enter a valid transfer quantity.");
        companion = result.data;
      }
      if (selected && !["Addition", "Transfer in"].includes(kind)) {
        const before = rows.filter(
          (r) => r.id !== existing?.id && r.id !== linked?.id,
        );
        if (n("count") > population(before, selected, date))
          warning =
            "This movement exceeds the recorded live population. Saving keeps the entry flagged for review.";
      }
    } else if (type === "product")
      payload = {
        name: s("name"),
        stage: s("stage"),
        bag: n("bag"),
        threshold: n("threshold"),
      };
    else if (type === "stock") {
      const kg =
        n("kg") * (unit === "Bags" ? currentProduct?.data.bag || 1 : 1);
      payload = {
        product: currentProduct?.id,
        flock: kind === "Consumption" ? selected?.id : selectedFlock,
        kg,
        kind,
        cost: kind === "Purchase" ? n("cost") : 0,
        notes: s("notes"),
      };
      const before = rows.filter((r) => r.id !== existing?.id);
      if (
        currentProduct &&
        stockBalance(before, currentProduct.id, date) +
          (kind === "Consumption" ? -kg : kg) <
          0
      )
        warning =
          "This leaves negative feed stock. Saving keeps the entry flagged for review.";
    } else if (type === "money")
      payload = {
        flock: selectedFlock,
        kind,
        category: s("category"),
        amount: n("amount"),
        reference: s("reference"),
        notes: s("notes"),
      };
    else
      payload = {
        flock: selected?.id,
        kind,
        name: s("name"),
        status,
        completed: s("completed"),
        route: s("route"),
        batch: s("batch"),
        dose: s("dose"),
        cost: n("cost"),
        notes: s("notes"),
      };
    const parsed = rowSchema.safeParse({
      id,
      farmId,
      date,
      type,
      data: payload,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return setError(
        (issue.path.at(-1) ? String(issue.path.at(-1)) + " · " : "") +
          issue.message,
      );
    }
    if (warning && confirm !== warning) return setConfirm(warning);
    setPending(true);
    try {
      await save(parsed.data, replacement, companion);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setPending(false);
    }
  }
  const farmTypes = !["farm"].includes(type);
  return (
    <Modal
      title={(existing && initial !== "Complete" ? "Edit " : "") + titles[type]}
      onClose={close}
    >
      <form
        className="editor-form"
        onSubmit={submit}
        onChange={() => setConfirm("")}
      >
        {farmTypes && (
          <Field label="Farm">
            <select
              value={scope}
              disabled={Boolean(existing)}
              required
              onChange={(e) => {
                setScope(e.target.value);
                setFlock("");
                setProduct("");
              }}
            >
              <option value="">Select a farm</option>
              {farms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.data.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {type === "farm" && (
          <>
            {input("Farm name", "name")}
            {input("Location", "location", false)}
            <div className="form-row">
              {input("Currency", "currency")}
              {input("Timezone", "timezone")}
            </div>
            <div className="form-row">
              {num("Eggs per tray", "traySize", 1)}
              {num("Reminder lead days", "lead")}
            </div>
            <Field label="Feed stages (week: name, one per line)">
              <textarea
                name="feedStages"
                rows={4}
                defaultValue={(old.feedStages.length
                  ? old.feedStages
                  : references.feed
                )
                  .map((s) => s.week + ": " + s.name)
                  .join("\n")}
                required
              />
            </Field>
            <Field label="Financial categories (one per line)">
              <textarea
                name="categories"
                rows={4}
                defaultValue={old.categories.join("\n")}
                required
              />
            </Field>
            <div className="check-row">
              <label>
                <input
                  type="checkbox"
                  name="inApp"
                  defaultChecked={old.inApp}
                />{" "}
                In-app reminders
              </label>
              <label>
                <input
                  type="checkbox"
                  name="email"
                  defaultChecked={old.email}
                />{" "}
                Email
              </label>
              <label>
                <input type="checkbox" name="push" defaultChecked={old.push} />{" "}
                Web Push
              </label>
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                name="vaccinesApproved"
                defaultChecked={old.vaccinesApproved}
              />{" "}
              Farm veterinarian has approved the vaccination template
            </label>
          </>
        )}
        {type === "house" && (
          <>
            {input("House name", "name")}
            {num("Capacity (birds)", "capacity", 1)}
          </>
        )}
        {type === "flock" && (
          <>
            {input("Flock name", "name")}
            <Field label="Breed">
              <input
                name="breed"
                list="breeds"
                defaultValue={old.breed}
                placeholder="Choose or enter a breed"
                required
              />
              <datalist id="breeds">{options(references.breeds)}</datalist>
            </Field>
            {!existing && (
              <>
                {dateInput}
                <Field label="Set hatch date using">
                  <select
                    value={ageMode}
                    onChange={(e) => setAgeMode(e.target.value)}
                  >
                    <option value="weeks">Age in weeks</option>
                    <option value="group">Age group</option>
                    <option value="date">Known hatch date</option>
                  </select>
                </Field>
              </>
            )}
            {ageMode === "weeks" ? (
              <Field label="Age in weeks at registration">
                <input
                  name="weeks"
                  type="number"
                  min={0}
                  max={520}
                  step={1}
                  defaultValue={
                    existing?.type === "flock"
                      ? Math.floor(age(existing, inputDate) / 7)
                      : 0
                  }
                  required
                />
              </Field>
            ) : ageMode === "group" ? (
              <Field label="Age group (uses its first week to estimate hatch date)">
                <select name="groupWeek">
                  {stageOptions.map((stage, index) => (
                    <option value={stage.week} key={stage.week}>
                      {stage.name} · weeks {stage.week}
                      {stageOptions[index + 1]
                        ? "–" + (stageOptions[index + 1].week - 1)
                        : "+"}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <Field label="Hatch date">
                <input
                  type="date"
                  name="hatch"
                  defaultValue={old.hatch || today}
                  required
                />
              </Field>
            )}
            <Field label="House (optional)">
              <select name="house" defaultValue={old.house} key={scope}>
                <option value="">Unassigned</option>
                {rowsOf(rows, "house")
                  .filter((r) => r.farmId === scope)
                  .map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.data.name} · {h.data.capacity} birds
                    </option>
                  ))}
              </select>
            </Field>
            <div className="form-row">
              {!existing && num("Starting birds", "initial", 1)}
              {num(
                "Purchase cost (" + (settings?.currency || "KES") + ")",
                "cost",
                0,
                ".01",
              )}
            </div>
            {existing && (
              <label className="check-row">
                <input
                  type="checkbox"
                  name="archived"
                  defaultChecked={old.archived}
                />{" "}
                Archive completed flock
              </label>
            )}
          </>
        )}
        {type === "egg" && (
          <>
            {flockSelect(true)}
            {dateInput}
            <div className="form-row">
              <Field label="Collection unit">
                <select value={unit} onChange={(e) => setUnit(e.target.value)}>
                  {options(["Eggs", "Trays"])}
                </select>
              </Field>
              <Field
                label={unit === "Eggs" ? "Eggs collected" : "Trays collected"}
              >
                <input
                  key={unit}
                  name="eggs"
                  type="number"
                  step={unit === "Trays" ? "any" : 1}
                  min={0}
                  defaultValue={
                    unit === "Trays"
                      ? old.eggs / (settings?.traySize || 30)
                      : old.eggs
                  }
                  required
                />
              </Field>
            </div>
            {num("Broken or damaged eggs", "broken")}
          </>
        )}
        {type === "movement" && (
          <>
            {flockSelect(true)}
            {dateInput}
            {linked ? (
              <Field label="Type">
                <input value="Transfer" readOnly />
              </Field>
            ) : (
              kindSelect([
                "Mortality",
                "Addition",
                "Cull",
                "Sale",
                "Transfer",
                "Transfer in",
                "Transfer out",
              ])
            )}
            {kind === "Transfer" && (
              <Field label="Destination flock">
                <select
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  disabled={Boolean(linked)}
                  required
                >
                  <option value="">Select a destination</option>
                  {destinationFlocks.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.data.name} ·{" "}
                      {farms.find((farm) => farm.id === f.farmId)?.data.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {num("Number of birds", "count", 1)}
            {kind === "Mortality" &&
              select("Cause", "cause", causes, old.cause || "Unknown")}
            {notes}
          </>
        )}
        {type === "product" && (
          <>
            {input("Product name", "name")}
            {select(
              "Feed stage",
              "stage",
              stageOptions.map((s) => s.name),
              old.stage,
            )}
            <div className="form-row">
              {num("Bag size (kg)", "bag", 0.01, ".01")}
              {num("Low-stock threshold (kg)", "threshold", 0, ".01")}
            </div>
          </>
        )}
        {type === "stock" && (
          <>
            <Field label="Product">
              <select
                value={currentProduct?.id || ""}
                onChange={(e) => setProduct(e.target.value)}
                required
              >
                <option value="">Select a product</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.data.name}
                  </option>
                ))}
              </select>
            </Field>
            {dateInput}
            {kindSelect(["Consumption", "Purchase", "Adjustment"])}
            {flockSelect(kind === "Consumption")}
            <div className="form-row">
              <Field label="Unit">
                <select value={unit} onChange={(e) => setUnit(e.target.value)}>
                  {options(["kg", "Bags"])}
                </select>
              </Field>
              <Field
                label={kind === "Adjustment" ? "Signed adjustment" : "Quantity"}
              >
                <input
                  key={unit}
                  name="kg"
                  type="number"
                  step="any"
                  min={kind === "Adjustment" ? undefined : ".01"}
                  defaultValue={
                    unit === "Bags"
                      ? old.kg / (currentProduct?.data.bag || 1)
                      : old.kg
                  }
                  required
                />
              </Field>
            </div>
            {kind === "Purchase" &&
              num("Total purchase cost", "cost", 0, ".01")}
            {kind === "Adjustment" ? (
              <Field label="Reason">
                <textarea name="notes" defaultValue={old.notes} required />
              </Field>
            ) : (
              notes
            )}
          </>
        )}
        {type === "money" && (
          <>
            {flockSelect(false)}
            {dateInput}
            {kindSelect(["Income", "Expense"])}
            <Field label="Category">
              <input
                name="category"
                list="categories"
                defaultValue={old.category}
                required
              />
              <datalist id="categories">
                {options(settings?.categories || categories)}
              </datalist>
            </Field>
            {num(
              "Amount (" + (settings?.currency || "KES") + ")",
              "amount",
              0.01,
              ".01",
            )}
            {input("Payment reference (optional)", "reference", false)}
            {notes}
          </>
        )}
        {type === "schedule" && (
          <>
            {flockSelect(true)}
            {kindSelect(["Vaccination", "Feed change"])}
            {input("Name", "name")}
            {dateInput}
            <Field label="Status">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {options(["Pending", "Done", "Skipped"])}
              </select>
            </Field>
            {status === "Done" && (
              <>
                <Field label="Completion date">
                  <input
                    type="date"
                    name="completed"
                    defaultValue={old.completed || today}
                    required
                  />
                </Field>
                {kind === "Vaccination" && (
                  <>
                    {input("Route", "route")}
                    {input("Batch number (optional)", "batch", false)}
                    {input("Dose (optional)", "dose", false)}
                    {num("Cost (optional)", "cost", 0, ".01")}
                  </>
                )}
              </>
            )}
            {notes}
          </>
        )}
        {confirm && (
          <p className="form-warning" role="alert">
            {confirm}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={close}>
            Cancel
          </button>
          <button className="button primary" disabled={pending}>
            {pending ? "Saving…" : confirm ? "Save anyway" : "Save record"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
