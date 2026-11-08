/**
 * NYC Parks Properties (NYC Open Data enfh-gkve): every property NYC Parks manages.
 * Downloaded at build time, filtered, simplified, and tagged with its neighbourhood
 * and nearest subway stops.
 */
import type { Feature, MultiPolygon, Polygon, Position } from "geojson";
import { distanceToRing, inPolygon, simplifyRing, type Area, type LonLat } from "./geo.js";

export const PARKS_URLS = [
  "https://data.cityofnewyork.us/resource/enfh-gkve.geojson?$limit=50000",
  "https://data.cityofnewyork.us/api/v3/views/enfh-gkve/query.geojson?accessType=DOWNLOAD",
];
export const PARKS_SOURCE = "https://data.cityofnewyork.us/Recreation/Parks-Properties/enfh-gkve";

type Props = Record<string, unknown>;
type RawFeature = Feature<Polygon | MultiPolygon | null, Props>;

/** Long, thin rights-of-way that aren't really places to visit. */
const SKIP_TYPES = new Set(["parkway", "strip", "mall", "retired n/a"]);

const BOROUGH_CODES: Record<string, string> = {
  M: "Manhattan", B: "Brooklyn", Q: "Queens", X: "Bronx", R: "Staten Island",
  "1": "Manhattan", "2": "Bronx", "3": "Brooklyn", "4": "Queens", "5": "Staten Island",
};

const KX = 111_320 * Math.cos((40.7 * Math.PI) / 180);
const KY = 110_540;
/** Walking-distance search radius for nearby stops (straight-line metres). */
const NEAR_METRES = 1200;
/** A park counts as being in a neighbourhood if at least this share of it lies there. */
const MIN_SHARE = 0.08;
/** Roughly how many sample points to drop across each park when working out its neighbourhoods. */
const SAMPLES = 400;

/** Socrata exports lowercase field names; other exports keep the original case. */
const field = (p: Props, key: string) => p[key] ?? p[key.toLowerCase()] ?? p[key.toUpperCase()];
const str = (v: unknown) => (v == null ? "" : String(v).trim());
const truthy = (v: unknown) => v === true || /^(true|yes|y|1)$/i.test(str(v));

const titleCase = (s: string) =>
  s.toLowerCase().replace(/(^|[\s/(-])([a-z])/g, (_, a, b) => a + b.toUpperCase());

/** Signed-area centroid of a ring (falls back to its first point for degenerate rings). */
function ringCentroid(ring: Position[]): { c: LonLat; area: number } {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x0, y0] = ring[j], [x1, y1] = ring[i];
    const f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-12) return { c: ring[0] as LonLat, area: 0 };
  return { c: [cx / (3 * a), cy / (3 * a)], area: Math.abs(a / 2) };
}

/**
 * Which areas a park covers, biggest share first. Drops a grid of points across the
 * park (plus its label point, so even tiny parks get one) and looks each one up.
 */
function areasCovered(polys: Position[][][], label: LonLat, lookup?: (p: LonLat) => Area | null): { area: Area; share: number }[] {
  if (!lookup) return [];
  const pts = polys.flat(2);
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  // Grid spacing in metres: about SAMPLES points over the bounding box, never finer than 15 m.
  const spacing = Math.max(15, Math.sqrt(((x1 - x0) * KX * (y1 - y0) * KY) / SAMPLES));
  const samples: LonLat[] = [label];
  for (let y = y0 + spacing / KY / 2; y < y1; y += spacing / KY) {
    for (let x = x0 + spacing / KX / 2; x < x1; x += spacing / KX) {
      if (polys.some((rings) => inPolygon([x, y], rings))) samples.push([x, y]);
    }
  }
  const counts = new Map<string, { area: Area; n: number }>();
  for (const p of samples) {
    const a = lookup(p);
    if (!a) continue;
    const c = counts.get(a.id) ?? { area: a, n: 0 };
    c.n++;
    counts.set(a.id, c);
  }
  const total = [...counts.values()].reduce((sum, c) => sum + c.n, 0);
  return [...counts.values()]
    .map((c) => ({ area: c.area, share: c.n / total }))
    .sort((a, b) => b.share - a.share);
}

/** Distance in metres from a point to a park (0 if inside). */
function distanceToPark(p: LonLat, polys: Position[][][]) {
  let best = Infinity;
  for (const rings of polys) {
    if (inPolygon(p, rings)) return 0;
    best = Math.min(best, distanceToRing(p, rings[0]));
  }
  return best;
}

