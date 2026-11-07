/**
 * Ordered stop lists for each route, for the side panel's strip map.
 *
 * Each route gets a main line (its longest daytime stopping pattern) plus any
 * branches: runs of stops that other patterns serve but the main line doesn't,
 * e.g. the A's Far Rockaway branch, or the 5's Dyre Ave branch.
 */
export type LonLat = [number, number];

export interface RouteStops {
  /** Main line, ordered north → south (or west → east for crosstown routes) */
  stops: string[];
  branches: Branch[];
}

export interface Branch {
  /** Main-line stop the branch splits from (null if it couldn't be attached) */
  from: string | null;
  /** Branch stops, ordered outward from `from` */
  stops: string[];
}

export interface StopPattern {
  routeId: string;
  stops: string[];
  dayTrips: number;
}

export function buildRouteStops(patterns: StopPattern[], coords: Map<string, LonLat>): Record<string, RouteStops> {
  const out: Record<string, RouteStops> = {};
  const routeIds = [...new Set(patterns.map((p) => p.routeId))];

  for (const routeId of routeIds) {
    const pats = patterns.filter((p) => p.routeId === routeId).sort((a, b) => b.dayTrips - a.dayTrips);
    const main = pats.reduce((best, p) =>
      p.stops.length > best.stops.length || (p.stops.length === best.stops.length && p.dayTrips > best.dayTrips) ? p : best,
    );
    const stops = dedupe(main.stops);
    if (shouldReverse(stops, coords)) stops.reverse();
    const onMain = new Set(stops);

    const branches: Branch[] = [];
    const seen = new Set<string>();
    const push = (from: string | null, run: string[]) => {
      const key = [...run].sort().join(",");
      if (!run.length || seen.has(key)) return;
      seen.add(key);
      branches.push({ from, stops: run });
    };

    for (const p of pats) {
      let run: string[] = [];
      let from: string | null = null; // last main-line stop before the current run
      for (const s of dedupe(p.stops)) {
        if (onMain.has(s)) {
          if (run.length) {
            // A run with no main stop before it is heading *into* the main line:
            // flip it so it reads outward from the junction.
            push(from ?? s, from ? run : [...run].reverse());
            run = [];
          }
          from = s;
        } else {
          run.push(s);
        }
      }
      if (run.length) push(from, run);
    }

    out[routeId] = { stops, branches };
  }
  return out;
}

function dedupe(stops: string[]) {
  return stops.filter((s, i) => s !== stops[i - 1]);
}

/** Orient a line north → south, or west → east if it runs mostly crosstown. */
function shouldReverse(stops: string[], coords: Map<string, LonLat>) {
  const a = coords.get(stops[0]);
  const b = coords.get(stops[stops.length - 1]);
  if (!a || !b) return false;
  const dy = b[1] - a[1];
  const dx = (b[0] - a[0]) * Math.cos((40.7 * Math.PI) / 180);
  return Math.abs(dy) >= Math.abs(dx) ? dy > 0 : dx < 0;
}
