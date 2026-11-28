import { createRequire } from "node:module";

const requireParser = createRequire(new URL("../../../packages/data-harness/package.json", import.meta.url));

const headings = {
  en: ["Event ID", "Equipment", "Category", "Start", "End", "Duration (min)"],
  ru: ["Код события", "Оборудование", "Категория", "Начало", "Окончание", "Длительность (мин)"],
};
const categories = {
  en: ["Mechanical", "Electrical", "Waiting"],
  ru: ["Механика", "Электрика", "Ожидание"],
};

function eventRows(locale) {
  const days = [2, 3, 7, 8, 9];
  const start = (day, hour) => Date.UTC(2026, 10, day, hour);
  const event = (id, device, category, time, minutes) => ({
    id, device, category, start: time,
    end: typeof minutes === "number" ? time + minutes * 60000 : undefined, minutes,
  });
  const rows = Array.from({ length: 14995 }, (_, index) => event(index + 1, `E${1 + index % 17}`,
    categories[locale][index % 3], start(days[index % 5], 8), 6 * (1 + index % 5)));
  rows.push(
    { ...rows[0] },
    event(14996, "E1", "", start(2, 12), 12),
    event(14997, "E2", categories[locale][0], start(3, 14), -5),
    event(14998, "E3", categories[locale][1], start(3, 15), "invalid"),
    event(14999, "E4", categories[locale][2], start(9, 23), 120),
  );
  return rows;
}

// Generate only business input. Expected totals and checksums are maintained separately.
export function buildWorkspaceEventFile(locale, form) {
  if (!(locale in headings) || !["duration-csv", "serial-xlsx"].includes(form)) {
    throw new Error("Unknown workspace event file variant");
  }
  const rows = eventRows(locale);
  const parts = [0, 1, 2, 3, 4];
  if (form === "duration-csv") {
    const csv = [headings[locale], ...rows.map(({ id, device, category, start, end, minutes }) => [
      id, device, category, new Date(start).toISOString(), end === undefined ? "" : new Date(end).toISOString(), minutes,
    ])].map((row) => row.join(",")).join("\n") + "\n";
    return { name: "downtime-events.csv", bytes: new TextEncoder().encode(csv) };
  }
  const XLSX = requireParser("xlsx");
  const serial = (value) => value === undefined ? undefined : value / 86400000 + 25569;
  const sheet = XLSX.utils.aoa_to_sheet([
    parts.map((index) => headings[locale][index]),
    ...rows.map(({ id, device, category, start, end }) => [id, device, category, serial(start), serial(end)]),
  ]);
  for (let row = 2; row <= rows.length + 1; row++) {
    for (const column of ["D", "E"]) {
      const cell = sheet[`${column}${row}`];
      if (cell) cell.z = "yyyy-mm-dd hh:mm:ss";
    }
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, locale === "en" ? "Events" : "События");
  return { name: "downtime-events.xlsx", bytes: XLSX.write(workbook, { type: "array", bookType: "xlsx" }) };
}
