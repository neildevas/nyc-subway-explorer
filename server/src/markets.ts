/**
 * NYC Farmers Markets (NYC Open Data 8vwk-6iz2, from the Health Department): an annual
 * list of the city's farmers markets, with days, hours, season and EBT acceptance.
 * Downloaded at build time and tagged with its neighbourhood and nearest subway stops.
 *
 * Column names have shifted between yearly editions, so fields are matched loosely
 * (by pattern on a normalised column name) rather than by one exact name.
 */
import type { Area, LonLat } from "./geo.js";

export const MARKETS_URLS = [
  "https://data.cityofnewyork.us/resource/8vwk-6iz2.json?$limit=5000",
  "https://data.cityofnewyork.us/api/v3/views/8vwk-6iz2/query.json?accessType=DOWNLOAD",
];
export const MARKETS_SOURCE = "https://data.cityofnewyork.us/Health/NYC-Farmers-Markets/8vwk-6iz2";

type Row = Record<string, unknown>;

const KX = 111_320 * Math.cos((40.7 * Math.PI) / 180);
const KY = 110_540;
/** Walking-distance search radius for nearby stops (straight-line metres). */
const NEAR_METRES = 1200;

const str = (v: unknown) => (v == null ? "" : typeof v === "object" ? "" : String(v).trim());
/** "Market Name", "market_name" and "marketname" all become "marketname". */
const normKey = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");
const YES = /^(true|yes|y|1|x)$/i;
const NO = /^(false|no|n|0|)$/i;

