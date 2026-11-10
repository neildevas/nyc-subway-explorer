import type { Feature, MultiPolygon, Point } from "geojson";
import { Bullet } from "./Bullet";
import { POI_KINDS, poiKindOf } from "./poi";
import type { AreaProps, Routes, StationProps } from "./types";

type Station = Feature<Point, StationProps>;
type Area = Feature<MultiPolygon, AreaProps>;

/** A clicked point of interest (vector tile features have no lasting id, so we keep what we need). */
export interface Poi {
  name: string;
  /** Detailed type from the data, e.g. "Museum", "Art Gallery", "University" */
  type: string;
  class: string;
  maki: string;
  coords: [number, number];
}

const KX = 111_320 * Math.cos((40.7 * Math.PI) / 180);
const KY = 110_540;
const metres = (a: [number, number], b: [number, number]) => Math.hypot((a[0] - b[0]) * KX, (a[1] - b[1]) * KY);
/** Rough walking time for a straight-line distance (streets add ~25%; 80 m per minute). */
const walk = (m: number) => `${Math.max(1, Math.round((m * 1.25) / 80))} min walk`;

/** Ray-casting point-in-polygon for one ring. */
function inRing([x, y]: [number, number], ring: number[][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inArea = (p: [number, number], a: Area) =>
  a.geometry.coordinates.some(([outer, ...holes]) => inRing(p, outer) && !holes.some((h) => inRing(p, h)));

/** "religious-christian" → "Religious christian"; used when the data has no type. */
const pretty = (s: string) => (s ? s[0].toUpperCase() + s.slice(1).replace(/[-_]/g, " ") : "");

/** Side panel for a selected point of interest: what and where it is, and the nearest subway. */
export function PoiPanel({ poi, areas, stations, routes, selectedStationId, onSelectArea, onSelectStation, onClose }: {
  poi: Poi;
  areas: Area[];
  stations: Station[];
  routes: Routes;
  selectedStationId?: string;
  onSelectArea: (id: string) => void;
  onSelectStation: (id: string) => void;
  onClose: () => void;
}) {
  const kind = POI_KINDS.find((k) => k.key === poiKindOf(poi.class, poi.maki));
  const hood = areas.find((a) => a.properties.kind === "neighborhood" && inArea(poi.coords, a));
  const sub = areas.find((a) => a.properties.kind === "sub" && inArea(poi.coords, a));
  const nearby = stations
    .map((s) => ({ station: s, m: metres(poi.coords, s.geometry.coordinates as [number, number]) }))
    .filter((n) => n.m <= 1200)
    .sort((a, b) => a.m - b.m)
    .slice(0, 3);
  const query = encodeURIComponent(`${poi.name}, New York, NY`);

  return (
    <section className="card poi-card">
      <div className="line-head">
        <div>
          <nav className="crumbs" aria-label="Where this is">
            <span>{hood?.properties.borough ?? "New York"}</span>
            {hood && <><span aria-hidden>›</span><button className="crumb-link" onClick={() => onSelectArea(hood.properties.id)}>{hood.properties.name}</button></>}
            {sub && <><span aria-hidden>›</span><button className="crumb-link" onClick={() => onSelectArea(sub.properties.id)}>{sub.properties.name}</button></>}
          </nav>
          <h2>{poi.name}</h2>
        </div>
        <button className="close" onClick={onClose} aria-label="Close place" title="Close (Esc)">×</button>
      </div>

      <div className="poi-facts">
        {kind && (
          <span className="poi-kind" style={{ background: kind.color }}>{kind.label}</span>
        )}
        {(poi.type || poi.maki) && <span>{poi.type || pretty(poi.maki)}</span>}
      </div>

      <div className="poi-links">
        <a className="link" href={`https://www.google.com/maps/search/?api=1&query=${query}`} target="_blank" rel="noreferrer">Google Maps ↗</a>
        <a className="link" href={`https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(poi.name + " New York")}`} target="_blank" rel="noreferrer">Wikipedia ↗</a>
      </div>

      <h3>Nearest subway</h3>
      {nearby.length === 0 ? (
        <p className="muted">No subway stops within a 15-minute walk.</p>
      ) : (
        <ul className="area-stops">
          {nearby.map(({ station: s, m }) => (
            <li key={s.properties.id} className={s.properties.id === selectedStationId ? "selected" : ""}>
              <button onClick={() => onSelectStation(s.properties.id)}>
                <span>
                  <span className="stop-name">{s.properties.name}</span>
                  <span className="walk">{walk(m)}</span>
                </span>
                <span className="transfers">
                  {s.properties.routes.map((r) => <Bullet key={r} route={routes[r]} id={r} small />)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
