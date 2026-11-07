import { useState } from "react";

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

/** Floating "roll the dice" button: tumbles, lands on a random face, then calls onRoll. */
export function DiceButton({ onRoll, disabled }: { onRoll: () => void; disabled?: boolean }) {
  const [face, setFace] = useState(5);
  const [rolling, setRolling] = useState(false);

  const roll = () => {
    if (rolling) return;
    setRolling(true);
    // Flick through a few faces while it tumbles, then land and go.
    let flips = 0;
    const id = setInterval(() => {
      setFace(1 + Math.floor(Math.random() * 6));
      if (++flips >= 5) {
        clearInterval(id);
        setRolling(false);
        onRoll();
      }
    }, 90);
  };

  return (
    <button className={`dice-button${rolling ? " rolling" : ""}`} onClick={roll} disabled={disabled} title="Take me somewhere random">
      <Die face={face} />
      <span>Take me somewhere</span>
    </button>
  );
}
