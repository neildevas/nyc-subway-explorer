import type { Feature, MultiPolygon, Point } from "geojson";
import { Bullet } from "./Bullet";
import type { ParkProps, Routes, StationProps } from "./types";

type Station = Feature<Point, StationProps>;
type Park = Feature<MultiPolygon, ParkProps>;

/** Rough walking time for a straight-line distance (streets add ~25%; 80 m per minute). */
const walk = (m: number) => {
  if (m === 0) return "In the park";
  const mins = Math.max(1, Math.round((m * 1.25) / 80));
  return `${mins} min walk`;
};

const acres = (n: number) => (n >= 10 ? Math.round(n).toLocaleString() : n < 1 ? n.toFixed(2) : n.toFixed(1));

/** Side panel for a selected park: where it is, what it is, and how to get there by subway. */
export function ParkPanel({ park, routes, stationsById, areaExists, selectedStationId, onSelectArea, onSelectStation, onClose }: {
  park: Park;
  routes: Routes;
  stationsById: Map<string, Station>;
  /** Whether a neighbourhood id can be opened (the neighbourhood layer has it) */
  areaExists: (id: string) => boolean;
  selectedStationId?: string;
  onSelectArea: (id: string) => void;
  onSelectStation: (id: string) => void;
  onClose: () => void;
}) {
  const p = park.properties;
  // NYC Parks serves every park's page by its property number (e.g. /parks/M010 is Central Park).
  const url = p.url || (/^[BMQRX]\d/.test(p.id) ? `https://www.nycgovparks.org/parks/${p.id}` : "");
  const nearby = p.nearby
    .map((n) => ({ ...n, station: stationsById.get(n.id) }))
    .filter((n): n is typeof n & { station: Station } => !!n.station);

  const crumb = (id: string, name: string) =>
    id && areaExists(id) ? (
      <button className="crumb-link" onClick={() => onSelectArea(id)} title={`Show ${name}`}>{name}</button>
    ) : (
      <span>{name}</span>
    );

  return (
    <section className="card park-card">
      <div className="line-head">
        <div>
          <nav className="crumbs" aria-label="Where this is">
            <span>{p.borough}</span>
            {p.neighborhood && <><span aria-hidden>›</span>{crumb(p.areaId, p.neighborhood)}</>}
            {p.subNeighborhood && <><span aria-hidden>›</span>{crumb(p.subAreaId, p.subNeighborhood)}</>}
          </nav>
          <h2>{p.name}</h2>
        </div>
        <button className="close" onClick={onClose} aria-label="Close park" title="Close (Esc)">×</button>
      </div>

      <div className="park-facts">
        <span className="park-type">{p.type || "Park"}</span>
        {p.acres > 0 && <span>{acres(p.acres)} {p.acres === 1 ? "acre" : "acres"}</span>}
        {p.waterfront && <span>Waterfront</span>}
      </div>
      {p.address && <p className="place">{p.address}</p>}
      {url && (
        <a className="link" href={url} target="_blank" rel="noreferrer">NYC Parks page ↗</a>
      )}

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
