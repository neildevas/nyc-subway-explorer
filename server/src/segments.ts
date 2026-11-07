/**
 * Turns per-route shapes into a "transit map" network: the system is split into
 * station-to-station segments, and when several routes run through the same
 * segment each gets a `slot` so the client can draw them side by side
 * (e.g. 4 / 5 / 6 on Lexington Ave, or C, B, D on Central Park West).
 *
 * Express runs are split at the local stations they pass, so an express
 * segment like 125 St → 59 St lines up with the local segments it overlaps.
 */
import type { Feature, FeatureCollection, LineString } from "geojson";

export type LonLat = [number, number];

export interface Pattern {
  routeId: string;
  color: string;
  /** Shape polyline, in travel order */
  coords: LonLat[];
  /** Parent station ids, in travel order */
  stops: string[];
}

export interface SegmentProps {
  key: string;
  routeId: string;
  color: string;
  /** Comma-wrapped route id, e.g. ",B," (kept as a string so Mapbox `in` can match it) */
  routes: string;
  /** Position across the corridor: 0 = centre, ±0.5, ±1 … */
  slot: number;
}

/** Stations within this many metres of a route's shape count as "on" that corridor. */
const SNAP_METRES = 70;
const EPS = 1e-6;

// Local planar projection, good enough at NYC's scale.
const KX = 111_320 * Math.cos((40.7 * Math.PI) / 180);
const KY = 110_540;
const xy = ([lon, lat]: LonLat): [number, number] => [lon * KX, lat * KY];

interface Projection { pos: number; dist: number }

/** Closest point on the polyline at or after `minPos` (fractional vertex index). */
function project(pts: [number, number][], p: [number, number], minPos = 0): Projection {
  let best: Projection = { pos: minPos, dist: Infinity };
  for (let i = Math.floor(minPos); i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    if (i + t < minPos) t = minPos - i;
    const qx = ax + t * dx, qy = ay + t * dy;
    const dist = Math.hypot(p[0] - qx, p[1] - qy);
    if (dist < best.dist) best = { pos: i + t, dist };
  }
  return best;
}

function pointAt(coords: LonLat[], pos: number): LonLat {
  const i = Math.min(Math.floor(pos), coords.length - 2);
  const t = pos - i;
  const [a, b] = [coords[i], coords[i + 1]];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** The part of the polyline between two fractional positions (from < to). */
function slice(coords: LonLat[], from: number, to: number): LonLat[] {
  const out: LonLat[] = [pointAt(coords, from)];
  for (let i = Math.floor(from) + 1; i < to; i++) out.push(coords[i]);
  out.push(pointAt(coords, to));
  return out;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

export function buildSegments(
  patterns: Pattern[],
  stations: Map<string, LonLat>,
  /** Route ids in display order; decides which side of a shared corridor each route takes. */
  routeOrder: string[],
): FeatureCollection<LineString, SegmentProps> {
  const stationXY = [...stations].map(([id, ll]) => ({ id, p: xy(ll) }));

  // key "a|b" (a < b) -> routeId -> segment
  const segments = new Map<string, Map<string, { coords: LonLat[]; color: string }>>();

  const add = (routeId: string, color: string, u: string, v: string, coords: LonLat[]) => {
    if (u === v) return;
    const [a, b] = u < v ? [u, v] : [v, u];
    const key = `${a}|${b}`;
    const byRoute = segments.get(key) ?? new Map();
    segments.set(key, byRoute);
    if (byRoute.has(routeId)) return;
    // Always orient a → b, so line-offset puts each route on a consistent side.
    byRoute.set(routeId, { coords: u === a ? coords : [...coords].reverse(), color });
  };

  for (const pat of patterns) {
    if (pat.coords.length < 2 || pat.stops.length < 2) continue;
    const pts = pat.coords.map(xy);

    // Stations close to this shape (cheap bbox prefilter first)
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const nearby = stationXY
      .filter(({ p }) => p[0] > minX - SNAP_METRES && p[0] < maxX + SNAP_METRES && p[1] > minY - SNAP_METRES && p[1] < maxY + SNAP_METRES)
      .map(({ id, p }) => ({ id, ...project(pts, p) }))
      .filter((s) => s.dist <= SNAP_METRES);

    let prev = { id: pat.stops[0], pos: project(pts, xy(stations.get(pat.stops[0])!)).pos };
    for (const nextId of pat.stops.slice(1)) {
      const ll = stations.get(nextId);
      if (!ll) continue;
      // Search forward from the previous stop so loops/terminals don't snap backwards.
      const next = { id: nextId, pos: project(pts, xy(ll), prev.pos).pos };

      // Stations this train passes without stopping (express runs, crossings)
      const passed = nearby
        .filter((s) => s.pos > prev.pos + EPS && s.pos < next.pos - EPS && s.id !== prev.id && s.id !== next.id)
        .sort((a, b) => a.pos - b.pos);

      const chain = [prev, ...passed, next];
      for (let i = 0; i < chain.length - 1; i++) {
        const [u, v] = [chain[i], chain[i + 1]];
        const coords = v.pos - u.pos > EPS ? slice(pat.coords, u.pos, v.pos) : [stations.get(u.id)!, stations.get(v.id)!];
        add(pat.routeId, pat.color, u.id, v.id, coords);
      }
      prev = next;
    }
  }

  const rank = (r: string) => { const i = routeOrder.indexOf(r); return i < 0 ? 999 : i; };
  const features: Feature<LineString, SegmentProps>[] = [];
  for (const [key, byRoute] of segments) {
    const routeIds = [...byRoute.keys()].sort((a, b) => rank(a) - rank(b));
    routeIds.forEach((routeId, i) => {
      const seg = byRoute.get(routeId)!;
      features.push({
        type: "Feature",
        properties: {
          key,
          routeId,
          color: seg.color,
          routes: `,${routeId},`,
          slot: i - (routeIds.length - 1) / 2,
        },
        geometry: { type: "LineString", coordinates: seg.coords.map(([x, y]) => [round(x), round(y)]) },
      });
    });
  }
  return { type: "FeatureCollection", features };
}
