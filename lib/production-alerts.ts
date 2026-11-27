import { addDays, population, rowsOf, type Row, type RowOf } from "./model";

export function layingAlerts(
  rows: Row[],
  flocks: RowOf<"flock">[],
  today: string,
) {
  const records = rowsOf(rows, "egg");
  return flocks.flatMap((flock) => {
    const history = records
      .filter(
        (r) =>
          r.data.flock === flock.id &&
          r.date >= addDays(today, -8) &&
          r.date <= today,
      )
      .sort((a, b) => b.date.localeCompare(a.date));
    const latest = history[0];
    if (!latest || latest.date < addDays(today, -1)) return [];
    const rate = (record: RowOf<"egg">) => {
      const birds = population(rows, flock, record.date);
      return birds > 0 ? (record.data.eggs * 100) / birds : null;
    };
    const current = rate(latest);
    const baseline = history
      .filter((r) => r.date < latest.date && r.date >= addDays(latest.date, -7))
      .map(rate)
      .filter((n) => n !== null);
    const average = baseline.reduce((n, d) => n + d, 0) / baseline.length;
    return current !== null &&
      baseline.length >= 3 &&
      average >= 10 &&
      current <= average - 10
      ? [{ flock, current, average, days: baseline.length, date: latest.date }]
      : [];
  });
}
