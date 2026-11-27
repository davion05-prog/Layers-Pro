"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  addDays,
  dateLabel,
  fmt,
  population,
  rowsOf,
  type Row,
  type RowOf,
} from "../lib/model";

export const periods = ["Daily", "Weekly", "Monthly", "Yearly"] as const;
export type Period = (typeof periods)[number];
export type GraphPoint = {
  label: string;
  value: number;
  rate?: number;
  compare?: number;
};
export function ranges(period: Period, start: string, end: string) {
  const max = period === "Daily" ? 7 : period === "Weekly" ? 8 : 6;
  const step = period === "Daily" ? 1 : period === "Weekly" ? 7 : 0;
  return Array.from({ length: max }, (_, i) => {
    const offset = max - 1 - i;
    const date = new Date(end + "T00:00:00Z");
    let from: string, to: string, label: string;
    if (step) {
      to = addDays(end, -offset * step);
      from = addDays(to, -(step - 1));
      label = period === "Daily" && offset === 0 ? "Today" : dateLabel(from);
    } else {
      const y = date.getUTCFullYear();
      const m = date.getUTCMonth();
      const base = new Date(
        Date.UTC(
          y - (period === "Yearly" ? offset : 0),
          period === "Yearly" ? 0 : m - offset,
          1,
        ),
      );
      from = base.toISOString().slice(0, 10);
      to = new Date(
        Date.UTC(
          base.getUTCFullYear(),
          base.getUTCMonth() + (period === "Yearly" ? 12 : 1),
          0,
        ),
      )
        .toISOString()
        .slice(0, 10);
      label =
        period === "Yearly"
          ? String(base.getUTCFullYear())
          : new Intl.DateTimeFormat("en", {
              month: "short",
              timeZone: "UTC",
            }).format(base);
    }
    return {
      from: from > start ? from : start,
      to: to < end ? to : end,
      label,
    };
  }).filter((r) => r.from <= r.to);
}
export function production(
  rows: Row[],
  flocks: RowOf<"flock">[],
  period: Period,
  start: string,
  end: string,
  compare?: string,
): GraphPoint[] {
  const flockMap = new Map(flocks.map((row) => [row.id, row]));
  const trays = new Map(
    rowsOf(rows, "farm").map((row) => [row.id, row.data.traySize]),
  );
  const allEggs = rowsOf(rows, "egg");
  const eggs = allEggs.filter((r) => flockMap.has(r.data.flock));
  const other = compare ? allEggs.filter((r) => r.data.flock === compare) : [];
  const inRange = (date: string, from: string, to: string) =>
    date >= from && date <= to;
  const trayTotal = (items: typeof eggs) =>
    items.reduce((n, r) => n + r.data.eggs / (trays.get(r.farmId) || 30), 0);
  return ranges(period, start, end).map(({ from, to, label }) => {
    const items = eggs.filter((r) => inRange(r.date, from, to));
    const birds = items.reduce(
      (total, r) =>
        total +
        Math.max(0, population(rows, flockMap.get(r.data.flock)!, r.date)),
      0,
    );
    const total = items.reduce((n, r) => n + r.data.eggs, 0);
    return {
      label,
      value: Math.round(trayTotal(items) * 10) / 10,
      rate: birds ? Math.round((total * 1000) / birds) / 10 : 0,
      ...(compare
        ? {
            compare:
              Math.round(
                trayTotal(other.filter((r) => inRange(r.date, from, to))) * 10,
              ) / 10,
          }
        : {}),
    };
  });
}
export function Graph({
  data,
  value,
  rate,
  compare,
  color = "#367c64",
}: {
  data: GraphPoint[];
  value: string;
  rate?: string;
  compare?: string;
  color?: string;
}) {
  return (
    <div className="chart-content">
      <div className="chart-keys">
        <span>
          <i style={{ background: color }} />
          {value}
        </span>
        {rate && (
          <span>
            <i className="line-key" />
            {rate}
          </span>
        )}
        {compare && (
          <span>
            <i style={{ background: "#a9cdb8" }} />
            {compare}
          </span>
        )}
      </div>
      <div
        className="chart"
        aria-label={value + (rate ? " and " + rate : "") + " chart"}
      >
        <ResponsiveContainer
          width="100%"
          height="100%"
          minWidth={0}
          minHeight={220}
          initialDimension={{ width: 680, height: 245 }}
        >
          <ComposedChart
            data={data}
            margin={{ top: 12, right: 0, left: -10, bottom: 3 }}
            barGap={3}
          >
            <CartesianGrid
              vertical={false}
              stroke="#e7ece8"
              strokeDasharray="4 4"
            />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tickMargin={12}
              tick={{ fill: "#64756f", fontSize: 12 }}
            />
            <YAxis
              yAxisId="left"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#64756f", fontSize: 12 }}
              tickFormatter={(n) =>
                n >= 1000 ? fmt(n / 1000, 1) + "k" : String(n)
              }
              width={44}
            />
            {rate && (
              <YAxis
                yAxisId="right"
                orientation="right"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#64756f", fontSize: 12 }}
                tickFormatter={(v) => v + "%"}
                domain={[0, 100]}
                width={42}
              />
            )}
            <Tooltip
              cursor={{ fill: "#eef4ee" }}
              contentStyle={{ border: "1px solid #dce5dd", borderRadius: 12 }}
              formatter={(number, name) => [
                fmt(Number(number), 1) + (name === rate ? "%" : ""),
                name,
              ]}
            />
            <Bar
              yAxisId="left"
              dataKey="value"
              name={value}
              fill={color}
              radius={[5, 5, 0, 0]}
              maxBarSize={45}
            />
            {compare && (
              <Bar
                yAxisId="left"
                dataKey="compare"
                name={compare}
                fill="#a9cdb8"
                radius={[5, 5, 0, 0]}
                maxBarSize={32}
              />
            )}
            {rate && (
              <Line
                yAxisId="right"
                dataKey="rate"
                name={rate}
                stroke="#c38737"
                strokeWidth={2.5}
                dot={{ fill: "#fff", stroke: "#c38737", strokeWidth: 2, r: 3 }}
                activeDot={{ r: 5 }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
