import { useEffect, useRef, useState } from "react";
import { POI_KINDS, type PoiKind } from "./poi";
import { THEME_NAMES, THEMES, type ThemeName } from "./theme";

/**
 * A gear button under the layer toggles that opens the map's settings: the style
 * (day or night), street names, and which kinds of places to show. Closes on a click
 * outside or Esc.
 */
export function MapSettings({ theme, onTheme, streetNames, onStreetNames, poiKinds, onPoiKinds }: {
  theme: ThemeName;
  onTheme: (t: ThemeName) => void;
  /** Mapbox's street names */
  streetNames: boolean;
  onStreetNames: (on: boolean) => void;
  /** Which kinds of places the Places layer shows */
  poiKinds: PoiKind[];
  onPoiKinds: (kinds: PoiKind[]) => void;
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
            <h4>Style</h4>
            <div className="seg" role="radiogroup" aria-label="Map style">
              {THEME_NAMES.map((name) => (
                <button key={name} role="radio" aria-checked={theme === name} className={theme === name ? "on" : ""} onClick={() => onTheme(name)}>
                  <span className={`theme-swatch ${name}`} aria-hidden="true" />
                  {THEMES[name].label}
                </button>
              ))}
            </div>
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

        </div>
      )}
    </div>
  );
}
