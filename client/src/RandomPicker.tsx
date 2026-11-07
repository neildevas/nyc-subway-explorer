import { useEffect, useRef, useState } from "react";

export type RandomKind = "stop" | "neighborhood";

/** Pip positions for each die face, on a 3×3 grid (0–8, row by row). */
const FACES: Record<number, number[]> = {
  1: [4],
  2: [2, 6],
  3: [2, 4, 6],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function Die({ face }: { face: number }) {
  return (
    <svg className="die" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1.5" y="1.5" width="21" height="21" rx="5" />
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
];

/**
 * Floating "Take me somewhere" dice button. Opens a small card to choose a random
 * stop or a random neighbourhood; choosing tumbles the die, then calls onPick.
 */
export function RandomPicker({ onPick, disabled, unavailable = [] }: {
  onPick: (kind: RandomKind) => void;
  disabled?: boolean;
  /** Options to grey out (e.g. neighbourhoods when that data wasn't built) */
  unavailable?: RandomKind[];
}) {
  const [open, setOpen] = useState(false);
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
        onPick(kind);
      }
    }, 90);
  };

  return (
    <div className="random-picker" ref={root}>
      {open && (
        <div className="picker-card" role="menu" aria-label="Take me somewhere">
          <p className="picker-title">Take me to…</p>
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
                <span className="muted">{unavailable.includes(o.kind) ? "Not available yet" : o.detail}</span>
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
