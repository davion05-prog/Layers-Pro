"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowDownToLine,
  Bell,
  Building2,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Cloud,
  CloudOff,
  Egg,
  FileText,
  House,
  LayoutDashboard,
  ListChecks,
  Menu,
  Package,
  Plus,
  RefreshCw,
  Settings,
  ShieldCheck,
  Syringe,
  Wallet,
  Wheat,
  X,
} from "lucide-react";
import {
  addDays,
  age,
  applyOps,
  cash,
  dateLabel,
  dayNow,
  daysBetween,
  defaultReferences,
  feedStage,
  financialRows,
  flags,
  flockKey,
  flockStages,
  fmt,
  inventory,
  population,
  rowsOf,
  scheduleRows,
  type Row,
  type RowOf,
} from "../lib/model";
import { csv, reportData, reports, type Report } from "../lib/reports";
import { Editor, type EditorState } from "./editor";
import { Graph, periods, production, ranges, type Period } from "./charts";
import { Admin } from "./admin";
import { Badge, Empty, Field, Logo, Modal, Panel, Table } from "./ui";
import { useWorkspace } from "./workspace-store";
import { session } from "../lib/session";
import { WorkspaceLoading } from "./account-screen";
import { FarmOnboarding } from "./farm-onboarding";

const groups = [
  {
    title: "WORKSPACE",
    links: [
      { name: "Overview", icon: LayoutDashboard },
      { name: "Daily entry", icon: ClipboardList },
      { name: "Flocks", icon: Egg },
      { name: "Schedules", icon: CalendarDays },
    ],
  },
  {
    title: "MANAGEMENT",
    links: [
      { name: "Feed inventory", icon: Package },
      { name: "Finances", icon: Wallet },
      { name: "Reports", icon: ChartNoAxesCombined },
    ],
  },
  {
    title: "PREFERENCES",
    links: [
      { name: "Sync & audit", icon: Cloud },
      { name: "Settings", icon: Settings },
    ],
  },
] as const;
type Tab = (typeof groups)[number]["links"][number]["name"] | "Admin";
const tabDescriptions: Record<Tab, string> = {
  Overview: "Production, flock health and the tasks that need your attention.",
  "Daily entry": "Log collections, bird movements and feed use as they happen.",
  Flocks: "Track bird populations, houses and flock growth.",
  Schedules: "Plan vaccinations and feed changes across your flocks.",
  "Feed inventory": "Track purchases, stock levels and daily consumption.",
  Finances: "Review income, expenses and profitability for this period.",
  Reports: "Review the records behind your farm’s performance.",
  "Sync & audit": "Review unsynced entries, flags and changes to your records.",
  Settings: "Manage farms, account preferences and notification channels.",
  Admin: "Manage platform accounts and shared reference data.",
};
const scheduleIcons = { Vaccination: Syringe, "Feed change": Wheat };
const download = (data: Blob, name: string) => {
  const url = URL.createObjectURL(data);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 3000);
};
const byLatest = (a: Row, b: Row) => b.date.localeCompare(a.date);

