/**
 * Rewrite the public fields in data.json.
 *
 *   node scripts/refresh-data.mjs
 *
 * No npm packages and no API key. Requires Node 18+ (global fetch).
 *
 * Pulled on each run, and safe for a weekday GitHub Action because none
 * of them need a secret:
 *   - EIA HTML history tables (Henry Hub, WTI, Brent, refinery utilization,
 *     U.S. distillate stocks, PADD 1 distillate stocks, NYH ULSD, USGC ULSD,
 *     NYH No. 2 heating oil). The EIA API itself needs a key; these pages do not.
 *   - Open-Meteo archive weather for a Northwest Europe proxy near Rotterdam.
 *     Monthly HDD uses base 18°C. This is not an ECMWF operational forecast.
 *   - ECB EURUSD via Frankfurter.
 *   - EU gas storage from the Voltstack public CSV, which attributes GIE AGSI+.
 *
 * Not called, because each one needs a paid or registered key:
 *   - agsi.gie.eu (x-key). Storage above is a republished AGSI cross-section,
 *     not a direct AGSI request. If that CSV fails, the previous storage
 *     block is kept and direct AGSI is still not queried.
 *   - ICE (TTF, European gasoil / LGO), Spark Commodities (Spark25),
 *     Baltic Exchange (BLNG2), Bloomberg.
 * Those stay in `manual`. This script never invents points for them and
 * never moves their as-of date forward.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_PATH = join(ROOT, "data.json");
const HISTORY_FROM = "2025-10-01";
const UA = "energy-dashboard-refresh/1.0 (public tables; no key)";

const EIA = {
  henryHub: "https://www.eia.gov/dnav/ng/hist/rngwhhdD.htm",
  wti: "https://www.eia.gov/dnav/pet/hist/rwtcD.htm",
  brent: "https://www.eia.gov/dnav/pet/hist/rbrteD.htm",
  utilization: "https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?n=PET&s=WPULEUS3&f=W",
  distillate: "https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?n=PET&s=WDISTUS1&f=W",
  padd1: "https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?n=PET&s=WDISTP11&f=W",
  nyhUlsd: "https://www.eia.gov/dnav/pet/hist/eer_epd2dxl0_pf4_y35ny_dpgD.htm",
  usgcUlsd: "https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?n=PET&s=EER_EPD2DXL0_PF4_RGC_DPG&f=D",
  ho: "https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?n=PET&s=EER_EPD2F_PF4_Y35NY_DPG&f=D",
};

const MONTH = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

const DEFAULT_MANUAL = {
  ttf: {
    automatic: false,
    source: "Retained desk snapshot",
    reason: "ICE Dutch TTF is not reachable without a paid key. This figure is the desk snapshot kept on the calculator. It is not an ICE settlement, and this script does not add points after the snapshot date.",
    asOf: "2026-09-29",
    unit: "EUR/MWh",
    value: 71.2,
  },
  spark25: {
    automatic: false,
    source: "Retained desk path",
    reason: "Spark Commodities is not reachable without a paid key. points are the desk path from before the public refresh (SPARK_SHAPE scaled to the 2026-09-29 snapshot of 25500 $/day), spaced one week apart and ending on that snapshot. They are not Spark assessments. This script must not replace them with a live feed or collapse them to the single snapshot.",
    asOf: "2026-09-29",
    unit: "USD/day",
    value: 25500,
    points: [
      { d: "2026-07-14", v: 17850 },
      { d: "2026-07-21", v: 16830 },
      { d: "2026-07-28", v: 18360 },
      { d: "2026-08-04", v: 19890 },
      { d: "2026-08-11", v: 21420 },
      { d: "2026-08-18", v: 22950 },
      { d: "2026-08-25", v: 24480 },
      { d: "2026-09-01", v: 23715 },
      { d: "2026-09-08", v: 22440 },
      { d: "2026-09-15", v: 21420 },
      { d: "2026-09-22", v: 20400 },
      { d: "2026-09-29", v: 25500 },
    ],
  },
  blng2: {
    automatic: false,
    source: null,
    reason: "Baltic Exchange BLNG2 is not reachable without a paid key. No dated print is stored, so the chart has no BLNG2 points.",
    asOf: null,
    unit: "USD/day",
    value: null,
    points: [],
  },
  lgo: {
    automatic: false,
    source: "Retained desk snapshot",
    reason: "ICE low-sulphur gasoil is not reachable without a paid key. This figure is the desk snapshot. It is not an ICE settlement, and this script does not add points after the snapshot date.",
    asOf: "2026-09-29",
    unit: "USD/t",
    value: 780,
  },
};

function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDays(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return isoDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function num(text) {
  if (text == null) return null;
  const s = String(text).replace(/,/g, "").trim();
  if (!s || s === "-" || s === "--" || s === "NA" || s === "W") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

async function getText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,application/json,text/csv,*/*" }, redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

