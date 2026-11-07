/** A route bullet: the line's letter or number in a circle of its colour. */
export function Bullet({ route, id, small }: { route?: { name: string; color: string; textColor: string }; id: string; small?: boolean }) {
  return (
    <span
      className={`bullet${small ? " small" : ""}`}
      style={{ background: route?.color ?? "#808183", color: route?.textColor ?? "#fff" }}
    >
      {route?.name ?? id}
    </span>
  );
}

/** Official route order: numbered lines first, then lettered (1 2 3 … A B C …). */
export function routeSort(a: string, b: string) {
  const an = /^\d/.test(a), bn = /^\d/.test(b);
  if (an !== bn) return an ? -1 : 1;
  return a.localeCompare(b, "en", { numeric: true });
}
