import { useMemo, useState } from "react";
import type { Feature, MultiPolygon } from "geojson";
import type { AreaProps } from "./types";

type Area = Feature<MultiPolygon, AreaProps>;

interface Result {
  /** The neighbourhood to select (a sub-neighbourhood resolves to its parent) */
  id: string;
  name: string;
  borough: string;
  stops: number;
  /** Why it matched, when it wasn't the name itself: "Also called UES", "Yorkville is in Upper East Side" */
  note?: string;
  score: number;
}

/** Lowercase, strip accents and punctuation, so "St. George" matches "st george". */
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** 3 = starts with the query, 2 = a word starts with it, 1 = contains it, 0 = no match. */
function score(text: string, q: string) {
  const t = norm(text);
  if (t.startsWith(q)) return 3;
  if (t.split(" ").some((w) => w.startsWith(q))) return 2;
  return t.includes(q) ? 1 : 0;
}

/** Search box for neighbourhoods: names, nicknames and sub-neighbourhoods. */
export function AreaSearch({ areas, onSelect }: { areas: Area[]; onSelect: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const byId = useMemo(() => new Map(areas.map((a) => [a.properties.id, a.properties])), [areas]);

  const results = useMemo(() => {
    const q = norm(query);
    if (!q) return [];
    const best = new Map<string, Result>();
    const offer = (r: Result) => {
      const prev = best.get(r.id);
      if (!prev || r.score > prev.score) best.set(r.id, r);
    };
    for (const { properties: p } of areas) {
      if (p.kind === "sub") {
        const parent = byId.get(p.parent);
        const s = score(p.name, q);
        // Rank a sub-neighbourhood match just below a direct name match of the same strength.
        if (parent && s) offer({ id: parent.id, name: parent.name, borough: parent.borough, stops: parent.stations.length, note: `${p.name} is in ${parent.name}`, score: s - 0.5 });
        continue;
      }
      const base = { id: p.id, name: p.name, borough: p.borough, stops: p.stations.length };
      const s = score(p.name, q);
      if (s) offer({ ...base, score: s });
      for (const alt of p.alternateNames) {
        const sa = score(alt, q);
        if (sa) offer({ ...base, note: `Also called ${alt}`, score: sa - 0.25 });
      }
    }
    return [...best.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, 8);
  }, [query, areas, byId]);

  const choose = (r: Result | undefined) => {
    if (!r) return;
    onSelect(r.id);
    setQuery("");
    setActive(0);
  };

  return (
    <div className="area-search">
      <input
        type="search"
        placeholder="Search neighborhoods"
        aria-label="Search neighborhoods"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setActive(0); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
          else if (e.key === "Enter") choose(results[active]);
          else if (e.key === "Escape") {
            // Clear the box without also closing whatever's selected on the map.
            e.stopPropagation();
            e.nativeEvent.stopImmediatePropagation();
            setQuery("");
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {query.trim() && (
        <ul className="suggestions" role="listbox">
          {results.length === 0 && <li className="empty">No neighborhoods match “{query.trim()}”</li>}
          {results.map((r, i) => (
            <li key={r.id} role="option" aria-selected={i === active}>
              <button className={i === active ? "active" : ""} onMouseEnter={() => setActive(i)} onClick={() => choose(r)}>
                <span>
                  <span className="name">{r.name}</span>
                  {r.note && <span className="note">{r.note}</span>}
                </span>
                <span className="meta">{r.borough}{r.stops ? ` · ${r.stops} ${r.stops === 1 ? "stop" : "stops"}` : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