function htmlRows(html) {
  const rows = [];
  const re = /<tr\b[^>]*>[\s\S]*?<\/tr>/gi;
  let m;
  while ((m = re.exec(html))) {
    const cells = [];
    const cre = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let c;
    while ((c = cre.exec(m[0]))) {
      cells.push(c[1].replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim());
    }
    if (cells.some(Boolean)) rows.push(cells);
  }
  return rows;
}

function parseDaily(html) {
  const points = [];
  for (const cells of htmlRows(html)) {
    const head = cells[0] || "";
    const match = head.match(/^(\d{4})\s+([A-Za-z]{3})-\s*(\d{1,2})\s+to\s+[A-Za-z]{3}-\s*\d{1,2}$/);
    if (!match || cells.length < 6) continue;
    const month = MONTH[match[2]];
    if (!month) continue;
    const monday = isoDate(Number(match[1]), month, Number(match[3]));
    for (let i = 0; i < 5; i++) {
      const v = num(cells[i + 1]);
      if (v == null) continue;
      points.push({ d: addDays(monday, i), v });
    }
  }
  return dedupe(points);
}

function parseWeekly(html) {
  const points = [];
  for (const cells of htmlRows(html)) {
    const head = cells[0] || "";
    const match = head.match(/^(\d{4})-([A-Za-z]{3})$/);
    if (!match) continue;
    const year = Number(match[1]);
    for (let i = 1; i + 1 < cells.length; i += 2) {
      const dm = (cells[i] || "").match(/^(\d{2})\/(\d{2})$/);
      const v = num(cells[i + 1]);
      if (!dm || v == null) continue;
      points.push({ d: isoDate(year, Number(dm[1]), Number(dm[2])), v });
    }
  }
  return dedupe(points);
}

function dedupe(points) {
  const map = new Map();
  for (const p of points) map.set(p.d, p.v);
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .filter(([d]) => d >= HISTORY_FROM)
    .map(([d, v]) => ({ d, v }));
}

function finishSeries(points, meta) {
  if (!points.length) throw new Error(`no points for ${meta.id}`);
  const last = points[points.length - 1];
  return {
    automatic: true,
    id: meta.id,
    source: meta.source,
    sourceUrl: meta.sourceUrl,
    unit: meta.unit,
    asOf: last.d,
    latest: last.v,
    points,
  };
}

async function eiaDaily(id, url, unit) {
  const html = await getText(url);
  return finishSeries(parseDaily(html), { id, source: "EIA", sourceUrl: url, unit });
}

async function eiaWeekly(id, url, unit) {
  const html = await getText(url);
  return finishSeries(parseWeekly(html), { id, source: "EIA", sourceUrl: url, unit });
}

