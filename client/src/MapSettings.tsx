import { useEffect, useRef, useState } from "react";
import { POI_KINDS, type PoiKind } from "./poi";
import { LIGHT_PRESETS, type LightPreset } from "./theme";

const LIGHT_LABELS: Record<LightPreset, string> = { dawn: "Dawn", day: "Day", dusk: "Dusk", night: "Night" };

/**
 * A gear button under the layer toggles that opens the map's settings: time of day,
 * 3D buildings, which kinds of places to show, and how many decorative trains are running. Closes on a click outside
 * or Esc.
 */
export function MapSettings({ light, onLight, threeD, onThreeD, streetNames, onStreetNames, poiKinds, onPoiKinds, trains, trainsMax, trainsStep, trainsOff, onTrains }: {
  light: LightPreset;
  onLight: (l: LightPreset) => void;
  threeD: boolean;
  onThreeD: (on: boolean) => void;
  /** Mapbox's street names */
  streetNames: boolean;
  onStreetNames: (on: boolean) => void;
  /** Which kinds of places the Places layer shows */
  poiKinds: PoiKind[];
  onPoiKinds: (kinds: PoiKind[]) => void;
  /** Decorative trains running now */
  trains: number;
  trainsMax: number;
  trainsStep: number;
  /** True when Transit is off, so the trains are hidden anyway */
  trainsOff: boolean;
  onTrains: (n: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation(); // don't also clear the selection on the map
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  // Labels that say what each press will do, or why it can't.
  const fewer = Math.max(0, trains - trainsStep);
  const more = Math.min(trainsMax, trains + trainsStep);
  const minusTitle = trainsOff ? "Turn on Transit to see the trains"
    : trains === 0 ? "No trains running"
    : fewer === 0 ? "Stop all the trains" : `Remove ${trains - fewer} trains (down to ${fewer})`;
  const plusTitle = trainsOff ? "Turn on Transit to see the trains"
    : trains >= trainsMax ? `That's the most (${trainsMax})`
    : `Add ${more - trains} trains (up to ${more})`;
  const trainLabel = trains === 0 ? "No trains" : `${trains} ${trains === 1 ? "train" : "trains"}`;

  return (
    <div className="map-settings" ref={root}>
      <button
        className={`settings-button${open ? " open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Map settings"
        title="Map settings"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6" />
          <circle cx="12" cy="12" r="6.5" />
        </svg>
      </button>

      {open && (
        <div className="settings-card" role="dialog" aria-label="Map settings">
          <section>
            <h4>Time of day</h4>
            <div className="seg" role="radiogroup" aria-label="Time of day">
              {LIGHT_PRESETS.map((l) => (
                <button key={l} role="radio" aria-checked={light === l} className={light === l ? "on" : ""} onClick={() => onLight(l)}>
                  <span className={`light-icon ${l}`} aria-hidden="true" />
                  {LIGHT_LABELS[l]}
                </button>
              ))}
            </div>
          </section>

          <section className="settings-row">
            <div>
              <h4>3D buildings</h4>
              <p className="muted">Tilt the map. Right-drag (or Ctrl-drag) to rotate.</p>
            </div>
            <button
              className={`switch${threeD ? " on" : ""}`}
              role="switch"
              aria-checked={threeD}
              onClick={() => onThreeD(!threeD)}
              aria-label="3D buildings"
            >
              <span />
            </button>
          </section>

          <section className="settings-row">
            <div>
              <h4>Street names</h4>
              <p className="muted">Hide them for a calmer map.</p>
            </div>
            <button className={`switch${streetNames ? " on" : ""}`} role="switch" aria-checked={streetNames} onClick={() => onStreetNames(!streetNames)} aria-label="Street names">
              <span />
            </button>
          </section>

          <section>
            <h4>Places</h4>
            <p className="muted">Kinds of places the Places layer shows: culture and history, no hotels, shops or banks.</p>
            <div className="chips poi-kinds" role="group" aria-label="Kinds of places">
              {POI_KINDS.map((k) => {
                const on = poiKinds.includes(k.key);
                return (
                  <button
                    key={k.key}
                    className={`chip${on ? " on" : ""}`}
                    aria-pressed={on}
                    onClick={() => onPoiKinds(on ? poiKinds.filter((x) => x !== k.key) : [...poiKinds, k.key])}
                  >
                    <span className="poi-dot" style={{ background: k.color }} aria-hidden="true" />
                    {k.label}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="settings-row">
            <div>
              <h4>Ambient trains</h4>
              <p className="muted">Decorative, not live data.</p>
            </div>
            <div className={`ambient-control${trainsOff ? " off" : ""}`} role="group" aria-label="Decorative trains">
              <button onClick={() => onTrains(fewer)} disabled={trainsOff || trains <= 0} aria-label={minusTitle} title={minusTitle}>−</button>
              <span aria-live="polite">
                <span className="ambient-dot" aria-hidden="true" />
                {trainLabel}
                {trains >= trainsMax && <small>max</small>}
              </span>
              <button onClick={() => onTrains(more)} disabled={trainsOff || trains >= trainsMax} aria-label={plusTitle} title={plusTitle}>+</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
