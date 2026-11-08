import { useMemo, useState, type ReactNode } from "react";
import type { Feature, MultiPolygon, Point } from "geojson";
import { Bullet, routeSort } from "./Bullet";
import type { AreaProps, MarketProps, ParkProps, Routes, StationProps } from "./types";

type Area = Feature<MultiPolygon, AreaProps>;
type Park = Feature<MultiPolygon, ParkProps>;
type Station = Feature<Point, StationProps>;
type Market = Feature<Point, MarketProps>;

export type PlaceKind = "neighborhood" | "sub" | "park" | "market" | "station" | "line" | "borough";

/** What the user picked: the kind of thing and its id (a route id for lines, a name for boroughs). */
export interface PlacePick { kind: PlaceKind; id: string }

interface Entry extends PlacePick {
  name: string;
  /** Other names that should match, e.g. "UES" or a line's full name */
  aliases: { text: string; note: (text: string) => string }[];
  /** Small context line under the name */
  note?: string;
  /** Right-hand context */
  meta: ReactNode;
  icon: ReactNode;
}

interface Result extends Entry { score: number; why?: string }

/** Lowercase, strip accents and punctuation, so "St. George" matches "st george". */
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** 4 = exact, 3 = starts with the query, 2 = a word starts with it, 1 = contains it, 0 = no match. */
function score(text: string, q: string) {
  const t = norm(text);
  if (t === q) return 4;
  if (t.startsWith(q)) return 3;
  if (t.split(" ").some((w) => w.startsWith(q))) return 2;
  return t.includes(q) ? 1 : 0;
}

/** When two results match equally well, show the bigger kinds of place first. */
const KIND_ORDER: PlaceKind[] = ["borough", "neighborhood", "line", "station", "park", "market", "sub"];

const ICONS = {
  area: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7l5-3 6 3 5-3v13l-5 3-6-3-5 3z" /><path d="M9 4v13M15 7v13" /></svg>
  ),
  park: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l5 7h-3l4 6H6l4-6H7z" /><path d="M12 16v5" /></svg>
  ),
  market: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10h16l-1.5 9h-13z" /><path d="M8 10l3-6M16 10l-3-6" /></svg>
  ),
  borough: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h7v7H4zM13 5h7v4h-7zM13 11h7v8h-7zM4 14h7v5H4z" /></svg>
  ),
};

const BOROUGHS = ["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"];

/**
 * One search box for everything clickable on the map: neighbourhoods and
 * sub-neighbourhoods, parks, farmers markets, subway stations and lines, and boroughs.
 */
export function PlaceSearch({ areas, parks, markets = [], stations, routes, routesAt, onPick }: {
  areas: Area[];
  parks: Park[];
  markets?: Market[];
  stations: Station[];
  routes: Routes;
  /** Lines that stop at a station (express variants folded), for its bullets */
  routesAt: (s: Station) => string[];
  onPick: (pick: PlacePick) => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  // Everything searchable, built once per data load.
  const entries = useMemo(() => {
    const out: Entry[] = [];
    const areaName = new Map(areas.map((a) => [a.properties.id, a.properties.name]));
    const stopsLabel = (n: number) => (n ? ` · ${n} ${n === 1 ? "stop" : "stops"}` : "");

    for (const b of BOROUGHS) {
      if (!areas.some((a) => a.properties.borough === b)) continue;
      out.push({ kind: "borough", id: b, name: b, aliases: [], note: "Borough · highlight its neighborhoods", meta: "", icon: ICONS.borough });
    }
    for (const { properties: p } of areas) {
      const isSub = p.kind === "sub";
      out.push({
        kind: isSub ? "sub" : "neighborhood",
        id: p.id,
        name: p.name,
        aliases: p.alternateNames.map((text) => ({ text, note: (t) => `Also called ${t}` })),
        note: isSub ? `in ${areaName.get(p.parent) ?? "a neighborhood"}` : undefined,
        meta: `${p.borough}${stopsLabel(p.stations.length)}`,
        icon: ICONS.area,
      });
    }
    for (const { properties: p } of parks) {
      out.push({
        kind: "park",
        id: p.id,
        name: p.name,
        aliases: [],
        note: [p.type, p.neighborhood].filter(Boolean).join(" · "),
        meta: p.borough,
        icon: ICONS.park,
      });
    }
    for (const { properties: p } of markets) {
      out.push({
        kind: "market",
        id: p.id,
        name: p.name,
        aliases: [],
        note: ["Farmers market", p.daysText].filter(Boolean).join(" · "),
        meta: p.borough,
        icon: ICONS.market,
      });
    }
    for (const s of stations) {
      const p = s.properties;
      out.push({
        kind: "station",
        id: p.id,
        name: p.name,
        aliases: [],
        note: [p.neighborhood, p.borough].filter(Boolean).join(" · ") || "Subway station",
        meta: (
          <span className="result-bullets">
            {routesAt(s).map((r) => <Bullet key={r} route={routes[r]} id={r} small />)}
          </span>
        ),
        icon: <span className="station-dot" />,
      });
    }
    for (const r of Object.values(routes).filter((r) => r.stops?.length).sort((a, b) => routeSort(a.id, b.id))) {
      out.push({
        kind: "line",
        id: r.id,
        name: `${r.name} train`,
        aliases: [
          { text: r.name, note: () => r.longName },
          ...(r.longName ? [{ text: r.longName, note: (t: string) => t }] : []),
        ],
        note: r.longName,
        meta: "Subway line",
        icon: <Bullet route={r} id={r.id} small />,
      });
    }
    return out;
  }, [areas, parks, markets, stations, routes, routesAt]);

  const results = useMemo(() => {
    const q = norm(query);
    if (!q) return [];
    const found: Result[] = [];
    for (const e of entries) {
      let best = score(e.name, q);
      let why: string | undefined;
      for (const a of e.aliases) {
        const s = score(a.text, q) - 0.25; // a nickname match ranks just under a name match
        if (s > best) { best = s; why = a.note(a.text); }
      }
      if (best > 0) found.push({ ...e, score: best, why });
    }
    return found
      .sort((a, b) => b.score - a.score || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name, "en", { numeric: true }))
      .slice(0, 10);
  }, [query, entries]);

  const choose = (r: Result | undefined) => {
    if (!r) return;
    onPick({ kind: r.kind, id: r.id });
    setQuery("");
    setActive(0);
  };

  return (
    <div className="area-search">
      <input
        type="search"
        placeholder="Search places, stops, parks, markets"
        aria-label="Search the map"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setActive(0); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
          else if (e.key === "Enter") choose(results[active]);
          else if (e.key === "Escape") {
            // Clear the box without also closing whatever's selected on the map.
            e.stopPropagation();
            e.nativeEvent.stopImmediatePropagation();
            setQuery("");
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {query.trim() && (
        <ul className="suggestions" role="listbox">
          {results.length === 0 && <li className="empty">Nothing matches “{query.trim()}”</li>}
          {results.map((r, i) => (
            <li key={`${r.kind}:${r.id}`} role="option" aria-selected={i === active}>
              <button className={i === active ? "active" : ""} onMouseEnter={() => setActive(i)} onClick={() => choose(r)}>
                <span className={`result-icon kind-${r.kind}`}>{r.icon}</span>
                <span className="result-text">
                  <span className="name">{r.name}</span>
                  {(r.why || r.note) && <span className="note">{r.why ?? r.note}</span>}
                </span>
                <span className="meta">{r.meta}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