async function fetchStorage() {
  const sourceUrl = "https://voltstack.energy/gas-storage-map/countries.csv";
  const text = await getText(sourceUrl);
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(",");
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const want = ["gas_day", "country_code", "fill_pct", "gas_in_storage_twh", "working_gas_volume_twh", "map_status"];
  for (const key of want) if (!(key in idx)) throw new Error(`storage CSV missing ${key}`);
  const rows = lines.slice(1).filter(Boolean).map((line) => {
    const cells = line.split(",");
    return {
      code: cells[idx.country_code],
      gasDay: cells[idx.gas_day],
      fillPct: num(cells[idx.fill_pct]),
      twh: num(cells[idx.gas_in_storage_twh]),
      workingTwh: num(cells[idx.working_gas_volume_twh]),
      status: cells[idx.map_status],
    };
  });
  const eu = rows.find((r) => r.code === "EU");
  if (!eu || !Number.isFinite(eu.fillPct) || !eu.gasDay) throw new Error("storage CSV has no EU row");
  const countries = ["DE", "FR", "IT", "NL", "AT"].map((code) => {
    const row = rows.find((r) => r.code === code);
    if (!row || !Number.isFinite(row.fillPct)) throw new Error(`storage CSV missing ${code}`);
    return { code, fillPct: row.fillPct, twh: row.twh, status: row.status };
  });
  return {
    automatic: true,
    directAgsi: false,
    reasonDirect: "agsi.gie.eu returns access denied without an x-key. This block is the Voltstack public CSV, whose source column attributes GIE AGSI+. The script does not call AGSI and does not invent earlier gas days.",
    source: "GIE AGSI+ via Voltstack EU Gas Storage Map",
    sourceUrl,
    asOf: eu.gasDay,
    eu: { fillPct: eu.fillPct, twh: eu.twh, workingTwh: eu.workingTwh, status: eu.status },
    countries,
  };
}

async function fetchHdd() {
  const end = addDays(new Date().toISOString().slice(0, 10), -1);
  const params = new URLSearchParams({
    latitude: "51.92",
    longitude: "4.48",
    start_date: HISTORY_FROM,
    end_date: end,
    daily: "temperature_2m_mean",
    timezone: "Europe/Amsterdam",
  });
  const sourceUrl = `https://archive-api.open-meteo.com/v1/archive?${params}`;
  const res = await fetch(sourceUrl, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} open-meteo`);
  const body = await res.json();
  const times = body?.daily?.time || [];
  const temps = body?.daily?.temperature_2m_mean || [];
  if (!times.length) throw new Error("open-meteo returned no days");
  const byMonth = new Map();
  for (let i = 0; i < times.length; i++) {
    const t = temps[i];
    if (!Number.isFinite(t)) continue;
    const month = times[i].slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month).push({ d: times[i], t });
  }
  const months = [...byMonth.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([month, days]) => {
    const mean = days.reduce((s, d) => s + d.t, 0) / days.length;
    const hdd = days.reduce((s, d) => s + Math.max(0, 18 - d.t), 0);
    const [y, m] = month.split("-").map(Number);
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const through = days[days.length - 1].d;
    return {
      d: month,
      meanC: Math.round(mean * 10) / 10,
      hdd: Math.round(hdd),
      days: days.length,
      partial: days.length < dim,
      through,
    };
  });
  if (!months.length) throw new Error("no HDD months");
  const last = months[months.length - 1];
  return {
    automatic: true,
    source: "Open-Meteo archive",
    sourceUrl: "https://archive-api.open-meteo.com/v1/archive",
    proxy: true,
    place: "Near Rotterdam, 51.92N 4.48E",
    note: "Northwest Europe temperature and HDD proxy from Open-Meteo historical weather. Base 18°C. Not an ECMWF operational forecast.",
    baseC: 18,
    asOf: last.through,
    months,
  };
}

async function fetchFx() {
  const sourceUrl = "https://api.frankfurter.dev/v1/latest?from=EUR&to=USD";
  const res = await fetch(sourceUrl, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} frankfurter`);
  const body = await res.json();
  const rate = Number(body?.rates?.USD);
  if (!Number.isFinite(rate) || !body.date) throw new Error("frankfurter payload");
  return { automatic: true, source: "ECB via Frankfurter", sourceUrl, date: body.date, rate };
}

function loadPrev() {
  try {
    return JSON.parse(readFileSync(DATA_PATH, "utf8"));
  } catch {
    return {};
  }
}

function keepManual(prev) {
  const manual = structuredClone(DEFAULT_MANUAL);
  const old = prev.manual || {};
  for (const key of Object.keys(manual)) {
    if (old[key] && old[key].automatic === false) manual[key] = old[key];
  }
  return manual;
}

async function guarded(name, prev, fn) {
  try {
    return await fn();
  } catch (err) {
    const previous = prev?.public?.[name] || (name === "storage" ? prev.storage : null) || (name === "hdd" ? prev.hdd : null) || (name === "eurusd" ? prev.eurusd : null);
    if (previous) {
      console.warn(`kept previous ${name}: ${err.message}`);
      return previous;
    }
    throw new Error(`${name}: ${err.message}`);
  }
}

