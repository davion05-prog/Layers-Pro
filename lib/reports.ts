import {
  financialRows,
  flockKey,
  population,
  rowsOf,
  scheduleRows,
  type References,
  type Row,
} from "./model";

export const reports = [
  "Egg production",
  "Population",
  "Mortality",
  "Vaccinations",
  "Feed",
  "Finances",
  "Profitability",
] as const;
export type Report = (typeof reports)[number];
export type Filters = {
  farm?: string;
  flock?: string;
  start: string;
  end: string;
};
const round = (n: number) => Math.round(n * 100) / 100;
export function reportData(
  all: Row[],
  report: Report,
  filters: Filters,
  refs?: References,
): (string | number)[][] {
  const { start, end, farm, flock } = filters;
  const scoped = all.filter((r) => !farm || r.farmId === farm);
  const inScope = (r: Row, date = r.date) =>
    (!flock || flockKey(r) === flock) && date >= start && date <= end;
  const flocks = rowsOf(scoped, "flock");
  const name = (id: string) => flocks.find((f) => f.id === id)?.data.name || "";
  const farmName = (id: string) =>
    rowsOf(scoped, "farm").find((f) => f.id === id)?.data.name || "";
  const tray = (id: string) =>
    rowsOf(scoped, "farm").find((f) => f.id === id)?.data.traySize || 30;
  const currency = (id: string) =>
    rowsOf(scoped, "farm").find((f) => f.id === id)?.data.currency || "KES";
  if (report === "Egg production")
    return [
      [
        "Date",
        "Farm",
        "Flock",
        "Eggs collected",
        "Damaged",
        "Trays",
        "Live birds",
        "Hen-day %",
      ],
      ...rowsOf(scoped, "egg")
        .filter((r) => inScope(r))
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((r) => {
          const flockRow = flocks.find((f) => f.id === r.data.flock);
          const birds = flockRow ? population(scoped, flockRow, r.date) : 0;
          return [
            r.date,
            farmName(r.farmId),
            name(r.data.flock),
            r.data.eggs,
            r.data.broken,
            round(r.data.eggs / tray(r.farmId)),
            birds,
            birds > 0 ? round((r.data.eggs * 100) / birds) : "",
          ];
        }),
    ];
  if (report === "Population" || report === "Mortality")
    return [
      ["Date", "Farm", "Flock", "Movement", "Birds", "Cause", "Live birds"],
      ...(report === "Population"
        ? flocks
            .filter((r) => inScope(r))
            .map((r) => [
              r.date,
              farmName(r.farmId),
              r.data.name,
              "Starting count",
              r.data.initial,
              "",
              population(scoped, r, r.date),
            ])
        : []),
      ...rowsOf(scoped, "movement")
        .filter(
          (r) =>
            inScope(r) &&
            (report === "Population" || r.data.kind === "Mortality"),
        )
        .map((r) => {
          const flockRow = flocks.find((f) => f.id === r.data.flock);
          return [
            r.date,
            farmName(r.farmId),
            name(r.data.flock),
            r.data.kind,
            r.data.count,
            r.data.cause,
            flockRow ? population(scoped, flockRow, r.date) : 0,
          ];
        }),
    ];
  if (report === "Vaccinations")
    return [
      [
        "Due date",
        "Farm",
        "Flock",
        "Vaccine",
        "Status",
        "Date given",
        "Route",
        "Batch",
        "Dose",
      ],
      ...scheduleRows(scoped, end, refs)
        .filter((r) => inScope(r) && r.data.kind === "Vaccination")
        .map((r) => [
          r.date,
          farmName(r.farmId),
          name(r.data.flock),
          r.data.name,
          r.data.status,
          r.data.completed,
          r.data.route,
          r.data.batch,
          r.data.dose,
        ]),
    ];
  if (report === "Feed")
    return [
      [
        "Date",
        "Farm",
        "Flock",
        "Product",
        "Transaction",
        "Quantity (kg)",
        "Cost",
        "Currency",
      ],
      ...rowsOf(scoped, "stock")
        .filter((r) => inScope(r))
        .map((r) => [
          r.date,
          farmName(r.farmId),
          name(r.data.flock),
          rowsOf(scoped, "product").find((p) => p.id === r.data.product)?.data
            .name || "",
          r.data.kind,
          r.data.kg,
          r.data.cost,
          currency(r.farmId),
        ]),
    ];
  const money = financialRows(scoped).filter((r) => inScope(r));
  if (report === "Finances")
    return [
      [
        "Date",
        "Farm",
        "Flock",
        "Type",
        "Category",
        "Amount",
        "Currency",
        "Reference",
      ],
      ...money.map((r) => [
        r.date,
        farmName(r.farmId),
        name(r.data.flock),
        r.data.kind,
        r.data.category,
        r.data.amount,
        currency(r.farmId),
        r.data.reference,
      ]),
    ];
  const totals = new Map<string, [string, string, string, number, number]>();
  const farmTotals = new Map<
    string,
    [string, string, string, number, number]
  >();
  for (const r of money) {
    const key = r.farmId + ":" + r.data.flock;
    const group = totals.get(key) ?? [
      farmName(r.farmId),
      name(r.data.flock) || "Farm-wide",
      currency(r.farmId),
      0,
      0,
    ];
    const index = r.data.kind === "Income" ? 3 : 4;
    group[index] += r.data.amount;
    totals.set(key, group);
    const subtotal = farmTotals.get(r.farmId) ?? [
      farmName(r.farmId),
      "Farm total",
      currency(r.farmId),
      0,
      0,
    ];
    subtotal[index] += r.data.amount;
    farmTotals.set(r.farmId, subtotal);
  }
  return [
    ["Farm", "Flock", "Currency", "Income", "Expenses", "Net profit"],
    ...[...(flock ? [] : farmTotals.values()), ...totals.values()].map((r) => [
      ...r.slice(0, 3),
      round(r[3]),
      round(r[4]),
      round(r[3] - r[4]),
    ]),
  ];
}
export function csv(rows: (string | number)[][]) {
  return rows
    .map((row) =>
      row
        .map((value) => {
          let cell = String(value);
          if (typeof value === "string" && /^[\s]*[=+@-]|^[\t\r\n]/.test(cell))
            cell = "'" + cell;
          return '"' + cell.replaceAll('"', '""') + '"';
        })
        .join(","),
    )
    .join("\r\n");
}
