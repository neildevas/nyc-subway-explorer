import type { Feature, Point } from "geojson";
import { Bullet } from "./Bullet";
import { marketStatus, seasonLabel } from "./markets";
import type { MarketProps, Routes, StationProps } from "./types";

type Station = Feature<Point, StationProps>;
type Market = Feature<Point, MarketProps>;

/** Rough walking time for a straight-line distance (streets add ~25%; 80 m per minute). */
const walk = (m: number) => `${Math.max(1, Math.round((m * 1.25) / 80))} min walk`;

/** Side panel for a selected farmers market: when it's on, what it takes, and how to get there. */
export function MarketPanel({ market, routes, stationsById, areaExists, selectedStationId, onSelectArea, onSelectStation, onClose }: {
  market: Market;
  routes: Routes;
  stationsById: Map<string, Station>;
  areaExists: (id: string) => boolean;
  selectedStationId?: string;
  onSelectArea: (id: string) => void;
  onSelectStation: (id: string) => void;
  onClose: () => void;
}) {
  const p = market.properties;
  const status = marketStatus(p);
  const season = seasonLabel(p);
  const [lon, lat] = market.geometry.coordinates;
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
    <section className="card market-card">
      <div className="line-head">
        <div>
          <nav className="crumbs" aria-label="Where this is">
            <span>{p.borough}</span>
            {p.neighborhood && <><span aria-hidden>›</span>{crumb(p.areaId, p.neighborhood)}</>}
            {p.subNeighborhood && <><span aria-hidden>›</span>{crumb(p.subAreaId, p.subNeighborhood)}</>}
          </nav>
          <h2>{p.name}</h2>
        </div>
        <button className="close" onClick={onClose} aria-label="Close market" title="Close (Esc)">×</button>
      </div>

      <p className={`market-status ${status.state}`}>{status.label}</p>

      <dl className="market-when">
        {p.daysText && <><dt>Days</dt><dd>{p.daysText}</dd></>}
        {p.hours && <><dt>Hours</dt><dd>{p.hours}</dd></>}
        {season && <><dt>Season</dt><dd>{season}</dd></>}
      </dl>

      {(p.ebt || p.healthBucks || p.features.length > 0) && (
        <div className="market-facts">
          {p.ebt && <span title="Accepts SNAP/EBT">Takes EBT</span>}
          {p.healthBucks && <span title="NYC Health Bucks: $2 coupons for fresh produce">Health Bucks</span>}
          {p.features.map((f) => <span key={f}>{f}</span>)}
        </div>
      )}

      {p.address && <p className="place">{p.address}</p>}
      <a className="link" href={p.website || `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`} target="_blank" rel="noreferrer">
        {p.website ? "Market website ↗" : "Open in Google Maps ↗"}
      </a>

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
      {p.year && (
        <p className="muted fine">
          {p.since && p.since < p.year ? `On the city's list since ${p.since}. ` : ""}
          From the {p.year} list{!p.yearRound && !p.season ? "; seasonal dates aren't published, so check before you go" : ". Check before you go"}.
        </p>
      )}
    </section>
  );
}
