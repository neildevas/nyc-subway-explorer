/** Floating map-layer switches: Transit, Neighborhoods, Boroughs, Parks and Places, each on/off independently. */
export function LayerToggles({ transit, areas, boroughs, parks, places, areasAvailable, parksAvailable, onTransit, onAreas, onBoroughs, onParks, onPlaces }: {
  transit: boolean;
  areas: boolean;
  boroughs: boolean;
  parks: boolean;
  /** Cultural and historical places (museums, landmarks, libraries…) */
  places: boolean;
  /** False when neighbourhood data wasn't built, so those buttons can explain why they're off */
  areasAvailable: boolean;
  /** False when parks data wasn't built */
  parksAvailable: boolean;
  onTransit: (on: boolean) => void;
  onAreas: (on: boolean) => void;
  onBoroughs: (on: boolean) => void;
  onParks: (on: boolean) => void;
  onPlaces: (on: boolean) => void;
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
      <button
        className={parks ? "on" : ""}
        aria-pressed={parks}
        onClick={() => onParks(!parks)}
        disabled={!parksAvailable}
        title={parksAvailable ? (parks ? "Hide parks" : "Show parks") : "Run npm run build:data to add parks"}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3l5 7h-3l4 6H6l4-6H7z" />
          <path d="M12 16v5" />
        </svg>
        Parks
      </button>
      <button className={places ? "on" : ""} aria-pressed={places} onClick={() => onPlaces(!places)} title={places ? "Hide places" : "Show museums, landmarks and other places"}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 20h16M5 20v-9M19 20v-9M9 20v-9M15 20v-9M3 11h18L12 4z" />
        </svg>
        Places
      </button>
    </div>
  );
}
