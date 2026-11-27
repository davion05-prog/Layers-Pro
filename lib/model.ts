import { z } from "zod";

export const breeds = [
  "ISA Brown",
  "Lohmann Brown",
  "Hy-Line Brown",
  "Novogen Brown",
  "Hendrix/Dekalb White",
  "Kuroiler",
  "Kenbro",
];
export const stages = [
  "Chick mash",
  "Growers mash",
  "Pre-lay mash",
  "Layers mash",
];
export const causes = [
  "Disease",
  "Predator",
  "Heat/cold stress",
  "Accident",
  "Unknown",
  "Other",
];
export const defaultStages = stages.map((name, i) => ({
  name,
  week: [0, 9, 19, 21][i],
}));
export type VaccineTemplate = {
  name: string;
  day: number;
  through?: number;
  repeat?: number;
};
export const defaultVaccines: VaccineTemplate[] = [
  { name: "Marek’s and IBD hatchery record", day: 0 },
  { name: "Newcastle and infectious bronchitis hatchery record", day: 0 },
  { name: "Newcastle and infectious bronchitis review", day: 14, through: 17 },
  { name: "Newcastle review", day: 42, through: 56 },
  { name: "Fowl typhoid review", day: 42, through: 56 },
  { name: "Fowl pox review", day: 56, through: 70 },
  { name: "Fowl cholera review", day: 56, through: 70 },
  { name: "Fowl typhoid follow-up", day: 84, through: 98 },
  {
    name: "Pre-lay Newcastle and infectious bronchitis review",
    day: 112,
    through: 126,
  },
  { name: "Pre-lay fowl cholera review", day: 112, through: 126 },
  { name: "Laying-period booster review", day: 210, repeat: 84 },
];
export const categories = [
  "Egg sales",
  "Spent hen sales",
  "Manure",
  "Feed",
  "Vaccines/meds",
  "Labour",
  "Utilities",
  "Transport",
  "Equipment",
  "Bird purchases",
  "Other",
];
export const typeNames: Record<string, string> = {
  farm: "Farm",
  house: "House",
  flock: "Flock",
  egg: "Egg collection",
  movement: "Bird movement",
  product: "Feed product",
  stock: "Feed transaction",
  money: "Financial entry",
  schedule: "Schedule item",
};
const label = z.string().trim().min(1).max(120);
const note = z.string().trim().max(2000).default("");
const count = z.number().int().min(0).max(1_000_000);
const positiveCount = count.min(1);
const amount = z.number().min(0).max(100_000_000);
const reference = z.string().min(1).max(150);
const date = z.iso.date();
const record = <T extends string, D extends z.ZodType>(type: T, data: D) =>
  z.object({
    id: reference,
    farmId: reference,
    type: z.literal(type),
    date,
    data,
  });

