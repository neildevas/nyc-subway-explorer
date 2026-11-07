/**
 * Neighbourhood polygons: point-in-polygon lookup for tagging stations, plus
 * simplified outlines for drawing on the map.
 */
import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from "geojson";

export type LonLat = [number, number];
type Props = Record<string, unknown>;

export interface Area {
  /** Unique id, e.g. "upper-east-side-manhattan" */
  id: string;
  name: string;
  /** Display name, e.g. "Staten Island" */
  borough: string;
}

const KX = 111_320 * Math.cos((40.7 * Math.PI) / 180);
const KY = 110_540;

function inRing(p: LonLat, ring: Position[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** First ring is the outline, the rest are holes. */
const inPolygon = (p: LonLat, rings: Position[][]) => inRing(p, rings[0]) && !rings.slice(1).some((h) => inRing(p, h));

function distanceToRing(p: LonLat, ring: Position[]) {
  let best = Infinity;
  for (let i = 1; i < ring.length; i++) {
    const ax = ring[i - 1][0] * KX, ay = ring[i - 1][1] * KY, bx = ring[i][0] * KX, by = ring[i][1] * KY;
    const px = p[0] * KX, py = p[1] * KY;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return best;
}

/** Douglas–Peucker simplification of one ring, tolerance in metres. Keeps it closed. */
function simplifyRing(ring: Position[], tolerance: number): Position[] {
  if (ring.length <= 5) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  const stack: [number, number][] = [[0, ring.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = ring[a][0] * KX, ay = ring[a][1] * KY, bx = ring[b][0] * KX, by = ring[b][1] * KY;
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    let maxD = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const px = ring[i][0] * KX, py = ring[i][1] * KY;
      const d = len ? Math.abs(dy * px - dx * py + bx * ay - by * ax) / len : Math.hypot(px - ax, py - ay);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tolerance && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  const out = ring.filter((_, i) => keep[i]).map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5]);
  return out.length >= 4 ? out : ring;
}

/**
 * Index a set of polygons. `toArea` reads each feature's properties into an Area
 * (or null to skip it); the original properties are kept for `toGeoJson`.
 */
export function makeAreaIndex(features: Feature<Polygon | MultiPolygon, Props>[], toArea: (props: Props) => Area | null) {
  const areas = features.flatMap((f) => {
    const area = f.geometry && toArea(f.properties ?? {});
    if (!area) return [];
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    const pts = polys.flat(2);
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    return [{ area, props: f.properties, polys, bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] }];
  });

  /**
   * The area containing the point. Stations right at a shoreline or a park edge
   * can fall just outside every polygon, so fall back to the nearest area within
   * `maxMetres` (pass 0 to require the point to be inside).
   */
  const lookup = (p: LonLat, maxMetres = 400): Area | null => {
    for (const a of areas) {
      const [x0, y0, x1, y1] = a.bbox;
      if (p[0] < x0 || p[0] > x1 || p[1] < y0 || p[1] > y1) continue;
      if (a.polys.some((rings) => inPolygon(p, rings))) return a.area;
    }
    let best: Area | null = null, bestD = maxMetres;
    for (const a of areas) {
      for (const rings of a.polys) {
        const d = distanceToRing(p, rings[0]);
        if (d < bestD) { bestD = d; best = a.area; }
      }
    }
    return best;
  };

  /** Simplified outlines (~8 m tolerance) as GeoJSON, with extra properties per area. */
  const toGeoJson = <P extends object>(extra: (a: Area, props: Props) => P): FeatureCollection<MultiPolygon, Area & P> => ({
    type: "FeatureCollection",
    features: areas.map((a) => ({
      type: "Feature",
      properties: { ...a.area, ...extra(a.area, a.props) },
      geometry: { type: "MultiPolygon", coordinates: a.polys.map((rings) => rings.map((r) => simplifyRing(r, 8))) },
    })),
  });

  return { lookup, toGeoJson, size: areas.length };
}
