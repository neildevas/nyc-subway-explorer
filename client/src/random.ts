import type { Feature, Point } from "geojson";
import type { StationProps } from "./types";

type Station = Feature<Point, StationProps>;

const VISITED_KEY = "standclear.visited";

export function loadVisited(): string[] {
  try { return JSON.parse(localStorage.getItem(VISITED_KEY) ?? "[]"); } catch { return []; }
}
export function saveVisited(ids: string[]) {
  try { localStorage.setItem(VISITED_KEY, JSON.stringify(ids)); } catch { /* storage unavailable */ }
}

/**
 * Pick a random station, preferring ones the user hasn't rolled before.
 * Once they've seen them all, any station will do.
 */
export function pickRandom(pool: Station[], visited: string[]): Station | null {
  if (!pool.length) return null;
  const unseen = pool.filter((s) => !visited.includes(s.properties.id));
  const from = unseen.length ? unseen : pool;
  // crypto-backed so it never feels "streaky"
  const i = crypto.getRandomValues(new Uint32Array(1))[0] % from.length;
  return from[i];
}
