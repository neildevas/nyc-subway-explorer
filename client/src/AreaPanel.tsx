import type { Feature, MultiPolygon, Point } from "geojson";
import { Bullet } from "./Bullet";
import type { AreaProps, Routes, StationProps } from "./types";

type Station = Feature<Point, StationProps>;

/** Side panel for a selected neighbourhood: what it is, the lines that stop there, and its stops. */
export function AreaPanel({ area, routes, stationsById, focusedLine, selectedStationId, transitOn, onFocusLine, onSelectStation, onClose }: {
  area: Feature<MultiPolygon, AreaProps>;
  routes: Routes;
  stationsById: Map<string, Station>;
  focusedLine: string;
  selectedStationId?: string;
  transitOn: boolean;
  onFocusLine: (routeId: string) => void;
  onSelectStation: (id: string) => void;
  onClose: () => void;
}) {
  const p = area.properties;
  const stops = p.stations
    .map((id) => stationsById.get(id))
    .filter((s): s is Station => !!s)
    .sort((a, b) => a.properties.name.localeCompare(b.properties.name, "en", { numeric: true }));

  return (
    <section className="card area-card">
      <div className="line-head">
        <div>
          <p className="eyebrow">{p.borough}</p>
          <h2>{p.name}</h2>
        </div>
        <button className="close" onClick={onClose} aria-label="Close neighborhood" title="Close (Esc)">×</button>
      </div>

      {p.alternateNames.length > 0 && (
        <p className="aka">Also called {p.alternateNames.join(", ")}</p>
      )}
      {p.summary && <p className="summary">{p.summary}</p>}
      {p.includes.length > 0 && (
        <p className="includes"><span className="muted">Includes</span> {p.includes.join(" · ")}</p>
      )}
      {p.wikipedia && (
        <a className="link" href={p.wikipedia} target="_blank" rel="noreferrer">Read more on Wikipedia ↗</a>
      )}

      {stops.length === 0 ? (
        <p className="muted">No subway stops in this neighborhood.</p>
      ) : (
        <>
          <h3>Lines that stop here</h3>
          <div className="bullets">
            {p.routes.filter((r) => routes[r]).map((r) => (
              <button
                key={r}
                className={`bullet-button${r === focusedLine ? " active" : ""}`}
                onClick={() => onFocusLine(r)}
                disabled={!transitOn}
                title={transitOn ? `Show all ${routes[r]?.name ?? r} stops` : "Turn on Transit to explore lines"}
              >
                <Bullet route={routes[r]} id={r} />
              </button>
            ))}
          </div>

          <h3>{stops.length} {stops.length === 1 ? "stop" : "stops"}</h3>
          <ul className="area-stops">
            {stops.map((s) => (
              <li key={s.properties.id} className={s.properties.id === selectedStationId ? "selected" : ""}>
                <button onClick={() => onSelectStation(s.properties.id)}>
                  <span className="stop-name">{s.properties.name}</span>
                  <span className="transfers">
                    {s.properties.routes.map((r) => <Bullet key={r} route={routes[r]} id={r} small />)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