export default function Workspace({
  initialDay,
  demo = false,
}: {
  initialDay: string;
  demo?: boolean;
}) {
  const { cache, user, ready, online, syncing, failure, sync, add, logout } =
    useWorkspace(initialDay, demo);
  const [tab, setTab] = useState<Tab>("Overview");
  const [farm, setFarm] = useState(demo ? "greenfield" : "");
  const [flock, setFlock] = useState("");
  const [range, setRange] = useState(30);
  const [period, setPeriod] = useState<Period>("Daily");
  const [drawer, setDrawer] = useState(false);
  const [editor, setEditor] = useState<EditorState>();
  const [newEntry, setNewEntry] = useState(false);
  const [toast, setToast] = useState("");
  const [notifications, setNotifications] = useState(false);
  const [report, setReport] = useState<Report>("Egg production");
  const [comparison, setComparison] = useState("");
  const [scheduleKind, setScheduleKind] = useState("All tasks");
  const [scheduleView, setScheduleView] = useState("List");
  const [monthOffset, setMonthOffset] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [auditRecord, setAuditRecord] = useState<{
    previous: Row | null;
    current: Row;
  }>();
  const [deletionConfirm, setDeletionConfirm] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const refs = cache.snapshot.references ?? defaultReferences;
  const rows = useMemo(
    () => applyOps(cache.snapshot.rows, cache.outbox),
    [cache],
  );
  const farms = rowsOf(rows, "farm");
  const activeFarm = farms.find((f) => f.id === farm);
  const farmId = activeFarm ? farm : "";
  const today = ready ? dayNow(activeFarm?.data.timezone) : initialDay;
  const start = addDays(today, -(range - 1));
  const scoped = farmId ? rows.filter((r) => r.farmId === farmId) : rows;
  const windowed = (r: Row) =>
    r.date >= start && r.date <= today && (!flock || flockKey(r) === flock);
  const farmFlocks = rowsOf(scoped, "flock");
  const activeFlocks = farmFlocks.filter(
    (f) => !f.data.archived && (!flock || f.id === flock),
  );
  const allFlocks = rowsOf(rows, "flock");
  const flockName = (id: string) =>
    allFlocks.find((f) => f.id === id)?.data.name ?? "Farm-wide";
  const farmName = (id: string) =>
    farms.find((f) => f.id === id)?.data.name ?? "Farm";
  const currency =
    activeFarm?.data.currency || farms[0]?.data.currency || "KES";
  const mixed = !farmId && new Set(farms.map((f) => f.data.currency)).size > 1;
  const eggs = rowsOf(scoped, "egg");
  const todayEggs = eggs.filter(
    (r) => r.date === today && activeFlocks.some((f) => f.id === r.data.flock),
  );
  const eggTotal = todayEggs.reduce((a, b) => a + b.data.eggs, 0);
  const liveTotal = activeFlocks.reduce(
    (a, f) => a + Math.max(0, population(scoped, f, today)),
    0,
  );
  const eggBirds = todayEggs.reduce(
    (n, r) =>
      n +
      Math.max(
        0,
        population(
          scoped,
          activeFlocks.find((f) => f.id === r.data.flock)!,
          today,
        ),
      ),
    0,
  );
  const henDay = eggBirds ? (eggTotal * 100) / eggBirds : 0;
  const trayCount = todayEggs.reduce(
    (a, r) =>
      a +
      r.data.eggs / (farms.find((f) => f.id === r.farmId)?.data.traySize || 30),
    0,
  );
  const deaths = rowsOf(scoped, "movement").filter(
    (r) => r.data.kind === "Mortality" && (!flock || r.data.flock === flock),
  );
  const recentDeaths = deaths
    .filter((r) => r.date >= addDays(today, -6) && r.date <= today)
    .reduce((total, r) => total + r.data.count, 0);
  const compareStart = addDays(start, -range);
  const moneyRows = financialRows(scoped).filter(windowed).sort(byLatest);
  const amount = (list: RowOf<"money">[], kind: string) =>
    list
      .filter((r) => r.data.kind === kind)
      .reduce((n, r) => n + r.data.amount, 0);
  const income = amount(moneyRows, "Income"),
    expenses = amount(moneyRows, "Expense"),
    profit = income - expenses;
  const previousMoney = financialRows(scoped).filter(
    (r) =>
      r.date >= compareStart &&
      r.date < start &&
      (!flock || flockKey(r) === flock),
  );
  const previousProfit =
    amount(previousMoney, "Income") - amount(previousMoney, "Expense");
  const products = rowsOf(scoped, "product");
  const stocks = products.map((product) => ({
    product,
    ...inventory(scoped, product, today),
  }));
  const low = stocks.filter((s) => s.units <= s.product.data.threshold);
  const schedules = scheduleRows(scoped, today, refs).filter(
    (r) => !flock || r.data.flock === flock,
  );
  const status = (r: RowOf<"schedule">) => {
    const f = allFlocks.find((f) => f.id === r.data.flock);
    if (r.data.status !== "Pending") return r.data.status;
    if (f && r.date < f.date) return "Before registration";
    const count = daysBetween(today, r.date);
    return count < 0
      ? "Overdue"
      : count === 0
        ? "Due today"
        : count <= (farms.find((f) => f.id === r.farmId)?.data.lead ?? 7)
          ? "Due soon"
          : "Upcoming";
  };
  const relevantSchedules = schedules
    .filter((r) => {
      const f = allFlocks.find((f) => f.id === r.data.flock);
      return (
        r.data.status === "Pending" &&
        !f?.data.archived &&
        r.date >= (f?.date || "") &&
        (r.data.kind === "Vaccination"
          ? r.date >= addDays(today, -21)
          : r.date >= today)
      );
    })
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter(
      (r) =>
        r.date <=
        addDays(today, farms.find((f) => f.id === r.farmId)?.data.lead ?? 7),
    );
  const flagged = flags(scoped, today).filter(
    (r) => !flock || flockKey(r) === flock,
  );
  const inApp = (id: string) => farms.some((f) => f.id === id && f.data.inApp);
  const noticeSchedules = relevantSchedules.filter((r) => inApp(r.farmId));
  const noticeStock = low.filter((s) => inApp(s.product.farmId));
  const alerts = cache.snapshot.notifications.filter((n) => {
    if ((farmId && n.farm_id !== farmId) || !inApp(n.farm_id)) return false;
    return n.id.startsWith("low:")
      ? noticeStock.some((s) => s.product.id === n.id.slice(4))
      : schedules.some((r) => r.id === n.id && r.data.status === "Pending");
  });
  const storedAlerts = new Set(alerts.map((n) => n.id));
  const periodEggs = eggs.filter(windowed);
  const reportLines = reportData(
    rows,
    report,
    { farm: farmId, flock, start, end: today },
    refs,
  );
  const statusText = !online
    ? "Offline"
    : !user
      ? "Demo mode"
      : syncing
        ? "Syncing…"
        : failure
          ? "Needs attention"
          : cache.outbox.length
            ? cache.outbox.length + " pending"
            : "Synced";

  function notice(message: string) {
    setToast(message);
  }
  useEffect(() => {
    if (toast) {
      const timer = window.setTimeout(() => setToast(""), 4000);
      return () => window.clearTimeout(timer);
    }
  }, [toast]);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("tab") === "Schedules") setTab("Schedules");
  }, []);
  useEffect(() => {
    if (ready && !demo && !user) window.location.replace("/login");
  }, [ready, demo, user]);
  const navigate = (next: Tab) => {
    setTab(next);
    setDrawer(false);
    window.scrollTo({ top: 0 });
  };
  function selectFarm(id: string) {
    setFarm(id);
    setFlock("");
    setComparison("");
  }
  function open(type: Row["type"], initial?: string, existing?: Row) {
    if (type !== "farm" && !farms.length) {
      notice("Add your first farm before creating records.");
      setEditor({ type: "farm" });
      return;
    }
    setEditor({ type, existing, initial });
  }
  const edit = (r: Row) => {
    const outgoing =
      r.type === "movement" && r.data.kind === "Transfer in" && r.data.transfer
        ? rowsOf(rows, "movement").find(
            (m) =>
              m.data.transfer === r.data.transfer &&
              m.data.kind === "Transfer out",
          )
        : undefined;
    open(r.type, undefined, outgoing || r);
  };
  const quick = (type: Row["type"], initial?: string) => open(type, initial);
  async function save(row: Row, previous?: Row, companion?: Row) {
    await add(row, previous, companion);
    setEditor(undefined);
    if (row.type === "farm") selectFarm(row.id);
    notice(user ? "Saved on this device" : "Record saved");
  }
  async function accountAction(action: string) {
    try {
      if (action === "logout") {
        await logout();
      } else {
        await session({ action });
        await sync();
        setDeletionConfirm(false);
        notice(
          action === "deletion-request"
            ? "Deletion scheduled in 30 days"
            : "Deletion request cancelled",
        );
      }
    } catch (e) {
      notice((e as Error).message);
    }
  }
  async function enablePush() {
    try {
      const key = process.env.NEXT_PUBLIC_WEB_PUSH_KEY;
      if (!key || !("serviceWorker" in navigator) || !("PushManager" in window))
        throw new Error(
          "Web Push is unavailable on this deployment or browser.",
        );
      if ((await Notification.requestPermission()) !== "granted")
        throw new Error("Browser notification permission is required.");
      const sw = await navigator.serviceWorker.getRegistration();
      if (!sw?.active)
        throw new Error(
          "The installable app is still preparing. Try again shortly.",
        );
      const padded = key
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(Math.ceil(key.length / 4) * 4, "=");
      const existing = await sw.pushManager.getSubscription();
      const subscription =
        existing ??
        (await sw.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: Uint8Array.from(atob(padded), (s) =>
            s.charCodeAt(0),
          ),
        }));
      await session({ action: "push", subscription: subscription.toJSON() });
      notice(
        "Push enabled for this browser. Check your farm’s channel settings.",
      );
    } catch (e) {
      notice((e as Error).message);
    }
  }
  async function exportPdf() {
    setReportBusy(true);
    try {
      const p = new URLSearchParams({
        report,
        farm: farmId,
        flock,
        start,
        end: today,
      });
      const res = await fetch("/api/report?" + p);
      if (!res.ok) throw new Error((await res.json()).error);
      download(await res.blob(), "layers-pro-report.pdf");
    } catch (e) {
      notice((e as Error).message || "PDF export requires a connection.");
    } finally {
      setReportBusy(false);
    }
  }
  const metric = (
    icon: typeof Egg,
    title: string,
    value: ReactNode,
    detail: string,
    color: string,
  ) => {
    const Icon = icon;
    return (
      <div className="metric">
        <div className="metric-top">
          <span className={"metric-icon " + color}>
            <Icon size={19} />
          </span>
          <span>{title}</span>
        </div>
        <strong>{value}</strong>
        <p>{detail}</p>
      </div>
    );
  };
  const actionButton = (label: string, action: () => void, primary = true) => (
    <button
      className={"button " + (primary ? "primary" : "secondary")}
      onClick={action}
    >
      <Plus size={17} />
      {label}
    </button>
  );
  const taskStatus = (task: RowOf<"schedule">) => {
    const state = status(task);
    return (
      <Badge
        tone={
          state === "Overdue"
            ? "red"
            : state.startsWith("Due")
              ? "amber"
              : state === "Done"
                ? "green"
                : ""
        }
      >
        {state}
      </Badge>
    );
  };
  const nextFeedShort = (task: RowOf<"schedule">) =>
    task.data.kind === "Feed change" &&
    !stocks.some(
      (s) =>
        s.product.farmId === task.farmId &&
        s.product.data.stage === task.data.name &&
        s.units > s.product.data.threshold,
    );
  const taskRow = (task: RowOf<"schedule">, quickComplete = false) => {
    const Icon = scheduleIcons[task.data.kind];
    return (
      <div className="list-row" key={task.id}>
        <span
          className={
            "list-icon " +
            (task.data.kind === "Vaccination" ? "lavender" : "leaf")
          }
        >
          <Icon size={18} />
        </span>
        <div className="list-label">
          <strong>{task.data.name}</strong>
          <small>
            {flockName(task.data.flock)} · {dateLabel(task.date)}
            {nextFeedShort(task) ? " · Check feed stock" : ""}
          </small>
        </div>
        {taskStatus(task)}
        {quickComplete && (
          <button
            className="mini-button"
            onClick={() => open("schedule", "Complete", task)}
          >
            Log
          </button>
        )}
      </div>
    );
  };
  const chartToggle = (
    <div className="segments" aria-label="Chart period">
      {periods.map((p) => (
        <button
          key={p}
          aria-pressed={period === p}
          onClick={() => setPeriod(p)}
        >
          {p}
        </button>
      ))}
    </div>
  );
  const chartFlocks = farmFlocks.filter((f) => !flock || f.id === flock);
  const chartData = production(
    scoped,
    chartFlocks,
    period,
    start,
    today,
    comparison,
  );
  const eggDaily = new Map<string, number>();
  for (const r of periodEggs)
    eggDaily.set(r.date, (eggDaily.get(r.date) || 0) + r.data.eggs);
  const totalInPeriod = periodEggs.reduce((n, r) => n + r.data.eggs, 0);
  const bestDay = [...eggDaily].sort((a, b) => b[1] - a[1])[0];
  const mortalityInPeriod = deaths.filter(windowed);
  const mortalTotal = mortalityInPeriod.reduce((n, r) => n + r.data.count, 0);
  const atRisk =
    chartFlocks.reduce(
      (n, f) =>
        n +
        (f.date >= start && f.date <= today
          ? f.data.initial
          : Math.max(0, population(scoped, f, addDays(start, -1)))),
      0,
    ) +
    rowsOf(scoped, "movement")
      .filter(
        (r) =>
          windowed(r) &&
          (r.data.kind === "Addition" || r.data.kind === "Transfer in"),
      )
      .reduce((n, r) => n + r.data.count, 0);
  const mortalityChart = ranges(period, start, today).map((r) => ({
    label: r.label,
    value: mortalityInPeriod
      .filter((m) => m.date >= r.from && m.date <= r.to)
      .reduce((n, m) => n + m.data.count, 0),
    rate: atRisk
      ? (mortalityInPeriod
          .filter((m) => m.date <= r.to)
          .reduce((n, m) => n + m.data.count, 0) *
          100) /
        atRisk
      : 0,
  }));
  const editButton = (r: Row, label = "Edit") => (
    <button className="text-button" onClick={() => edit(r)}>
      {label}
    </button>
  );

  function overview() {
    return (
      <>
        <div className="metric-grid">
          {metric(
            Egg,
            "Active birds",
            fmt(liveTotal),
            activeFlocks.length +
              " active " +
              (activeFlocks.length === 1 ? "flock" : "flocks"),
            "leaf",
          )}
          {metric(
            ClipboardList,
            "Eggs today",
            fmt(eggTotal),
            fmt(trayCount, 1) + " trays · " + fmt(henDay, 1) + "% hen-day",
            "amber",
          )}
          {metric(
            Activity,
            "7-day mortality",
            fmt(recentDeaths),
            "Birds lost in the last 7 days",
            "rose",
          )}
          {metric(
            Wallet,
            "Net profit",
            mixed ? "Mixed currencies" : cash(profit, currency),
            "Last " + range + " days",
            "lavender",
          )}
        </div>
        <Panel
          title="Egg production"
          description="Trays collected and hen-day laying rate"
          action={chartToggle}
          className="production-panel"
        >
          <Graph data={chartData} value="Trays collected" rate="Hen-day rate" />
        </Panel>
        <div className="lower-grid">
          <Panel
            title="Upcoming tasks"
            description="Vaccinations and feed changes"
            action={
              <button
                className="text-button"
                onClick={() => navigate("Schedules")}
              >
                View schedule <ChevronRight size={15} />
              </button>
            }
          >
            {relevantSchedules.length ? (
              <div className="list">
                {relevantSchedules.slice(0, 4).map((r) => taskRow(r, true))}
              </div>
            ) : (
              <Empty>No due tasks for this selection.</Empty>
            )}
          </Panel>
          <Panel
            title="Feed stock"
            description="Products at or below their stock threshold"
            action={
              <button
                className="text-button"
                onClick={() => navigate("Feed inventory")}
              >
                View inventory <ChevronRight size={15} />
              </button>
            }
          >
            {low.length ? (
              <div className="list">
                {low.slice(0, 4).map((s) => (
                  <div className="list-row" key={s.product.id}>
                    <span className="list-icon amber">
                      <Package size={18} />
                    </span>
                    <div className="list-label">
                      <strong>{s.product.data.name}</strong>
                      <small>
                        {fmt(s.units, 1)} kg remaining
                        {s.remaining !== null
                          ? " · " + fmt(s.remaining, 1) + " days left"
                          : ""}
                      </small>
                    </div>
                    <Badge tone={s.units < 0 ? "red" : "amber"}>
                      {s.units < 0 ? "Needs review" : "Low stock"}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <Empty>No low-stock warnings.</Empty>
            )}
          </Panel>
        </div>
      </>
    );
  }

  const entryChoices = (
    <div className="quick-grid">
      {(
        [
          {
            icon: Egg,
            title: "Record eggs",
            sub: "Eggs, trays and damaged counts",
            type: "egg",
            tone: "amber",
          },
          {
            icon: Activity,
            title: "Log mortality",
            sub: "Deaths and causes by flock",
            type: "movement",
            tone: "rose",
          },
          {
            icon: Wheat,
            title: "Log feed use",
            sub: "Consumption in kg or bags",
            type: "stock",
            tone: "leaf",
          },
          {
            icon: Wallet,
            title: "Add transaction",
            sub: "Income and expenses",
            type: "money",
            tone: "lavender",
          },
        ] as const
      ).map(({ icon: Icon, title, sub, type, tone }) => (
        <button
          className="quick-card"
          key={type}
          onClick={() => {
            setNewEntry(false);
            quick(type);
          }}
        >
          <span className={"metric-icon " + tone}>
            <Icon size={21} />
          </span>
          <strong>{title}</strong>
          <small>{sub}</small>
          <Plus className="quick-plus" size={19} />
        </button>
      ))}
    </div>
  );

  function daily() {
    const entries = scoped
      .filter(
        (r) =>
          ["egg", "movement", "stock", "money"].includes(r.type) && windowed(r),
      )
      .sort(byLatest);
    return (
      <>
        {entryChoices}
        <Panel
          title="Daily records"
          description="Review or correct entries for this period"
        >
          <Table
            headers={["Date", "Entry", "Flock", "Summary", ""]}
            rows={entries.map((r) => [
              dateLabel(r.date),
              r.type === "egg"
                ? "Egg collection"
                : r.type === "money" ||
                    r.type === "stock" ||
                    r.type === "movement"
                  ? r.data.kind
                  : "",
              flockName(flockKey(r)),
              r.type === "egg"
                ? fmt(r.data.eggs) + " eggs · " + r.data.broken + " damaged"
                : r.type === "movement"
                  ? fmt(r.data.count) + " birds"
                  : r.type === "stock"
                    ? fmt(r.data.kg, 2) + " kg"
                    : r.type === "money"
                      ? cash(
                          r.data.amount,
                          farms.find((f) => f.id === r.farmId)?.data.currency,
                        )
                      : "",
              editButton(r),
            ])}
          />
        </Panel>
      </>
    );
  }

  function flocksPage() {
    const listing = farmFlocks.filter(
      (f) => (showArchived || !f.data.archived) && (!flock || f.id === flock),
    );
    const houses = rowsOf(scoped, "house");
    const movements = rowsOf(scoped, "movement")
      .filter(windowed)
      .sort(byLatest);
    return (
      <>
        <Panel
          title="Flock register"
          action={
            <label className="check-row">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />{" "}
              Show archived
            </label>
          }
        >
          <Table
            headers={[
              "Flock / farm",
              "Breed",
              "Age",
              "Feed stage",
              "Live birds",
              "Status",
              "",
            ]}
            rows={listing.map((f) => [
              <span className="table-stack" key={f.id}>
                <strong>{f.data.name}</strong>
                <small>
                  {farmName(f.farmId)}
                  {f.data.house
                    ? " · " +
                      houses.find((h) => h.id === f.data.house)?.data.name
                    : ""}
                </small>
              </span>,
              f.data.breed,
              Math.floor(age(f, today) / 7) +
                " wks · " +
                age(f, today) +
                " days",
              feedStage(f, today, flockStages(scoped, f, refs.feed)),
              fmt(population(scoped, f, today)),
              <Badge key={f.id} tone={f.data.archived ? "" : "green"}>
                {f.data.archived ? "Archived" : "Active"}
              </Badge>,
              editButton(f),
            ])}
          />
        </Panel>
        <div className="lower-grid">
          <Panel
            title="Population ledger"
            description="Starting counts and recorded movements"
            action={actionButton(
              "Movement",
              () => quick("movement", "Addition"),
              false,
            )}
          >
            <Table
              headers={["Date", "Flock", "Movement", "Birds", ""]}
              rows={[
                ...movements.map((r) => [
                  dateLabel(r.date),
                  flockName(r.data.flock),
                  r.data.kind,
                  r.data.count,
                  editButton(r),
                ]),
                ...listing
                  .filter(windowed)
                  .map((r) => [
                    dateLabel(r.date),
                    r.data.name,
                    "Starting count",
                    r.data.initial,
                    "",
                  ]),
              ]}
            />
          </Panel>
          <Panel
            title="Poultry houses"
            action={actionButton("Add house", () => quick("house"), false)}
          >
            <Table
              headers={["House", "Farm", "Capacity", ""]}
              rows={houses.map((h) => [
                h.data.name,
                farmName(h.farmId),
                fmt(h.data.capacity),
                editButton(h),
              ])}
            />
          </Panel>
        </div>
        <Panel
          title="Mortality"
          description={
            fmt(mortalTotal) +
            " deaths · " +
            fmt(atRisk ? (mortalTotal * 100) / atRisk : 0, 2) +
            "% of birds at risk"
          }
          action={chartToggle}
        >
          <Graph
            data={mortalityChart}
            value="Deaths"
            rate="Cumulative mortality"
            color="#bd765f"
          />
          <div className="cause-list">
            {[...new Set(mortalityInPeriod.map((r) => r.data.cause))].map(
              (c) => (
                <Badge key={c}>
                  {c || "Unknown"} ·{" "}
                  {mortalityInPeriod
                    .filter((r) => r.data.cause === c)
                    .reduce((n, r) => n + r.data.count, 0)}
                </Badge>
              ),
            )}
          </div>
        </Panel>
      </>
    );
  }

  function schedulesPage() {
    const selected = schedules.filter(
      (r) =>
        (scheduleKind === "All tasks" || r.data.kind === scheduleKind) &&
        (showHistory ||
          (r.data.status === "Pending" &&
            status(r) !== "Before registration" &&
            r.date >= addDays(today, -30))),
    );
    const now = new Date(today + "T00:00:00Z");
    const month = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, 1),
    );
    const monthName = new Intl.DateTimeFormat("en-KE", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(month);
    const monthStart = month.toISOString().slice(0, 10);
    const days = new Date(
      Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0),
    ).getUTCDate();
    const gaps = (month.getUTCDay() + 6) % 7;
    return (
      <Panel
        title="Flock schedules"
        description="Confirm draft vaccination dates with your farm veterinarian."
        action={
          <div className="segments">
            {["List", "Calendar"].map((v) => (
              <button
                key={v}
                aria-pressed={scheduleView === v}
                onClick={() => setScheduleView(v)}
              >
                {v}
              </button>
            ))}
          </div>
        }
      >
        <div className="inline-filters">
          <select
            aria-label="Schedule type"
            value={scheduleKind}
            onChange={(e) => setScheduleKind(e.target.value)}
          >
            {["All tasks", "Vaccination", "Feed change"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
          <label className="check-row">
            <input
              type="checkbox"
              checked={showHistory}
              onChange={(e) => setShowHistory(e.target.checked)}
            />{" "}
            Include completed and pre-registration tasks
          </label>
        </div>
        {scheduleView === "List" ? (
          <Table
            headers={["Due date", "Task", "Flock", "Status", ""]}
            rows={selected.map((r) => [
              dateLabel(r.date),
              <span className="table-stack" key={r.id}>
                <strong>{r.data.name}</strong>
                <small>
                  {r.data.kind}
                  {r.data.notes ? " · " + r.data.notes : ""}
                  {r.data.status === "Pending" && nextFeedShort(r)
                    ? " · Check feed stock"
                    : ""}
                </small>
              </span>,
              flockName(r.data.flock),
              taskStatus(r),
              <div className="row-actions" key={r.id}>
                {editButton(r)}
                {r.data.status === "Pending" && (
                  <button
                    className="mini-button"
                    onClick={() => open("schedule", "Complete", r)}
                  >
                    Log
                  </button>
                )}
              </div>,
            ])}
          />
        ) : (
          <>
            <div className="month-head">
              <button
                className="mini-button"
                onClick={() => setMonthOffset((x) => x - 1)}
              >
                Previous
              </button>
              <strong>{monthName}</strong>
              <button
                className="mini-button"
                onClick={() => setMonthOffset((x) => x + 1)}
              >
                Next
              </button>
            </div>
            <div className="calendar">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                <div key={d} className="calendar-label">
                  {d}
                </div>
              ))}
              {Array.from({ length: gaps }, (_, i) => (
                <div key={"gap" + i} className="calendar-gap" />
              ))}
              {Array.from({ length: days }, (_, i) => {
                const day = addDays(monthStart, i);
                return (
                  <div key={day} className={day === today ? "cal-today" : ""}>
                    <strong>{i + 1}</strong>
                    {selected
                      .filter((r) => r.date === day)
                      .map((r) => (
                        <button
                          onClick={() => edit(r)}
                          key={r.id}
                          title={r.data.name}
                        >
                          {r.data.name}
                        </button>
                      ))}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Panel>
    );
  }

  function inventoryPage() {
    const transactions = rowsOf(scoped, "stock")
      .filter(windowed)
      .sort(byLatest);
    const consumed = transactions.filter((r) => r.data.kind === "Consumption");
    const consumptionKg = consumed.reduce((n, r) => n + r.data.kg, 0);
    const birdDays = new Map<string, number>();
    for (const c of consumed) {
      const f = farmFlocks.find((r) => r.id === c.data.flock);
      if (f)
        birdDays.set(
          f.id + ":" + c.date,
          Math.max(0, population(scoped, f, c.date)),
        );
    }
    const birdCount = [...birdDays.values()].reduce((n, value) => n + value, 0);
    const cost = consumed.reduce((n, c) => {
      const product = products.find((p) => p.id === c.data.product);
      return (
        n +
        (product
          ? inventory(scoped, product, c.date).averageCost * c.data.kg
          : 0)
      );
    }, 0);
    const trays = periodEggs.reduce(
      (n, r) =>
        n +
        r.data.eggs /
          (farms.find((f) => f.id === r.farmId)?.data.traySize || 30),
      0,
    );
    return (
      <>
        <div className="metric-grid three">
          {metric(
            Package,
            "Feed consumed",
            fmt(consumptionKg, 1) + " kg",
            "Within the selected period",
            "leaf",
          )}
          {metric(
            Wheat,
            "Feed per bird",
            birdCount ? fmt((consumptionKg * 1000) / birdCount, 1) + " g" : "—",
            "Per bird per logged day",
            "amber",
          )}
          {metric(
            Wallet,
            "Feed cost per tray",
            mixed || !trays ? "—" : cash(cost / trays, currency),
            "Estimated from weighted cost",
            "lavender",
          )}
        </div>
        <Panel
          title="Feed products"
          description="Stock, estimated depletion and weighted-average valuation"
          action={actionButton("Add product", () => quick("product"), false)}
        >
          <Table
            headers={["Product", "Stock", "Days left", "Value", "Status", ""]}
            rows={stocks.map((s) => [
              <span key={s.product.id} className="table-stack">
                <strong>{s.product.data.name}</strong>
                <small>
                  {farmName(s.product.farmId)} · {s.product.data.bag} kg bags
                </small>
              </span>,
              fmt(s.units, 2) + " kg",
              s.remaining === null ? "—" : fmt(s.remaining, 1),
              cash(
                s.value,
                farms.find((f) => f.id === s.product.farmId)?.data.currency,
              ),
              <Badge
                key={s.product.id}
                tone={
                  s.units < 0
                    ? "red"
                    : s.units <= s.product.data.threshold
                      ? "amber"
                      : "green"
                }
              >
                {s.units < 0
                  ? "Needs review"
                  : s.units <= s.product.data.threshold
                    ? "Low"
                    : "In stock"}
              </Badge>,
              editButton(s.product),
            ])}
          />
        </Panel>
        <Panel
          title="Stock ledger"
          description="Purchases, consumption and stock adjustments"
        >
          <Table
            headers={["Date", "Product", "Type", "Quantity", "Cost", ""]}
            rows={transactions.map((r) => [
              dateLabel(r.date),
              products.find((p) => p.id === r.data.product)?.data.name,
              r.data.kind,
              fmt(r.data.kg, 2) + " kg",
              r.data.cost
                ? cash(
                    r.data.cost,
                    farms.find((f) => f.id === r.farmId)?.data.currency,
                  )
                : "—",
              editButton(r),
            ])}
          />
        </Panel>
      </>
    );
  }

  function financesPage() {
    const financeChart = ranges(period, start, today).map((r) => {
      const items = moneyRows.filter((m) => m.date >= r.from && m.date <= r.to);
      return {
        label: r.label,
        value: amount(items, "Income"),
        compare: amount(items, "Expense"),
      };
    });
    return (
      <>
        <div className="metric-grid three">
          {metric(
            Wallet,
            "Income",
            mixed ? "Mixed currencies" : cash(income, currency),
            "Selected period",
            "leaf",
          )}
          {metric(
            ClipboardList,
            "Expenses",
            mixed ? "Mixed currencies" : cash(expenses, currency),
            "Selected period",
            "amber",
          )}
          {metric(
            ChartNoAxesCombined,
            "Net profit",
            mixed ? "Mixed currencies" : cash(profit, currency),
            mixed
              ? "Choose a farm to compare periods"
              : cash(profit - previousProfit, currency) +
                  " change vs prior period",
            "lavender",
          )}
        </div>
        {!mixed && (
          <Panel title="Income vs expenses" action={chartToggle}>
            <Graph data={financeChart} value="Income" compare="Expenses" />
          </Panel>
        )}
        <Panel title="Profitability by farm and flock">
          <Table
            headers={[
              "Farm",
              "Flock",
              "Currency",
              "Income",
              "Expenses",
              "Net profit",
            ]}
            rows={reportData(
              rows,
              "Profitability",
              { farm: farmId, flock, start, end: today },
              refs,
            ).slice(1)}
          />
        </Panel>
        <Panel
          title="Transaction ledger"
          description="Includes expenses generated by flock, feed and vaccination records"
        >
          <Table
            headers={["Date", "Category", "Farm / flock", "Type", "Amount", ""]}
            rows={moneyRows.map((r) => [
              dateLabel(r.date),
              r.data.category,
              farmName(r.farmId) + " · " + flockName(r.data.flock),
              r.data.kind,
              cash(
                r.data.amount,
                farms.find((f) => f.id === r.farmId)?.data.currency,
              ),
              rows.some((x) => x.id === r.id && x.type === "money") ? (
                editButton(r)
              ) : (
                <small key={r.id}>Automatic</small>
              ),
            ])}
          />
        </Panel>
      </>
    );
  }

  function reportsPage() {
    return (
      <Panel
        title="Report preview"
        description={dateLabel(start) + " to " + dateLabel(today)}
        action={
          <div className="row-actions">
            <button
              className="button secondary"
              onClick={() =>
                download(
                  new Blob(["\uFEFF", csv(reportLines)], {
                    type: "text/csv;charset=utf-8",
                  }),
                  "layers-pro-report.csv",
                )
              }
            >
              <ArrowDownToLine size={16} /> CSV
            </button>
            <button
              className="button secondary"
              disabled={!online || !user || reportBusy}
              title={!user ? "Sign in to generate a server PDF" : ""}
              onClick={exportPdf}
            >
              <FileText size={16} /> {reportBusy ? "Generating…" : "PDF"}
            </button>
          </div>
        }
      >
        <div className="inline-filters">
          <select
            aria-label="Report"
            value={report}
            onChange={(e) => setReport(e.target.value as Report)}
          >
            {reports.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          {report === "Egg production" && (
            <select
              aria-label="Overlay comparison flock"
              value={comparison}
              onChange={(e) => setComparison(e.target.value)}
            >
              <option value="">Compare a flock</option>
              {farmFlocks
                .filter((f) => f.id !== flock)
                .map((f) => (
                  <option value={f.id} key={f.id}>
                    {f.data.name}
                  </option>
                ))}
            </select>
          )}
        </div>
        {report === "Egg production" && (
          <>
            <div className="report-summary">
              <Badge tone="green">{fmt(totalInPeriod)} eggs total</Badge>
              <Badge>
                {fmt(eggDaily.size ? totalInPeriod / eggDaily.size : 0, 1)} eggs
                / recorded day
              </Badge>
              <Badge>
                {bestDay
                  ? "Best day · " +
                    dateLabel(bestDay[0]) +
                    " · " +
                    fmt(bestDay[1]) +
                    " eggs"
                  : "No best day yet"}
              </Badge>
              {chartToggle}
            </div>
            <Graph
              data={chartData}
              value="Total trays"
              rate="Hen-day rate"
              compare={
                comparison ? flockName(comparison) + " trays" : undefined
              }
            />
          </>
        )}
        <Table
          headers={reportLines[0].map(String)}
          rows={reportLines.slice(1)}
        />
      </Panel>
    );
  }

  function syncPage() {
    return (
      <>
        <Panel
          title="Sync status"
          description={
            cache.snapshot.syncedAt
              ? "Last synced " +
                new Date(cache.snapshot.syncedAt).toLocaleString("en-KE")
              : "Records are stored on this device"
          }
          action={
            <button
              className="button secondary"
              disabled={!user || !online || syncing}
              onClick={() => void sync()}
            >
              <RefreshCw size={16} /> Sync now
            </button>
          }
        >
          {failure && (
            <p className="form-warning">
              {failure}{" "}
              <Link className="text-button" href="/login">
                Open login
              </Link>
            </p>
          )}
          <Table
            headers={["Date", "Type", "Farm", "Status", ""]}
            rows={cache.outbox
              .filter((x) => !farmId || x.row.farmId === farmId)
              .map(({ row }) => [
                dateLabel(row.date),
                row.type,
                farmName(row.farmId),
                <Badge key={row.id} tone="amber">
                  Waiting to sync
                </Badge>,
                editButton(row, "Review"),
              ])}
          />
        </Panel>
        <Panel
          title="Flagged entries"
          description="Entries that leave a negative population or stock balance"
        >
          <Table
            headers={["Date", "Record", "Farm", ""]}
            rows={flagged.map((r) => [
              dateLabel(r.date),
              r.type === "stock" ? "Negative stock" : "Negative bird count",
              farmName(r.farmId),
              editButton(r, "Review"),
            ])}
          />
        </Panel>
        <Panel
          title="Audit history"
          description="Original values are kept when entries are updated"
        >
          <Table
            headers={["Changed", "Type", "Operation", ""]}
            rows={cache.snapshot.audits
              .filter(
                (a) =>
                  (!farmId || a.current.farmId === farmId) &&
                  (!flock || flockKey(a.current) === flock),
              )
              .map((a) => [
                new Date(a.changed_at).toLocaleString("en-KE"),
                a.current.type,
                a.previous ? "Updated" : "Created",
                <button
                  className="text-button"
                  key={a.id}
                  onClick={() => setAuditRecord(a)}
                >
                  View changes
                </button>,
              ])}
          />
        </Panel>
      </>
    );
  }
  function settingsPage() {
    return (
      <>
        <Panel
          title="Farms"
          description="Manage farm defaults, financial categories and reminder preferences"
        >
          <Table
            headers={[
              "Farm",
              "Location",
              "Timezone",
              "Currency",
              "Tray size",
              "",
            ]}
            rows={farms
              .filter((f) => !farmId || f.id === farmId)
              .map((f) => [
                f.data.name,
                f.data.location || "—",
                f.data.timezone,
                f.data.currency,
                f.data.traySize + " eggs",
                editButton(f),
              ])}
          />
        </Panel>
        <Panel
          title="Account & privacy"
          description={
            user?.email || "This demo uses sample data stored on this device."
          }
        >
          <div className="settings-actions">
            {user ? (
              <>
                <button
                  className="button secondary"
                  onClick={() => void enablePush()}
                >
                  <Bell size={16} /> Enable device notifications
                </button>
                <button
                  className="button secondary"
                  onClick={() =>
                    download(
                      new Blob(
                        [
                          JSON.stringify(
                            { ...cache.snapshot, rows, pending: cache.outbox },
                            null,
                            2,
                          ),
                        ],
                        { type: "application/json" },
                      ),
                      "layers-pro-account.json",
                    )
                  }
                >
                  <ArrowDownToLine size={16} /> Export all data
                </button>
                {cache.snapshot.deletionAt ? (
                  <button
                    className="button secondary"
                    onClick={() => void accountAction("deletion-cancel")}
                  >
                    Cancel deletion on{" "}
                    {dateLabel(cache.snapshot.deletionAt.slice(0, 10))}
                  </button>
                ) : (
                  <button
                    className="button danger"
                    onClick={() => setDeletionConfirm(true)}
                  >
                    Request account deletion
                  </button>
                )}
                <button
                  className="button secondary"
                  onClick={() => void accountAction("logout")}
                >
                  Sign out
                </button>
              </>
            ) : (
              <Link className="button primary" href="/login">
                Log in
              </Link>
            )}
          </div>
        </Panel>
      </>
    );
  }
  const renders: Record<Tab, () => ReactNode> = {
    Overview: overview,
    "Daily entry": daily,
    Flocks: flocksPage,
    Schedules: schedulesPage,
    "Feed inventory": inventoryPage,
    Finances: financesPage,
    Reports: reportsPage,
    "Sync & audit": syncPage,
    Settings: settingsPage,
    Admin: () => <Admin />,
  };
  const btn =
    tab === "Overview"
      ? actionButton("New entry", () => setNewEntry(true))
      : tab === "Flocks"
        ? actionButton("Add flock", () => quick("flock"))
        : tab === "Schedules"
          ? actionButton("Add task", () => quick("schedule"))
          : tab === "Feed inventory"
            ? actionButton("Log transaction", () => quick("stock", "Purchase"))
            : tab === "Finances"
              ? actionButton("New transaction", () => quick("money"))
              : tab === "Settings"
                ? actionButton("Add farm", () => quick("farm"))
                : null;
  const readableDate = new Intl.DateTimeFormat("en-KE", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(today));
  if (!demo && (!ready || !user)) return <WorkspaceLoading />;
  if (!demo && user && !farms.length) {
    return (
      <FarmOnboarding
        date={today}
        email={user.email}
        syncError={failure}
        save={save}
        logout={logout}
      />
    );
  }
  return (
    <div className="shell">
      {drawer && (
        <button
          className="overlay"
          aria-label="Close navigation"
          onClick={() => setDrawer(false)}
        />
      )}
      <aside className={"sidebar " + (drawer ? "sidebar-open" : "")}>
        <button className="brand-button" onClick={() => navigate("Overview")}>
          <Logo />
        </button>
        <div className="farm-picker">
          <span className="farm-icon">
            <Building2 size={18} />
          </span>
          <div>
            <small>FARM WORKSPACE</small>
            <strong>{activeFarm?.data.name || "All farms"}</strong>
          </div>
          <ChevronDown size={15} />
          <select
            aria-label="Switch farm"
            value={farmId}
            onChange={(e) => selectFarm(e.target.value)}
          >
            <option value="">All farms</option>
            {farms.map((f) => (
              <option value={f.id} key={f.id}>
                {f.data.name}
              </option>
            ))}
          </select>
        </div>
        <nav aria-label="Main navigation">
          {groups.map((group) => (
            <div className="nav-group" key={group.title}>
              <p>{group.title}</p>
              {group.links.map(({ name, icon: Icon }) => (
                <button
                  className={tab === name ? "nav-active" : ""}
                  aria-current={tab === name ? "page" : undefined}
                  onClick={() => navigate(name)}
                  key={name}
                >
                  <Icon size={19} />
                  <span>{name}</span>
                </button>
              ))}
            </div>
          ))}
          {cache.snapshot.admin && (
            <div className="nav-group">
              <button
                className={tab === "Admin" ? "nav-active" : ""}
                onClick={() => navigate("Admin")}
              >
                <ShieldCheck size={19} /> Admin
              </button>
            </div>
          )}
        </nav>
        <div className="sidebar-bottom">
          <button className="sidebar-help" onClick={() => navigate("Settings")}>
            <CircleHelp size={19} /> Account & help
          </button>
          <button
            className="profile"
            onClick={() =>
              user ? navigate("Settings") : window.location.assign("/login")
            }
          >
            <span className="avatar">
              {user ? user.email.slice(0, 2).toUpperCase() : "LP"}
            </span>
            <span>
              <strong>
                {user ? user.email.split("@")[0] : "Demo workspace"}
              </strong>
              <small>{user ? "Farm account" : "Sign in to sync"}</small>
            </span>
            <ChevronRight size={16} />
          </button>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setDrawer(true)}
            >
              <Menu size={21} />
            </button>
            <House size={16} className="home-icon" />
            <span className="workspace-label">Workspace</span>
            <ChevronRight size={14} />
            <strong>{tab}</strong>
          </div>
          <div className="top-actions">
            <button
              className={
                "sync-pill " + (!online || failure ? "sync-warning" : "")
              }
              onClick={() => navigate("Sync & audit")}
            >
              {online ? <Cloud size={15} /> : <CloudOff size={15} />}
              <span>{statusText}</span>
            </button>
            <button
              className="icon-button bell-button"
              title="Notifications"
              aria-label="Notifications"
              onClick={() => setNotifications(true)}
            >
              <Bell size={20} />
              {(alerts.length > 0 ||
                noticeSchedules.length > 0 ||
                noticeStock.length > 0) && <i />}
            </button>
            {user ? (
              <button
                className="top-avatar"
                aria-label="Account settings"
                onClick={() => navigate("Settings")}
              >
                {user.email.slice(0, 2).toUpperCase()}
              </button>
            ) : (
              <Link className="button primary" href="/login">
                Log in
              </Link>
            )}
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div className="heading-content">
              <div className="heading-date">
                <CalendarDays size={15} />
                {readableDate}
              </div>
              <h1>{tab === "Overview" ? "Farm overview" : tab}</h1>
              <p>{tabDescriptions[tab]}</p>
            </div>
            <div className="heading-action">{btn}</div>
          </div>
          {tab !== "Admin" && (
            <div className="scope">
              <div className="scope-farm">
                <span className="scope-icon">
                  <Building2 size={18} />
                </span>
                <div>
                  <strong>
                    {activeFarm?.data.name ||
                      (farms.length ? "All farms" : "Your workspace")}
                  </strong>
                  <small>
                    {activeFarm?.data.location ||
                      (farms.length
                        ? farms.length + " farms"
                        : "Set up a farm to get started")}
                  </small>
                </div>
              </div>
              <div className="filters">
                <label>
                  <span className="sr-only">Flock</span>
                  <select
                    value={flock}
                    onChange={(e) => {
                      setFlock(e.target.value);
                      setComparison("");
                    }}
                  >
                    <option value="">All flocks</option>
                    {farmFlocks.map((f) => (
                      <option value={f.id} key={f.id}>
                        {f.data.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="range-filter">
                  <CalendarDays size={15} />
                  <span className="sr-only">Date range</span>
                  <select
                    value={range}
                    onChange={(e) => setRange(Number(e.target.value))}
                  >
                    <option value={7}>Last 7 days</option>
                    <option value={30}>Last 30 days</option>
                    <option value={90}>Last 90 days</option>
                    <option value={365}>Last year</option>
                    <option value={1825}>Last 5 years</option>
                  </select>
                </label>
              </div>
            </div>
          )}
          {user && !farmFlocks.length && tab === "Overview" && (
            <Panel
              title="Register your first flock"
              description="Add your birds to start recording egg production and flock activity."
              action={actionButton("Add flock", () => quick("flock"))}
            >
              <div />
            </Panel>
          )}
          {renders[tab]()}
          <footer>
            <span>Layers Pro</span>
            <span>
              {user
                ? "Farm management workspace"
                : "School project · Demo data"}
            </span>
          </footer>
        </main>
      </div>

      {newEntry && (
        <Modal title="New entry" onClose={() => setNewEntry(false)}>
          {entryChoices}
        </Modal>
      )}
      {editor && (
        <Editor
          editor={editor}
          rows={rows}
          farm={farmId}
          flock={flock}
          today={today}
          references={refs}
          close={() => setEditor(undefined)}
          save={save}
        />
      )}
      {notifications && (
        <Modal title="Notifications" onClose={() => setNotifications(false)}>
          {alerts.length || noticeSchedules.length || noticeStock.length ? (
            <div className="list">
              {alerts.map((n) => (
                <div className="list-row" key={n.id}>
                  <Bell size={17} />
                  <div className="list-label">
                    <strong>{n.message}</strong>
                    <small>{farmName(n.farm_id)}</small>
                  </div>
                </div>
              ))}
              {noticeSchedules
                .filter((r) => !storedAlerts.has(r.id))
                .map((r) => taskRow(r))}
              {noticeStock
                .filter((s) => !storedAlerts.has("low:" + s.product.id))
                .map((s) => (
                  <div className="list-row" key={s.product.id}>
                    <Package size={17} />
                    <div className="list-label">
                      <strong>{s.product.data.name}</strong>
                      <small>{fmt(s.units, 1)} kg remaining</small>
                    </div>
                    <Badge tone="amber">Low stock</Badge>
                  </div>
                ))}
            </div>
          ) : (
            <Empty>No current farm reminders.</Empty>
          )}
        </Modal>
      )}
      {auditRecord && (
        <Modal title="Record changes" onClose={() => setAuditRecord(undefined)}>
          <h3>Previous</h3>
          <pre>
            {JSON.stringify(auditRecord.previous?.data ?? null, null, 2)}
          </pre>
          <h3>Current</h3>
          <pre>{JSON.stringify(auditRecord.current.data, null, 2)}</pre>
        </Modal>
      )}
      {deletionConfirm && (
        <Modal
          title="Request account deletion"
          onClose={() => setDeletionConfirm(false)}
        >
          <p>
            Your account and its farm records are scheduled for deletion after
            30 days. You can cancel from Settings during that period.
          </p>
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={() => setDeletionConfirm(false)}
            >
              Cancel
            </button>
            <button
              className="button danger"
              onClick={() => void accountAction("deletion-request")}
            >
              Request deletion
            </button>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <ListChecks size={19} />
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label="Dismiss message"
            onClick={() => setToast("")}
          >
            <X size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
