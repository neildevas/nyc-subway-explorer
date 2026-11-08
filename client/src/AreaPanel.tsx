import { useState } from "react";
import type { Feature, MultiPolygon, Point } from "geojson";
import { Bullet } from "./Bullet";
import { marketStatus } from "./markets";
import type { AreaProps, MarketProps, ParkProps, Routes, StationProps } from "./types";

type Station = Feature<Point, StationProps>;
type Area = Feature<MultiPolygon, AreaProps>;
type Park = Feature<MultiPolygon, ParkProps>;
type Market = Feature<Point, MarketProps>;

/** How many parks to list before "Show all". */
const PARKS_SHOWN = 6;

/**
 * Side panel for a selected neighbourhood or sub-neighbourhood: where it sits
 * (Borough › Neighbourhood › Sub), what it is, what's inside it, and its lines and stops.
 */
export function AreaPanel({ area, parent, subs, parks = [], markets = [], onSelectArea, onSelectPark, onSelectMarket, routes, stationsById, focusedLine, selectedStationId, transitOn, onFocusLine, onSelectStation, onClose }: {
  area: Area;
  /** The neighbourhood a sub-neighbourhood sits in (null for a neighbourhood) */
  parent: Area | null;
  /** Sub-neighbourhoods inside this neighbourhood */
  subs: Area[];
  /** Parks inside this area (any order; shown largest first) */
  parks?: Park[];
  onSelectArea: (id: string) => void;
  onSelectPark?: (id: string) => void;
  /** Farmers markets inside this area */
  markets?: Market[];
  onSelectMarket?: (id: string) => void;
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
  const isSub = p.kind === "sub";
  const stops = p.stations
    .map((id) => stationsById.get(id))
    .filter((s): s is Station => !!s)
    .sort((a, b) => a.properties.name.localeCompare(b.properties.name, "en", { numeric: true }));
  const sortedSubs = [...subs].sort((a, b) => a.properties.name.localeCompare(b.properties.name));
  const sortedParks = [...parks].sort((a, b) => b.properties.acres - a.properties.acres);
  const [showAllParks, setShowAllParks] = useState(false);
  const shownParks = showAllParks ? sortedParks : sortedParks.slice(0, PARKS_SHOWN);

  return (
    <section className="card area-card">
      <div className="line-head">
        <div>
          <nav className="crumbs" aria-label="Where this is">
            <span>{p.borough}</span>
            {parent && (
              <>
                <span aria-hidden>›</span>
                <button className="crumb-link" onClick={() => onSelectArea(parent.properties.id)} title={`Show all of ${parent.properties.name}`}>
                  {parent.properties.name}
                </button>
              </>
            )}
          </nav>
          <h2>{p.name}</h2>
        </div>
        <button className="close" onClick={onClose} aria-label={`Close ${isSub ? "area" : "neighborhood"}`} title="Close (Esc)">×</button>
      </div>

      {p.alternateNames.length > 0 && (
        <p className="aka">Also called {p.alternateNames.join(", ")}</p>
      )}
      {p.summary && <p className="summary">{p.summary}</p>}
      {sortedSubs.length > 0 && (
        <div className="includes">
          <span className="muted">Includes</span>
          <div className="chips">
            {sortedSubs.map((s) => (
              <button key={s.properties.id} className="chip" onClick={() => onSelectArea(s.properties.id)}>
                {s.properties.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {p.wikipedia && (
        <a className="link" href={p.wikipedia} target="_blank" rel="noreferrer">Read more on Wikipedia ↗</a>
      )}

      {sortedParks.length > 0 && onSelectPark && (
        <>
          <h3>{sortedParks.length} {sortedParks.length === 1 ? "park" : "parks"}</h3>
          <ul className="area-parks">
            {shownParks.map((pk) => (
              <li key={pk.properties.id}>
                <button onClick={() => onSelectPark(pk.properties.id)}>
                  <span className="stop-name">{pk.properties.name}</span>
                  <span className="muted">{pk.properties.type}{pk.properties.acres >= 1 ? ` · ${Math.round(pk.properties.acres)} ac` : ""}</span>
                </button>
              </li>
            ))}
          </ul>
          {sortedParks.length > PARKS_SHOWN && (
            <button className="text-button" onClick={() => setShowAllParks((v) => !v)}>
              {showAllParks ? "Show fewer" : `Show all ${sortedParks.length}`}
            </button>
          )}
        </>
      )}

      {markets.length > 0 && onSelectMarket && (
        <>
          <h3>{markets.length} farmers {markets.length === 1 ? "market" : "markets"}</h3>
          <ul className="area-parks">
            {[...markets].sort((a, b) => a.properties.name.localeCompare(b.properties.name)).map((mk) => {
              const status = marketStatus(mk.properties);
              return (
                <li key={mk.properties.id}>
                  <button onClick={() => onSelectMarket(mk.properties.id)}>
                    <span className="stop-name">{mk.properties.name}</span>
                    <span className={`muted market-mini ${status.state}`}>{mk.properties.daysText || status.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {stops.length === 0 ? (
        <p className="muted">No subway stops in {p.name}.</p>
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