export const rowSchema = z.discriminatedUnion("type", [
  record(
    "farm",
    z.object({
      name: label,
      location: note,
      currency: z.string().regex(/^[A-Z]{3}$/),
      timezone: z.string().refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }),
      traySize: positiveCount,
      lead: count.max(90),
      email: z.boolean(),
      push: z.boolean(),
      inApp: z.boolean(),
      feedStages: z
        .array(z.object({ name: label, week: count.max(150) }))
        .min(1)
        .max(12)
        .refine(
          (items) =>
            items[0].week === 0 &&
            items.every((item, i) => i === 0 || item.week > items[i - 1].week),
        )
        .optional(),
      vaccinesApproved: z.boolean().optional(),
      categories: z.array(label).min(1).max(50).optional(),
    }),
  ),
  record("house", z.object({ name: label, capacity: positiveCount })),
  record(
    "flock",
    z.object({
      name: label,
      breed: label,
      hatch: date,
      house: reference.or(z.literal("")),
      archived: z.boolean(),
      cost: amount,
      initial: positiveCount,
    }),
  ),
  record(
    "egg",
    z
      .object({ flock: reference, eggs: count, broken: count })
      .refine(
        (d) => d.broken <= d.eggs,
        "Broken eggs cannot exceed collected eggs",
      ),
  ),
  record(
    "movement",
    z.object({
      flock: reference,
      kind: z.enum([
        "Addition",
        "Mortality",
        "Cull",
        "Sale",
        "Transfer in",
        "Transfer out",
      ]),
      count: positiveCount,
      cause: note,
      notes: note,
      transfer: z.uuid().optional(),
    }),
  ),
  record(
    "product",
    z.object({
      name: label,
      stage: label,
      bag: amount.positive(),
      threshold: amount,
    }),
  ),
  record(
    "stock",
    z
      .object({
        product: reference,
        flock: reference.or(z.literal("")),
        kind: z.enum(["Purchase", "Consumption", "Adjustment"]),
        kg: z.number().min(-1_000_000).max(1_000_000),
        cost: amount,
        notes: note,
      })
      .refine(
        (d) =>
          d.kind === "Adjustment"
            ? d.kg !== 0 && d.notes.length > 0
            : d.kg > 0 && (d.kind !== "Consumption" || Boolean(d.flock)),
        "Include a valid quantity, flock or adjustment reason",
      ),
  ),
  record(
    "money",
    z.object({
      flock: reference.or(z.literal("")),
      kind: z.enum(["Income", "Expense"]),
      category: label,
      amount: amount.positive(),
      reference: note,
      notes: note,
    }),
  ),
  record(
    "schedule",
    z.object({
      flock: reference,
      name: label,
      kind: z.enum(["Vaccination", "Feed change"]),
      status: z.enum(["Pending", "Done", "Skipped"]),
      completed: date.or(z.literal("")),
      route: note,
      batch: note,
      dose: note,
      cost: amount,
      notes: note,
    }),
  ),
]);
export type Row = z.infer<typeof rowSchema>;
export type Farm = Extract<Row, { type: "farm" }>;
export type RowOf<T extends Row["type"]> = Extract<Row, { type: T }>;
export type Operation = { id: string; row: Row; group?: string };
export const operationSchema = z.object({
  id: z.uuid(),
  row: rowSchema,
  group: z.uuid().optional(),
});
export type Audit = {
  id: string;
  record_id: string;
  changed_at: string;
  previous: Row | null;
  current: Row;
};
export type Notification = {
  id: string;
  farm_id: string;
  message: string;
  created_at: string;
};
export type References = {
  breeds: string[];
  feed: typeof defaultStages;
  vaccines: typeof defaultVaccines;
};
export const defaultReferences = {
  breeds,
  feed: defaultStages,
  vaccines: defaultVaccines,
};
export type Snapshot = {
  rows: Row[];
  audits: Audit[];
  notifications: Notification[];
  references?: References;
  deletionAt?: string;
  admin?: boolean;
  syncedAt?: string;
};

export const rowsOf = <T extends Row["type"]>(rows: Row[], type: T) =>
  rows.filter((r): r is RowOf<T> => r.type === type);
export function dayNow(timeZone = "Africa/Nairobi") {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts();
  return ["year", "month", "day"]
    .map((type) => parts.find((p) => p.type === type)?.value)
    .join("-");
}
export const addDays = (day: string, n: number) =>
  new Date(Date.parse(day) + n * 86_400_000).toISOString().slice(0, 10);
export const daysBetween = (start: string, end: string) =>
  Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000);
export const flockKey = (r: Row) =>
  r.type === "flock" ? r.id : "flock" in r.data ? r.data.flock : "";
export const dateLabel = (day: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(day));
export const fmt = (n: number, digits = 0) =>
  new Intl.NumberFormat("en-KE", { maximumFractionDigits: digits }).format(n);
