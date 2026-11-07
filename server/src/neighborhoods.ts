/**
 * Colloquial NYC neighbourhoods from Chris Whong's NYC Neighborhood Boundaries
 * (https://github.com/chriswhong/nyc-neighborhood-boundaries), CC BY-SA 4.0,
 * derived from Zillow's 2017 neighbourhood boundaries.
 *
 * Two levels: contiguous "neighborhood" polygons (Upper East Side) and
 * "sub-neighborhood" polygons inside them (Carnegie Hill, Lenox Hill, Yorkville).
 */
import type { Feature, MultiPolygon, Polygon } from "geojson";
import { makeAreaIndex, type Area } from "./geo.js";

export const NEIGHBORHOODS_URL =
  "https://raw.githubusercontent.com/chriswhong/nyc-neighborhood-boundaries/main/dist/nyc-neighborhood-boundaries.geojson";
export const NEIGHBORHOODS_SOURCE = "https://github.com/chriswhong/nyc-neighborhood-boundaries";

type Props = Record<string, unknown>;
type RawFeature = Feature<Polygon | MultiPolygon, Props>;

const BOROUGHS: Record<string, string> = {
  manhattan: "Manhattan",
  brooklyn: "Brooklyn",
  queens: "Queens",
  bronx: "Bronx",
  "staten-island": "Staten Island",
};

const str = (v: unknown) => (typeof v === "string" ? v : "");
const names = (v: unknown) => (Array.isArray(v) ? v.map((x) => str((x as Props)?.name ?? x)).filter(Boolean) : []);

/** Download and index the neighbourhoods, or null if unavailable (the app works without them). */
export async function loadNeighborhoods() {
  let features: RawFeature[];
  try {
    console.log(`Downloading neighbourhoods ${NEIGHBORHOODS_URL} …`);
    const res = await fetch(NEIGHBORHOODS_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    features = (await res.json())?.features;
    if (!Array.isArray(features) || !features.length) throw new Error("no features");
  } catch (err) {
    console.warn(`  failed: ${(err as Error).message}. Skipping neighbourhoods.`);
    return null;
  }

  // A few slugs repeat in the source, so give every feature a unique id up front.
  const seen = new Set<string>();
  const idBySlug = new Map<string, string>();
  features.forEach((f, i) => {
    const p = (f.properties ??= {});
    const slug = str(p.slug) || str(p.name).toLowerCase().replace(/\W+/g, "-");
    let id = slug;
    if (seen.has(id)) id = `${slug}-${i}`;
    seen.add(id);
    if (!idBySlug.has(slug)) idBySlug.set(slug, id);
    p.__id = id;
  });

  const toArea = (p: Props): Area | null =>
    str(p.name) ? { id: str(p.__id), name: str(p.name), borough: BOROUGHS[str(p.borough)] ?? str(p.borough) } : null;
  const isSub = (f: RawFeature) => f.properties.kind === "sub-neighborhood";

  const main = makeAreaIndex(features.filter((f) => !isSub(f)), toArea);
  const subs = makeAreaIndex(features.filter(isSub), toArea);

  /** Properties both levels share, read from the source data. */
  const details = (p: Props) => ({
    color: typeof p.color === "number" ? p.color : 0,
    summary: str(p.summary),
    wikipedia: str(p.wikipedia_url),
    alternateNames: Array.isArray(p.alternate_names) ? (p.alternate_names as unknown[]).map(str).filter(Boolean) : [],
  });

  return {
    /** The neighbourhood a point is in (falls back to the nearest one within 400 m). */
    neighborhoodAt: main.lookup,
    /** The sub-neighbourhood a point is in, if any (must be inside). */
    subNeighborhoodAt: (p: [number, number]) => subs.lookup(p, 0),
    /**
     * Both levels as one GeoJSON file. `stationsIn` gives the station ids inside
     * a neighbourhood and the lines that stop there.
     */
    toGeoJson(stationsIn: (id: string) => { stations: string[]; routes: string[] }) {
      const top = main.toGeoJson((a, p) => ({
        kind: "neighborhood" as const,
        ...details(p),
        includes: names(p.child_neighborhoods),
        parent: "",
        ...stationsIn(a.id),
      }));
      const inner = subs.toGeoJson((_, p) => {
        const parentSlug = str((p.parent_neighborhoods as Props[] | undefined)?.[0]?.slug);
        return {
          kind: "sub" as const,
          ...details(p),
          includes: [] as string[],
          parent: idBySlug.get(parentSlug) ?? "",
          stations: [] as string[],
          routes: [] as string[],
        };
      });
      return { type: "FeatureCollection" as const, features: [...top.features, ...inner.features] };
    },
    counts: { neighborhoods: main.size, subNeighborhoods: subs.size },
  };
}
