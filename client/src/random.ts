/** Where the user has been sent before, per kind, so rolls prefer somewhere new. */
const VISITED_KEYS = { stop: "standclear.visited", neighborhood: "standclear.visitedAreas", park: "standclear.visitedParks" } as const;
type Kind = keyof typeof VISITED_KEYS;

export function loadVisited(kind: Kind = "stop"): string[] {
  try { return JSON.parse(localStorage.getItem(VISITED_KEYS[kind]) ?? "[]"); } catch { return []; }
}
export function saveVisited(ids: string[], kind: Kind = "stop") {
  try { localStorage.setItem(VISITED_KEYS[kind], JSON.stringify(ids)); } catch { /* storage unavailable */ }
}

/**
 * Pick a random item (a station or a neighbourhood), preferring ones the user
 * hasn't been sent to before. Once they've seen them all, any will do.
 */
export function pickRandom<T extends { properties: { id: string } }>(pool: T[], visited: string[]): T | null {
  if (!pool.length) return null;
  const unseen = pool.filter((item) => !visited.includes(item.properties.id));
  const from = unseen.length ? unseen : pool;
  // crypto-backed so it never feels "streaky"
  const i = crypto.getRandomValues(new Uint32Array(1))[0] % from.length;
  return from[i];
}
