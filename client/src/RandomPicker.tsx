import { useEffect, useRef, useState } from "react";

export type RandomKind = "stop" | "neighborhood" | "park";

const BOROUGHS = ["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"];
const BOROUGHS_KEY = "standclear.randomBoroughs";

const loadBoroughs = (): string[] => {
  try { return JSON.parse(localStorage.getItem(BOROUGHS_KEY) ?? "[]"); } catch { return []; }
};

/** "in Brooklyn", "in Brooklyn or Queens", "in Manhattan, Brooklyn or Queens" */
function inBoroughs(list: string[]) {
  if (!list.length) return "";
  const ordered = BOROUGHS.filter((b) => list.includes(b));
  return ` in ${ordered.length === 1 ? ordered[0] : `${ordered.slice(0, -1).join(", ")} or ${ordered[ordered.length - 1]}`}`;
}

const OPTIONS: { kind: RandomKind; title: string; detail: string; icon: JSX.Element }[] = [
  {
    kind: "stop",
    title: "A random stop",
    detail: "Ride somewhere new",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="6" y="3" width="12" height="14" rx="3" />
        <path d="M6 11h12M9 21l1.5-4M15 21l-1.5-4" />
      </svg>
    ),
  },
  {
    kind: "neighborhood",
    title: "A random neighborhood",
    detail: "Wander somewhere new",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7l5-3 6 3 5-3v13l-5 3-6-3-5 3z" />
        <path d="M9 4v13M15 7v13" />
      </svg>
    ),
  },
  {
    kind: "park",
    title: "A random park",
    detail: "Get some fresh air",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3l5 7h-3l4 6H6l4-6H7z" />
        <path d="M12 16v5" />
      </svg>
    ),
  },
];

/**
 * Floating "Take me somewhere" button. Opens a small card to choose a random stop,
 * neighbourhood or park, optionally limited to some boroughs, then calls onPick.
 */
export function RandomPicker({ onPick, disabled, unavailable = [], boroughsAvailable = true }: {
  /** `boroughs` is empty for "anywhere" */
  onPick: (kind: RandomKind, boroughs: string[]) => void;
  disabled?: boolean;
  /** Options to grey out (e.g. neighbourhoods when that data wasn't built) */
  unavailable?: RandomKind[];
  /** False when stations have no borough data, so the borough chips are hidden */
  boroughsAvailable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [boroughs, setBoroughs] = useState<string[]>(loadBoroughs);
  useEffect(() => {
    try { localStorage.setItem(BOROUGHS_KEY, JSON.stringify(boroughs)); } catch { /* storage unavailable */ }
  }, [boroughs]);
  const toggleBorough = (b: string) => setBoroughs((list) => (list.includes(b) ? list.filter((x) => x !== b) : [...list, b]));
  const chosen = boroughsAvailable ? boroughs : [];
  const root = useRef<HTMLDivElement>(null);

  // Close on a click outside, or on Esc (without Esc also closing things on the map).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true); // capture: runs before the app's own Esc handling
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const choose = (kind: RandomKind) => {
    setOpen(false);
    onPick(kind, chosen);
  };

  return (
    <div className="random-picker" ref={root}>
      {open && (
        <div className="picker-card" role="menu" aria-label="Take me somewhere">
          <p className="picker-title">Take me to…</p>
          {boroughsAvailable && (
            <div className="picker-boroughs" role="group" aria-label="Boroughs">
              {BOROUGHS.map((b) => (
                <button
                  key={b}
                  className={`chip${boroughs.includes(b) ? " on" : ""}`}
                  aria-pressed={boroughs.includes(b)}
                  onClick={() => toggleBorough(b)}
                >
                  {b}
                </button>
              ))}
              <span className="picker-scope">{chosen.length ? "" : "Anywhere in the city"}</span>
            </div>
          )}
          {OPTIONS.map((o) => (
            <button
              key={o.kind}
              role="menuitem"
              className="picker-option"
              onClick={() => choose(o.kind)}
              disabled={unavailable.includes(o.kind)}
            >
              <span className="picker-icon">{o.icon}</span>
              <span>
                <strong>{o.title}</strong>
                <span className="muted">{unavailable.includes(o.kind) ? "Not available yet" : o.detail + inBoroughs(chosen)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      <button
        className={`go-button${open ? " open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span>Take me somewhere</span>
      </button>
    </div>
  );
}
