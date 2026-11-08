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

/** Pip positions for each die face, on a 3×3 grid (0–8, row by row). */
const FACES: Record<number, number[]> = {
  1: [4],
  2: [2, 6],
  3: [2, 4, 6],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

/**
 * One MTA line colour per face, chosen so white pips stand out
 * (the N/Q/R/W yellow and L grey are left out for that reason).
 */
const FACE_COLORS: Record<number, string> = {
  1: "#EE352E", // 1 2 3
  2: "#FF6319", // B D F M
  3: "#6CBE45", // G
  4: "#00933C", // 4 5 6
  5: "#0039A6", // A C E
  6: "#B933AD", // 7
};

function Die({ face }: { face: number }) {
  return (
    <svg className="die" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1.5" y="1.5" width="21" height="21" rx="5" style={{ fill: FACE_COLORS[face] }} />
      {FACES[face].map((p) => (
        <circle key={p} cx={6 + (p % 3) * 6} cy={6 + Math.floor(p / 3) * 6} r="1.9" />
      ))}
    </svg>
  );
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
 * Floating "Take me somewhere" dice button. Opens a small card to choose a random
 * stop or a random neighbourhood, optionally limited to some boroughs; choosing
 * tumbles the die, then calls onPick.
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
  const [face, setFace] = useState(5);
  const [rolling, setRolling] = useState(false);
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
    setRolling(true);
    // Flick through a few faces while it tumbles, then land and go.
    let flips = 0;
    const id = setInterval(() => {
      setFace(1 + Math.floor(Math.random() * 6));
      if (++flips >= 5) {
        clearInterval(id);
        setRolling(false);
        onPick(kind, chosen);
      }
    }, 90);
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
        className={`dice-button${rolling ? " rolling" : ""}${open ? " open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled || rolling}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Die face={face} />
        <span>Take me somewhere</span>
      </button>
    </div>
  );
}