async function main() {
  const prev = loadPrev();
  const publicSeries = {};
  const jobs = [
    ["henryHub", () => eiaDaily("RNGWHHD", EIA.henryHub, "USD/MMBtu")],
    ["wti", () => eiaDaily("RWTC", EIA.wti, "USD/bbl")],
    ["brent", () => eiaDaily("RBRTE", EIA.brent, "USD/bbl")],
    ["utilization", () => eiaWeekly("WPULEUS3", EIA.utilization, "percent")],
    ["distillate", () => eiaWeekly("WDISTUS1", EIA.distillate, "thousand barrels")],
    ["padd1", () => eiaWeekly("WDISTP11", EIA.padd1, "thousand barrels")],
    ["nyhUlsd", () => eiaDaily("EER_EPD2DXL0_PF4_Y35NY_DPG", EIA.nyhUlsd, "USD/gal")],
    ["usgcUlsd", () => eiaDaily("EER_EPD2DXL0_PF4_RGC_DPG", EIA.usgcUlsd, "USD/gal")],
    ["ho", () => eiaDaily("EER_EPD2F_PF4_Y35NY_DPG", EIA.ho, "USD/gal")],
  ];
  for (const [name, fn] of jobs) publicSeries[name] = await guarded(name, prev, fn);
  const storage = await guarded("storage", prev, fetchStorage);
  // `hdd` is the Open-Meteo archive kept in data.json. The desk chart reads the
  // in-page January–December climatology and must not be pointed at this series.
  const hdd = await guarded("hdd", prev, fetchHdd);
  const eurusd = await guarded("eurusd", prev, fetchFx);
  const manual = keepManual(prev);
  const doc = {
    schema: "energy-dashboard.data.v2",
    asOf: new Date().toISOString(),
    kind: "mixed",
    description: "Public series are rewritten by scripts/refresh-data.mjs. manual series are not on an automatic feed and are not backfilled.",
    historyFrom: HISTORY_FROM,
    eurusd,
    storage,
    hdd,
    public: publicSeries,
    manual,
    seed: {
      ttf: manual.ttf.value,
      hh: publicSeries.henryHub.latest,
      eurusd: eurusd.rate,
      freight: manual.spark25.value,
      storagePct: storage.eu.fillPct,
      hddDevPct: 0,
      utilPct: publicSeries.utilization.latest,
      padd1: publicSeries.padd1.latest,
      brent: publicSeries.brent.latest,
      wti: publicSeries.wti.latest,
      nyh: publicSeries.nyhUlsd.latest,
      usgc: publicSeries.usgcUlsd.latest,
      ho: publicSeries.ho.latest,
      ara: manual.lgo.value,
      roundTripDays: 24,
      ladenDays: 13,
      cargoWan: 360,
      liq: 2.5,
    },
  };
  if (prev.hddClimo) doc.hddClimo = structuredClone(prev.hddClimo);
  writeFileSync(DATA_PATH, JSON.stringify(doc, null, 2) + "\n");
  const line = (name, block) => `${name} ${block.asOf || block.date} ${block.latest ?? block.rate ?? block.eu?.fillPct}`;
  console.log(line("henryHub", publicSeries.henryHub));
  console.log(line("wti", publicSeries.wti));
  console.log(line("brent", publicSeries.brent));
  console.log(line("utilization", publicSeries.utilization));
  console.log(line("distillate", publicSeries.distillate));
  console.log(line("padd1", publicSeries.padd1));
  console.log(line("nyhUlsd", publicSeries.nyhUlsd));
  console.log(line("usgcUlsd", publicSeries.usgcUlsd));
  console.log(line("ho", publicSeries.ho));
  console.log(`storage ${storage.asOf} ${storage.eu.fillPct} directAgsi=${storage.directAgsi}`);
  console.log(`hdd ${hdd.asOf} months=${hdd.months.length} last=${hdd.months.at(-1).d}`);
  console.log(`eurusd ${eurusd.date} ${eurusd.rate}`);
  console.log(`manual ttf ${manual.ttf.asOf} spark ${manual.spark25.asOf} lgo ${manual.lgo.asOf} blng2 ${manual.blng2.value}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