export const cash = (n: number, currency = "KES") => `${currency} ${fmt(n, 2)}`;
export function population(rows: Row[], flock: RowOf<"flock">, day: string) {
  const movement = rowsOf(rows, "movement").filter(
    (r) => r.data.flock === flock.id && r.date <= day,
  );
  const initial = flock.date <= day ? flock.data.initial : 0;
  return movement.reduce(
    (sum, r) =>
      sum +
      (["Addition", "Transfer in"].includes(r.data.kind)
        ? r.data.count
        : -r.data.count),
    initial,
  );
}
export function age(flock: RowOf<"flock">, day: string) {
  return Math.max(0, daysBetween(flock.data.hatch, day));
}
export function flockStages(
  rows: Row[],
  flock: RowOf<"flock">,
  defaults = defaultStages,
) {
  return (
    rowsOf(rows, "farm").find((r) => r.id === flock.farmId)?.data.feedStages ??
    defaults
  );
}
export function feedStage(
  flock: RowOf<"flock">,
  day: string,
  template = defaultStages,
) {
  return (
    template.findLast((s) => s.week <= Math.floor(age(flock, day) / 7))?.name ??
    template[0].name
  );
}
export function stockBalance(rows: Row[], id: string, until = "9999-12-31") {
  return rowsOf(rows, "stock")
    .filter((r) => r.data.product === id && r.date <= until)
    .reduce(
      (sum, r) =>
        sum + (r.data.kind === "Consumption" ? -r.data.kg : r.data.kg),
      0,
    );
}
export function inventory(
  rows: Row[],
  product: RowOf<"product">,
  today: string,
) {
  const items = rowsOf(rows, "stock")
    .filter((r) => r.data.product === product.id && r.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  let units = 0;
  let averageCost = 0;
  let usage = 0;
  for (const { data, date } of items) {
    if (data.kind === "Purchase") {
      const prior = Math.max(0, units);
      averageCost = (prior * averageCost + data.cost) / (prior + data.kg);
      units += data.kg;
    } else if (data.kind === "Consumption") {
      units -= data.kg;
      if (date >= addDays(today, -6)) usage += data.kg;
    } else units += data.kg;
  }
  return {
    units,
    averageCost,
    usage: usage / 7,
    remaining: usage ? (Math.max(0, units) * 7) / usage : null,
    value: Math.max(0, units) * averageCost,
  };
}
export function financialRows(rows: Row[]): RowOf<"money">[] {
  const generated = rows.flatMap((r): RowOf<"money">[] => {
    const category =
      r.type === "flock"
        ? "Bird purchases"
        : r.type === "stock" && r.data.kind === "Purchase"
          ? "Feed"
          : r.type === "schedule" && r.data.status === "Done"
            ? "Vaccines/meds"
            : "";
    if (!category || !("cost" in r.data) || !r.data.cost) return [];
    const date = r.type === "schedule" ? r.data.completed || r.date : r.date;
    return [
      {
        id: r.id,
        farmId: r.farmId,
        type: "money",
        date,
        data: {
          kind: "Expense",
          category,
          amount: r.data.cost,
          flock: flockKey(r),
          reference: r.id,
          notes: "From " + typeNames[r.type].toLowerCase(),
        },
      },
    ];
  });
  return [...rowsOf(rows, "money"), ...generated];
}
export function scheduleRows(
  rows: Row[],
  today: string,
  references = defaultReferences,
) {
  const saved = rowsOf(rows, "schedule");
  const known = new Set(saved.map((r) => r.id));
  const generated = rowsOf(rows, "flock")
    .filter((f) => !f.data.archived)
    .flatMap((f) => {
      const farm = rowsOf(rows, "farm").find((r) => r.id === f.farmId);
      const options = flockStages(rows, f, references.feed)
        .slice(1)
        .map((s) => ({
          name: s.name,
          day: s.week * 7,
          kind: "Feed change" as const,
        }));
      const vaccines = references.vaccines.flatMap((v) => {
        const limit = Math.max(v.day, daysBetween(f.data.hatch, today) + 365);
        const offsets = v.repeat
          ? Array.from(
              {
                length: Math.min(
                  365,
                  1 + Math.floor((limit - v.day) / v.repeat),
                ),
              },
              (_, i) => v.day + i * v.repeat!,
            )
          : [v.day];
        return offsets.map((day) => ({
          name: v.name,
          day,
          through: v.through,
          kind: "Vaccination" as const,
        }));
      });
      return [...vaccines, ...options]
        .map((s): RowOf<"schedule"> => ({
          id: [
            s.kind === "Vaccination" ? "v" : "f",
            f.id,
            s.day,
            s.name.slice(0, 45),
          ].join(":"),
          farmId: f.farmId,
          date: addDays(f.data.hatch, s.day),
          type: "schedule",
          data: {
            flock: f.id,
            name: s.name,
            kind: s.kind,
            status: "Pending",
            completed: "",
            route: "",
            dose: "",
            batch: "",
            cost: 0,
            notes: [
              s.kind === "Vaccination" && !farm?.data.vaccinesApproved
                ? "Draft · veterinary approval required"
                : "",
              "through" in s && s.through
                ? "Template window through " + addDays(f.data.hatch, s.through)
                : "",
            ]
              .filter(Boolean)
              .join(" · "),
          },
        }))
        .filter((r) => !known.has(r.id));
    });
  return [...saved, ...generated].sort((a, b) => a.date.localeCompare(b.date));
}
export function applyOps(rows: Row[], ops: Operation[]) {
  const map = new Map(rows.map((row) => [row.id, row]));
  for (const op of ops) map.set(op.row.id, op.row);
  return [...map.values()];
}
export function flags(rows: Row[], today: string) {
  return rows
    .filter((r) => {
      if (r.type === "movement") {
        const flock = rowsOf(rows, "flock").find((f) => f.id === r.data.flock);
        return flock && population(rows, flock, r.date) < 0;
      }
      if (r.type === "stock")
        return stockBalance(rows, r.data.product, r.date) < 0;
      return false;
    })
    .filter((r) => r.date <= today);
}
