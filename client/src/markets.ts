/** Map layers and opening-day logic for NYC farmers markets. */
import type mapboxgl from "mapbox-gl";
import type { MarketProps, Markets } from "./types";

type Expr = mapboxgl.ExpressionSpecification;

/** Berry pink: not used by any subway line, so markets never read as stops on a route. */
export const MARKET_COLOR = "#ec5f98";

export const MARKET_LAYERS = ["markets-dots", "markets-labels", "markets-selected"] as const;

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const mmdd = (d: Date) => `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const monthName = (md: string) => MONTHS[Number(md.slice(0, 2)) - 1] ?? "";

/**
 * The city's list says whether a market is year-round but (in recent years) gives no
 * dates for the seasonal ones. Those typically run from early summer to late fall,
 * so that's assumed, and labelled as "usually".
 */
const ASSUMED_SEASON: [string, string] = ["06-01", "11-30"];
const seasonOf = (p: MarketProps) => (p.yearRound ? null : p.season ?? ASSUMED_SEASON);

/** Whether a date falls inside the season. Handles seasons that wrap over New Year. */
function inSeason(p: MarketProps, d: Date) {
  const season = seasonOf(p);
  if (!season) return true;
  const [a, b] = season, t = mmdd(d);
  return a <= b ? t >= a && t <= b : t >= a || t <= b;
}

/** "Year-round", "Jun – Nov", or "Seasonal (usually Jun – Nov)" when the dates are assumed. */
export function seasonLabel(p: MarketProps) {
  if (p.yearRound) return "Year-round";
  if (p.season) return `${monthName(p.season[0])} – ${monthName(p.season[1])}`;
  return `Seasonal (usually ${monthName(ASSUMED_SEASON[0])} – ${monthName(ASSUMED_SEASON[1])})`;
}

export type MarketState = "today" | "season" | "off" | "unknown";

/**
 * Where a market stands on a given day:
 *   today   – it runs today
 *   season  – in season, but not today (`label` names the next market day)
 *   off     – out of season
 *   unknown – the data doesn't say enough to tell
 */
export function marketStatus(p: MarketProps, now = new Date()): { state: MarketState; label: string } {
  const season = seasonOf(p);
  if (!inSeason(p, now)) {
    const back = season ? monthName(season[0]) : "";
    return { state: "off", label: p.season ? `Out of season · back in ${back}` : `Seasonal · usually back in ${back}` };
  }
  if (!p.days.length) return { state: "unknown", label: p.daysText || "Days not listed" };
  const today = now.getDay();
  if (p.days.includes(today)) {
    // "1st and 3rd Friday" markets might not be on this week.
    if (p.weekly === false) return { state: "season", label: `Some ${DAY_NAMES[today]}s · ${p.daysText}` };
    return { state: "today", label: `Open today${p.hours ? ` · ${p.hours}` : ""}` };
  }
  // The next market day that's still in season (within the coming week).
  for (let i = 1; i <= 7; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    if (!p.days.includes(d.getDay())) continue;
    if (!inSeason(p, d)) break;
    return { state: "season", label: i === 1 ? "Next open tomorrow" : `Next open ${DAY_NAMES[d.getDay()]}` };
  }
  return { state: "off", label: "Season ending" };
}

/**
 * Add the layers. Dots go above the subway lines and station dots (but under station
 * names, `beneath`), so they're easy to hit; out-of-season markets fade back.
 */
export function addMarketLayers(m: mapboxgl.Map, data: Markets, beneath?: string) {
  // Stamp today's status on each market so the map can style by it.
  const now = new Date();
  const stamped: Markets = {
    ...data,
    features: data.features.map((f) => ({ ...f, properties: { ...f.properties, state: marketStatus(f.properties, now).state } })),
  };
  m.addSource("markets", { type: "geojson", data: stamped, promoteId: "id" });
  const hovered: Expr = ["boolean", ["feature-state", "hover"], false];
  const off: Expr = ["==", ["get", "state"], "off"];

  m.addLayer({
    id: "markets-dots",
    type: "circle",
    source: "markets",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 2, 12, 3.5, 14, 5.5, 17, 8],
      "circle-color": MARKET_COLOR,
      "circle-opacity": ["case", hovered, 1, off, 0.35, 0.95],
      "circle-stroke-color": ["case", ["==", ["get", "state"], "today"], "#ffffff", "#0b0b0b"],
      "circle-stroke-width": ["case", hovered, 2, ["==", ["get", "state"], "today"], 1.5, 1],
      "circle-stroke-opacity": ["case", off, 0.4, 1],
    },
  }, beneath);
  m.addLayer({
    id: "markets-selected",
    type: "circle",
    source: "markets",
    filter: ["==", ["get", "id"], ""],
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 6, 14, 10, 17, 13],
      "circle-color": "rgba(0,0,0,0)",
      "circle-stroke-color": "#FFD600",
      "circle-stroke-width": 2.5,
    },
  }, beneath);
  m.addLayer({
    id: "markets-labels",
    type: "symbol",
    source: "markets",
    minzoom: 14,
    layout: {
      "text-field": ["get", "name"],
      "text-size": 11,
      "text-max-width": 8,
      "text-offset": [0, 0.9],
      "text-anchor": "top",
      "text-optional": true,
      "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
    },
    paint: {
      "text-color": "#f7a8c8",
      "text-opacity": ["case", off, 0.5, 1],
      "text-halo-color": "#0b0b0b",
      "text-halo-width": 1.2,
    },
  }, beneath);
}

export function setMarketsVisible(m: mapboxgl.Map, on: boolean) {
  for (const id of MARKET_LAYERS) if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", on ? "visible" : "none");
}

export function setSelectedMarket(m: mapboxgl.Map, id: string | null) {
  if (m.getLayer("markets-selected")) m.setFilter("markets-selected", ["==", ["get", "id"], id ?? ""]);
}