const titleCase = (s: string) =>
  s.toLowerCase().replace(/(^|[\s/(-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
/** Leave mixed-case names alone; only fix ones that arrive in ALL CAPS. */
const tidyName = (s: string) => (s && s === s.toUpperCase() ? titleCase(s) : s);

const BOROUGHS: Record<string, string> = {
  manhattan: "Manhattan", newyork: "Manhattan", m: "Manhattan", mn: "Manhattan",
  brooklyn: "Brooklyn", kings: "Brooklyn", b: "Brooklyn", bk: "Brooklyn",
  queens: "Queens", q: "Queens", qn: "Queens",
  bronx: "Bronx", thebronx: "Bronx", x: "Bronx", bx: "Bronx",
  statenisland: "Staten Island", richmond: "Staten Island", r: "Staten Island", si: "Staten Island",
};

// ---- Days of the week -------------------------------------------------------
const DAY_NAMES: [RegExp, number][] = [
  [/^sun/, 0], [/^mon/, 1], [/^tue/, 2], [/^wed/, 3], [/^thu/, 4], [/^fri/, 5], [/^sat/, 6],
];
const dayIndex = (word: string) => DAY_NAMES.find(([re]) => re.test(word))?.[1] ?? -1;

/** "Wed & Sat", "Monday-Friday", "Tue, Thu, Sat", "Daily" → day numbers (0 = Sunday). */
export function parseDays(text: string): number[] {
  const t = text.toLowerCase();
  if (/daily|every ?day|7 days/.test(t)) return [0, 1, 2, 3, 4, 5, 6];
  const days = new Set<number>();
  // Ranges first ("mon-fri", "monday through friday").
  for (const m of t.matchAll(/([a-z]{3,9})\s*(?:-|–|to|through|thru)\s*([a-z]{3,9})/g)) {
    const a = dayIndex(m[1]), b = dayIndex(m[2]);
    if (a < 0 || b < 0) continue;
    for (let d = a; ; d = (d + 1) % 7) { days.add(d); if (d === b) break; }
  }
  for (const w of t.split(/[^a-z]+/)) { const d = dayIndex(w); if (d >= 0) days.add(d); }
  return [...days].sort();
}

// ---- Season -----------------------------------------------------------------
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** A date-ish value as "MM-DD" (the year is ignored: seasons repeat), or "" if it isn't one. */
function monthDay(v: string): string {
  if (!v) return "";
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); // ISO, e.g. 2026-06-07T00:00:00.000
  if (m) return `${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = v.match(/^(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?/); // 6/7/2026
  if (m) return `${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  m = v.toLowerCase().match(/([a-z]{3})[a-z]*\.?\s*(\d{1,2})?/); // "June 7", "Nov"
  const mi = m ? MONTHS.indexOf(m[1]) : -1;
  if (mi >= 0) return `${String(mi + 1).padStart(2, "0")}-${(m![2] ?? "01").padStart(2, "0")}`;
  return "";
}

/** Two dates or months in free text ("June 1 – November 23", "6/1/2026-11/23/2026") → [start, end]. */
export function seasonFromText(text: string): [string, string] | null {
  const parts = text.split(/\s*(?:–|—|-(?!\d{1,2}(?:-|T))|\bto\b|\bthrough\b|\bthru\b|\buntil\b)\s*/i).filter(Boolean);
  if (parts.length < 2) return null;
  const a = monthDay(parts[0]);
  let b = monthDay(parts[parts.length - 1]);
  // "June – November" means through the end of November.
  if (b && /^[a-z]+\.?$/i.test(parts[parts.length - 1].trim())) b = `${b.slice(0, 2)}-31`;
  return a && b ? [a, b] : null;
}

// ---- Download ---------------------------------------------------------------
async function download(): Promise<Row[] | null> {
  for (const url of MARKETS_URLS) {
    try {
      console.log(`Downloading farmers markets ${url} …`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const rows = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : null;
      if (!rows?.length || typeof rows[0] !== "object") throw new Error("no rows");
      return rows;
    } catch (err) {
      console.warn(`  failed: ${(err as Error).message}`);
    }
  }
  console.warn("  Skipping farmers markets.");
  return null;
}

export interface StationPoint { id: string; coords: LonLat }

/**
 * Build the farmers markets file, or null if the data couldn't be downloaded.
 * `areaAt`/`subAreaAt` place each market in its neighbourhood; `stations` are for nearby stops.
 */
export async function buildMarkets(
  stations: StationPoint[],
  areaAt?: (p: LonLat) => Area | null,
  subAreaAt?: (p: LonLat) => Area | null,
) {
  const raw = await download();
  if (!raw) return null;

  // Map each normalised column name to its real one, then find columns by pattern.
  const keys = new Map<string, string>();
  for (const r of raw.slice(0, 50)) for (const k of Object.keys(r)) keys.set(normKey(k), k);
  const col = (...patterns: RegExp[]) => {
    for (const re of patterns) for (const [n, k] of keys) if (re.test(n)) return k;
    return "";
  };
  const C = {
    name: col(/^marketname$/, /^name$/, /market.*name/, /^market$/),
    address: col(/streetaddress/, /^address/, /^location$/, /cross/),
    borough: col(/^borough/, /^boro/),
    lat: col(/^latitude$/, /^lat$/),
    lon: col(/^longitude$/, /^lon$/, /^lng$/),
    point: col(/locationpoint/, /^point$/, /georeference/, /^location1?$/, /^thegeom$/),
    days: col(/daysofoperation/, /daysoperation/, /^days?$/, /^day/),
    hours: col(/hoursofoperation/, /hoursoperations?/, /^hours/),
    seasonStart: col(/seasonbegin/, /seasonstart/, /^startdate/, /^opendate/, /seasonopen/),
    seasonEnd: col(/seasonend/, /^enddate/, /closedate/, /seasonclose/),
    season: col(/^season$/, /seasondates/, /^season(?!begin|start|end|open|close)/, /monthsof/, /^months?$/),
    yearRound: col(/yearround/),
    ebt: col(/ebt/, /snap/),
    healthBucks: col(/healthbucks/),
    year: col(/^year$/, /marketyear/),
    website: col(/website/, /^url$/, /^link/),
    phone: col(/phone/),
  };
  const get = (r: Row, k: string) => (k ? r[k] : undefined);

  // The data can hold several years; keep only the latest edition.
  const years = raw.map((r) => Number(str(get(r, C.year)).slice(0, 4))).filter((y) => y > 2000);
  const latest = years.length ? Math.max(...years) : 0;
  const rows = latest ? raw.filter((r) => Number(str(get(r, C.year)).slice(0, 4)) === latest) : raw;

  // Any other yes/no column is a feature worth showing (kids' activities, compost, etc.).
  const used = new Set(Object.values(C).filter(Boolean));
  const extraFlags = [...keys.values()].filter((k) => {
    if (used.has(k) || k.startsWith(":") || k.startsWith("@")) return false;
    const vals = rows.map((r) => str(r[k])).filter(Boolean);
    return vals.length > 0 && vals.every((v) => YES.test(v) || NO.test(v)) && vals.some((v) => YES.test(v));
  });
  const flagLabel = (k: string) => titleCase(k.replace(/^(has|offers|distributes?|accepts?)_/i, "").replace(/[_-]+/g, " ").trim());

  const skipped = new Map<string, number>();
  const skip = (why: string) => skipped.set(why, (skipped.get(why) ?? 0) + 1);
  const seen = new Map<string, number>();
  const unparsedDays = new Set<string>();

  const features = rows.flatMap((r) => {
    const name = tidyName(str(get(r, C.name)));
    if (!name) { skip("no name"); return []; }

    let lon = Number(str(get(r, C.lon))), lat = Number(str(get(r, C.lat)));
    const pt = get(r, C.point) as { coordinates?: number[]; latitude?: string; longitude?: string } | undefined;
    if (!(lat && lon) && pt && typeof pt === "object") {
      if (Array.isArray(pt.coordinates)) [lon, lat] = pt.coordinates;
      else { lat = Number(pt.latitude); lon = Number(pt.longitude); }
    }
    if (!(lat > 40.4 && lat < 41 && lon > -74.3 && lon < -73.6)) { skip("no location"); return []; }
    const coords: LonLat = [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5];

    const area = areaAt?.(coords) ?? null;
    const sub = subAreaAt?.(coords) ?? null;

    const daysText = str(get(r, C.days));
    const days = parseDays(daysText);
    if (daysText && !days.length) unparsedDays.add(daysText);

    const yearRound = YES.test(str(get(r, C.yearRound))) || /year.?round/i.test(str(get(r, C.season)));
    let season: [string, string] | null = null;
    const s0 = monthDay(str(get(r, C.seasonStart))), s1 = monthDay(str(get(r, C.seasonEnd)));
    if (s0 && s1) season = [s0, s1];
    else if (C.season) season = seasonFromText(str(get(r, C.season)));
    const seasonText = str(get(r, C.season)) ||
      [str(get(r, C.seasonStart)), str(get(r, C.seasonEnd))].filter(Boolean).map((v) => v.slice(0, 10)).join(" – ");

    const nearby = stations
      .map((s) => ({ id: s.id, m: Math.round(Math.hypot((s.coords[0] - coords[0]) * KX, (s.coords[1] - coords[1]) * KY)) }))
      .filter((s) => s.m <= NEAR_METRES)
      .sort((a, b) => a.m - b.m)
      .slice(0, 3);

    // A stable id from the name (plus a counter for markets that share one).
    const slug = name.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const n = (seen.get(slug) ?? 0) + 1;
    seen.set(slug, n);
    const id = n === 1 ? `fm-${slug}` : `fm-${slug}-${n}`;

    const rawSite = get(r, C.website);
    const site = str(rawSite && typeof rawSite === "object" ? (rawSite as Row).url : rawSite);

    return [{
      type: "Feature" as const,
      properties: {
        id,
        name,
        address: tidyName(str(get(r, C.address))),
        borough: BOROUGHS[normKey(str(get(r, C.borough)))] ?? area?.borough ?? "",
        /** As written in the data, e.g. "Saturday" or "Wed & Sat" */
        daysText,
        /** Day numbers it runs (0 = Sunday); empty if the text couldn't be read */
        days,
        hours: str(get(r, C.hours)),
        yearRound,
        /** ["MM-DD", "MM-DD"]; may wrap over New Year. Null if unknown. */
        season,
        seasonText,
        ebt: YES.test(str(get(r, C.ebt))),
        healthBucks: YES.test(str(get(r, C.healthBucks))),
        /** Other yes/no features in the data that apply here, e.g. "Kids Activities" */
        features: extraFlags.filter((k) => YES.test(str(r[k]))).map(flagLabel),
        website: site && !/^https?:\/\//i.test(site) ? `https://${site}` : site,
        phone: str(get(r, C.phone)),
        year: latest || null,
        areaId: area?.id ?? "",
        neighborhood: area?.name ?? "",
        subAreaId: sub?.id ?? "",
        subNeighborhood: sub?.name ?? "",
        nearby,
      },
      geometry: { type: "Point" as const, coordinates: coords },
    }];
  });

  return {
    geojson: { type: "FeatureCollection" as const, features },
    summary: {
      total: raw.length,
      kept: features.length,
      year: latest || null,
      skipped: [...skipped].map(([k, v]) => `${k} ${v}`).join(", "),
      columns: [...keys.values()].join(", "),
      matched: Object.entries(C).map(([k, v]) => `${k}=${v || "—"}`).join(", "),
      extraFlags: extraFlags.map(flagLabel).join(", "),
      unparsedDays: [...unparsedDays].slice(0, 8).join(" | "),
      withSeason: features.filter((f) => f.properties.season || f.properties.yearRound).length,
    },
  };
}
