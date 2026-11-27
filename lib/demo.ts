import { addDays, dayNow, type Farm, type Row, type Snapshot } from "./model";

export function sample(today = dayNow()): Snapshot {
  const first: Farm = { id: "greenfield", farmId: "greenfield", type: "farm", date: addDays(today, -450),
    data: { name: "Greenfield Farm", location: "Kiambu, Kenya", currency: "KES", timezone: "Africa/Nairobi", traySize: 30, lead: 7, email: false, push: false, inApp: true } };
  const second: Farm = { ...first, id: "ridgeview", farmId: "ridgeview", data: { ...first.data, name: "Ridgeview Farm", location: "Nakuru, Kenya" } };
  const flocks: Row[] = [
    { id: "flock-a", farmId: first.id, type: "flock", date: addDays(today, -220), data: { name: "House A Layers", breed: "ISA Brown", hatch: addDays(today, -294), house: "house-a", archived: false, cost: 0, initial: 822 }},
    { id: "flock-b", farmId: first.id, type: "flock", date: addDays(today, -135), data: { name: "House B Layers", breed: "Lohmann Brown", hatch: addDays(today, -184), house: "house-b", archived: false, cost: 0, initial: 430 }},
    { id: "flock-c", farmId: second.id, type: "flock", date: addDays(today, -80), data: { name: "Ridgeview Growers", breed: "Kenbro", hatch: addDays(today, -116), house: "", archived: false, cost: 0, initial: 240 }},
  ];
  const rows: Row[] = [first, second,
    { id: "house-a", farmId: first.id, date: first.date, type: "house", data: { name: "House A", capacity: 900 } },
    { id: "house-b", farmId: first.id, date: first.date, type: "house", data: { name: "House B", capacity: 500 } },
    ...flocks,
    { id: "layers", farmId: first.id, type: "product", date: addDays(today, -100), data: { name: "Layers mash", stage: "Layers mash", bag: 50, threshold: 200 } },
    { id: "growers", farmId: first.id, type: "product", date: addDays(today, -100), data: { name: "Growers mash", stage: "Growers mash", bag: 50, threshold: 50 } },
    { id: "purchase", farmId: first.id, type: "stock", date: addDays(today, -7), data: { product: "layers", flock: "", kind: "Purchase", kg: 950, cost: 45600, notes: "Weekly delivery" } },
    { id: "reserve", farmId: first.id, type: "stock", date: addDays(today, -7), data: { product: "growers", flock: "", kind: "Purchase", kg: 250, cost: 10800, notes: "" } },
    { id: "loss-a", farmId: first.id, date: addDays(today, -3), type: "movement", data: { flock: "flock-a", kind: "Mortality", count: 3, cause: "Unknown", notes: "" } },
    { id: "loss-b", farmId: first.id, date: addDays(today, -1), type: "movement", data: { flock: "flock-b", kind: "Mortality", count: 1, cause: "Accident", notes: "" } },
    { id: "custom-task", farmId: first.id, date: addDays(today, 2), type: "schedule", data: { flock: "flock-b", kind: "Vaccination", name: "Newcastle booster review", status: "Pending", completed: "", route: "", batch: "", dose: "", cost: 0, notes: "Confirm timing with the farm veterinarian" } },
  ];
  for (let i = 0; i < 91; i++) {
    const date = addDays(today, -i);
    const primary = [712, 748, 669, 708, 658, 727, 591][i % 7] - Math.floor(i / 9) * 6;
    const secondary = [372, 368, 345, 351, 354, 335, 322][i % 7] - Math.floor(i / 12) * 3;
    for (const [flock, eggs] of [["flock-a", primary], ["flock-b", secondary]] as const) {
      rows.push({ id: "egg:" + flock + ":" + date, farmId: first.id, date, type: "egg", data: { flock, eggs, broken: 2 } });
    }
    if (i < 7) rows.push({ id: "use-" + i, farmId: first.id, date, type: "stock", data: { product: "layers", flock: "flock-a", kind: "Consumption", kg: 113, cost: 0, notes: "" } });
    if (i % 5 === 0) rows.push({ id: "sale-" + i, farmId: first.id, date, type: "money", data: { kind: "Income", category: "Egg sales", flock: "", amount: 19300 - i * 42, reference: "SALE-" + (100 - i), notes: "" } });
  }
  rows.push({ id: "utilities", farmId: first.id, date: addDays(today, -12), type: "money", data: { kind: "Expense", category: "Utilities", flock: "", amount: 5650, reference: "", notes: "" } });
  return { rows, audits: [], notifications: [] };
}