async function download(): Promise<RawFeature[] | null> {
  for (const url of PARKS_URLS) {
    try {
      console.log(`Downloading parks ${url} …`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const features = (await res.json())?.features;
      if (!Array.isArray(features) || !features.length) throw new Error("no features");
      return features;
    } catch (err) {
      console.warn(`  failed: ${(err as Error).message}`);
    }
  }
  console.warn("  Skipping parks.");
  return null;
}

export interface StationPoint { id: string; coords: LonLat }

/**
 * Build the parks file, or null if the data couldn't be downloaded.
 * `areaAt`/`subAreaAt` place each park in the neighbourhoods it covers; `stations` are for nearby stops.
 */
export async function buildParks(
  stations: StationPoint[],
  areaAt?: (p: LonLat) => Area | null,
  subAreaAt?: (p: LonLat) => Area | null,
) {
  const raw = await download();
  if (!raw) return null;

  const skipped = new Map<string, number>();
  const skip = (why: string) => skipped.set(why, (skipped.get(why) ?? 0) + 1);
  const seen = new Set<string>();

  const features = raw.flatMap((f, i) => {
    const p = f.properties ?? {};
    const g = f.geometry;
    if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) { skip("no shape"); return []; }
    if (truthy(field(p, "RETIRED"))) { skip("retired"); return []; }
    const type = titleCase(str(field(p, "TYPECATEGORY")));
    if (SKIP_TYPES.has(type.toLowerCase())) { skip(type); return []; }
    const name = str(field(p, "SIGNNAME")) || str(field(p, "NAME311"));
    if (!name) { skip("no name"); return []; }

    const polys = (g.type === "Polygon" ? [g.coordinates] : g.coordinates)
      .map((rings) => rings.map((r) => simplifyRing(r, 4)))
      .filter((rings) => rings[0].length >= 4);
    if (!polys.length) { skip("no shape"); return []; }

    // Label point: centroid of the biggest piece, nudged inside if it lands outside.
    const pieces = polys.map((rings) => ({ rings, ...ringCentroid(rings[0]) })).sort((a, b) => b.area - a.area);
    let label = pieces[0].c;
    if (!inPolygon(label, pieces[0].rings)) label = pieces[0].rings[0][Math.floor(pieces[0].rings[0].length / 2)] as LonLat;

    // Every neighbourhood holding a real share of the park; the biggest is its "main" one.
    const inAreas = areasCovered(polys, label, areaAt);
    const inSubs = areasCovered(polys, label, subAreaAt);
    const keep = (list: { area: Area; share: number }[]) => list.filter((a, i) => i === 0 || a.share >= MIN_SHARE).map((a) => a.area);
    const areaList = keep(inAreas);
    const subList = inSubs.filter((a) => a.share >= MIN_SHARE).map((a) => a.area);
    const area = areaList[0] ?? null;
    // Only name a main sub-neighbourhood if it's inside the main neighbourhood.
    const sub = subList.find((s) => subAreaAt?.(label)?.id === s.id) ?? null;

    // Nearest subway stops within walking range (bounding-box prefilter first).
    const pts = polys.flat(2);
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    const padX = NEAR_METRES / KX, padY = NEAR_METRES / KY;
    const [x0, x1, y0, y1] = [Math.min(...xs) - padX, Math.max(...xs) + padX, Math.min(...ys) - padY, Math.max(...ys) + padY];
    const nearby = stations
      .filter((s) => s.coords[0] > x0 && s.coords[0] < x1 && s.coords[1] > y0 && s.coords[1] < y1)
      .map((s) => ({ id: s.id, m: Math.round(distanceToPark(s.coords, polys)) }))
      .filter((s) => s.m <= NEAR_METRES)
      .sort((a, b) => a.m - b.m)
      .slice(0, 4);

    let id = str(field(p, "GISPROPNUM")) || str(field(p, "OMPPROPID")) || `park-${i}`;
    if (seen.has(id)) id = `${id}-${i}`;
    seen.add(id);

    const acres = Number(str(field(p, "ACRES")));
    // Socrata can return URL columns as { url: "…" } objects rather than strings.
    const rawUrl = field(p, "URL");
    const url = str(rawUrl && typeof rawUrl === "object" ? (rawUrl as Props).url : rawUrl);
    return [{
      type: "Feature" as const,
      properties: {
        id,
        name,
        type,
        subcategory: titleCase(str(field(p, "SUBCATEGORY"))),
        acres: Number.isFinite(acres) ? Math.round(acres * 100) / 100 : 0,
        borough: BOROUGH_CODES[str(field(p, "BOROUGH")).toUpperCase()] ?? area?.borough ?? "",
        address: str(field(p, "ADDRESS")) || str(field(p, "LOCATION")),
        url: url && !/^https?:\/\//i.test(url) ? `https://${url}` : url,
        waterfront: truthy(field(p, "WATERFRONT")),
        areaId: area?.id ?? "",
        neighborhood: area?.name ?? "",
        subAreaId: sub?.id ?? "",
        subNeighborhood: sub?.name ?? "",
        /** Every neighbourhood the park passes through (main one first) */
        areaIds: areaList.map((a) => a.id),
        /** Every sub-neighbourhood it passes through */
        subAreaIds: subList.map((a) => a.id),
        /** [lon, lat] for the park's name */
        label: [Math.round(label[0] * 1e5) / 1e5, Math.round(label[1] * 1e5) / 1e5],
        /** Nearest subway stations: id and straight-line metres (0 = inside the park) */
        nearby,
      },
      geometry: { type: "MultiPolygon" as const, coordinates: polys },
    }];
  });

  const byType = new Map<string, number>();
  for (const f of features) byType.set(f.properties.type, (byType.get(f.properties.type) ?? 0) + 1);
  return {
    geojson: { type: "FeatureCollection" as const, features },
    summary: {
      total: raw.length,
      kept: features.length,
      skipped: [...skipped].map(([k, v]) => `${k} ${v}`).join(", "),
      byType: [...byType].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", "),
    },
  };
}
