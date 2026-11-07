/** Floating map-layer switches: Transit and Neighborhoods, each on/off independently. */
export function LayerToggles({ transit, areas, areasAvailable, onTransit, onAreas }: {
  transit: boolean;
  areas: boolean;
  /** False when neighbourhood data wasn't built, so the button can explain why it's off */
  areasAvailable: boolean;
  onTransit: (on: boolean) => void;
  onAreas: (on: boolean) => void;
}) {
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
        title={areasAvailable ? (areas ? "Hide neighborhoods" : "Show neighborhoods") : "Run npm run build:data to add neighborhoods"}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 7l5-3 6 3 5-3v13l-5 3-6-3-5 3z" />
          <path d="M9 4v13M15 7v13" />
        </svg>
        Neighborhoods
      </button>
    </div>
  );
}
