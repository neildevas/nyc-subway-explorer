/** Floating map-layer switches: Transit, Neighborhoods and Boroughs, each on/off independently. */
export function LayerToggles({ transit, areas, boroughs, areasAvailable, onTransit, onAreas, onBoroughs }: {
  transit: boolean;
  areas: boolean;
  boroughs: boolean;
  /** False when neighbourhood data wasn't built, so those buttons can explain why they're off */
  areasAvailable: boolean;
  onTransit: (on: boolean) => void;
  onAreas: (on: boolean) => void;
  onBoroughs: (on: boolean) => void;
}) {
  const needsData = "Run npm run build:data to add neighborhoods";
  return (
    <div className="layer-toggles" role="group" aria-label="Map layers">
      <button className={transit ? "on" : ""} aria-pressed={transit} onClick={() => onTransit(!transit)} title={transit ? "Hide transit" : "Show transit"}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="6" y="3" width="12" height="14" rx="3" />
          <path d="M6 11h12M9 21l1.5-4M15 21l-1.5-4" />
          <circle cx="9.5" cy="14" r="0.9" className="fill" />
          <circle cx="14.5" cy="14" r="0.9" className="fill" />
        </svg>
        Transit
      </button>
      <button
        className={areas ? "on" : ""}
        aria-pressed={areas}
        onClick={() => onAreas(!areas)}
        disabled={!areasAvailable}
        title={areasAvailable ? (areas ? "Hide neighborhoods" : "Show neighborhoods") : needsData}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 7l5-3 6 3 5-3v13l-5 3-6-3-5 3z" />
          <path d="M9 4v13M15 7v13" />
        </svg>
        Neighborhoods
      </button>
      <button
        className={boroughs ? "on" : ""}
        aria-pressed={boroughs}
        onClick={() => onBoroughs(!boroughs)}
        disabled={!areasAvailable}
        title={areasAvailable ? (boroughs ? "Hide boroughs" : "Show boroughs") : needsData}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 5h7v7H4zM13 5h7v4h-7zM13 11h7v8h-7zM4 14h7v5H4z" />
        </svg>
        Boroughs
      </button>
    </div>
  );
}
