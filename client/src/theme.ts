/**
 * Map themes. Each one recolours Mapbox's light style (so switching never reloads the
 * map) and our own layers, and sets `data-theme` on <html> for the CSS.
 *
 *   brownstone – "warm daylight explorer": limestone land, brownstone buildings, leafy
 *                parks, brown-black ink, an eclectic painted-row-house palette.
 *   signage    – the subway's own look: black, white, Helvetica, and the MTA line colours.
 *
 * `T` always holds the current theme's colours; layers read it when they're styled.
 */
import type mapboxgl from "mapbox-gl";

export const BASEMAP_STYLE = "mapbox://styles/mapbox/light-v11";

export interface Colors {
  /** Page background behind the map while it loads */
  page: string;
  land: string;
  water: string;
  waterLabel: string;
  park: string;
  building: string;
  buildingEdge: string;
  road: string;
  roadCasing: string;
  roadMinor: string;
  boundary: string;
  /** Main text ink and the halo that keeps it readable over the map */
  ink: string;
  inkSoft: string;
  inkFaint: string;
  halo: string;
  /** Selection: a glow colour and an outline colour */
  select: string;
  selectInk: string;
  stationFill: string;
  stationStroke: string;
  /** Decorative trains */
  ambient: string;
  /** Parks from our data, and their names */
  parkGreen: string;
  parkLabel: string;
  /** Neighbourhood outlines when not highlighted */
  areaLine: string;
  subLine: string;
  /** Neighbourhood fill strength (normal, hovered): darker maps need a bit more */
  areaFill: [number, number];
  /**
   * Neighbourhood colours. Five, because the build colours neighbouring areas 0–4 so
   * no two that touch share a colour.
   */
  areaPalette: [string, string, string, string, string];
  boroughs: Record<string, string>;
}

export const THEMES = {
  brownstone: {
    label: "Brownstone",
    colors: {
      page: "#f2e9da",
      land: "#f5eee2", // limestone and parchment
      water: "#9fcbe0",
      waterLabel: "#3f7391",
      park: "#cde2b2",
      building: "#e7d4be", // brownstone blocks when zoomed in
      buildingEdge: "#d6bea2",
      road: "#ffffff",
      roadCasing: "#e2d4bf",
      roadMinor: "#fcf8f1",
      boundary: "#c4b298",
      ink: "#33251a", // brown-black, like an old printed map
      inkSoft: "#644d3b",
      inkFaint: "#8d7964",
      halo: "#fffaf1",
      select: "#e3a72f", // mustard glow; yellow alone vanishes on cream
      selectInk: "#33251a",
      stationFill: "#ffffff",
      stationStroke: "#33251a",
      ambient: "#6f5a47",
      parkGreen: "#5a9e4f",
      parkLabel: "#2e6630",
      areaLine: "#bba78c",
      subLine: "#cdbba2",
      areaFill: [0.08, 0.22],
      areaPalette: ["#e3a72f", "#d46a43", "#4e9a8c", "#9a6aa0", "#7ea35f"],
      boroughs: { Manhattan: "#d46a43", Brooklyn: "#9a6aa0", Queens: "#4e9a8c", Bronx: "#e3a72f", "Staten Island": "#7ea35f" },
    },
  },
  signage: {
    label: "Signage",
    colors: {
      page: "#000000",
      land: "#0b0b0b",
      water: "#1b2228",
      waterLabel: "#7d8b96",
      park: "#122016",
      building: "#161616",
      buildingEdge: "#222222",
      road: "#2b2b2b",
      roadCasing: "#000000",
      roadMinor: "#1c1c1c",
      boundary: "#3a3a3a",
      ink: "#ffffff",
      inkSoft: "#d0d0d0",
      inkFaint: "#9a9a9a",
      halo: "#000000",
      select: "#FCCC0A", // N/Q/R/W yellow
      selectInk: "#ffffff",
      stationFill: "#ffffff",
      stationStroke: "#000000",
      ambient: "#A7A9AC", // shuttle gray
      parkGreen: "#00933C", // 4/5/6 green
      parkLabel: "#6CBE45", // G green
      areaLine: "#3d3d3d",
      subLine: "#333333",
      areaFill: [0.12, 0.28],
      // A/C/E blue, B/D/F/M orange, 4/5/6 green, 7 purple, N/Q/R/W yellow
      areaPalette: ["#0062CF", "#FF6319", "#00933C", "#B933AD", "#FCCC0A"],
      boroughs: { Manhattan: "#EE352E", Brooklyn: "#FF6319", Queens: "#B933AD", Bronx: "#00933C", "Staten Island": "#0062CF" },
    },
  },
} satisfies Record<string, { label: string; colors: Colors }>;

export type ThemeName = keyof typeof THEMES;
export const THEME_NAMES = Object.keys(THEMES) as ThemeName[];
const THEME_KEY = "standclear.theme";

function loadTheme(): ThemeName {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved && saved in THEMES) return saved as ThemeName;
  } catch { /* storage unavailable */ }
  return "brownstone";
}

/** The current theme's colours (updated in place by setTheme). */
export const T: Colors = { ...THEMES.brownstone.colors };
export let currentTheme: ThemeName = "brownstone";

/** Switch theme: updates `T`, the page's `data-theme`, and remembers the choice. Restyle the map after. */
export function setTheme(name: ThemeName) {
  currentTheme = name;
  Object.assign(T, THEMES[name].colors);
  document.documentElement.dataset.theme = name;
  try { localStorage.setItem(THEME_KEY, name); } catch { /* storage unavailable */ }
}
// Apply the saved theme straight away, before the map or any CSS paints.
setTheme(loadTheme());

const set = (m: mapboxgl.Map, id: string, prop: string, value: unknown) => {
  try { m.setPaintProperty(id, prop as never, value as never); } catch { /* not this layer's property */ }
};

/** Recolour the basemap's layers warm. Safe to call on any classic Mapbox style. */
export function applyBasemapTheme(m: mapboxgl.Map) {
  for (const layer of m.getStyle()?.layers ?? []) {
    const { id, type } = layer;
    if (type === "background") set(m, id, "background-color", T.land);
    else if (type === "fill") {
      if (/water/.test(id)) set(m, id, "fill-color", T.water);
      else if (/park|national|landcover|grass|wood|pitch|cemetery/.test(id)) set(m, id, "fill-color", T.park);
      else if (/building/.test(id)) { set(m, id, "fill-color", T.building); set(m, id, "fill-outline-color", T.buildingEdge); }
      else if (/^land$|landuse|land-structure|aeroway/.test(id)) set(m, id, "fill-color", T.land);
    } else if (type === "line") {
      if (/water/.test(id)) set(m, id, "line-color", T.water);
      else if (/admin|boundary/.test(id)) set(m, id, "line-color", T.boundary);
      else if (/case|casing/.test(id)) set(m, id, "line-color", T.roadCasing);
      else if (/motorway|trunk|primary|secondary|tertiary|major/.test(id)) set(m, id, "line-color", T.road);
      else if (/road|street|bridge|tunnel|path|pedestrian|service/.test(id)) set(m, id, "line-color", T.roadMinor);
    } else if (type === "symbol") {
      const water = /water|marine/.test(id);
      set(m, id, "text-color", water ? T.waterLabel : /road|street/.test(id) ? T.inkFaint : T.inkSoft);
      set(m, id, "text-halo-color", T.halo);
    }
  }
}
