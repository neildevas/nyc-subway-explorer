/**
 * Palettes for our own layers and the panel, and the Mapbox Standard basemap settings.
 *
 *   brownstone – warm daylight: brown-black ink, leafy parks, a painted-row-house palette.
 *   signage    – the subway's own look: black, white, Helvetica, and the MTA line colours.
 *
 * `T` always holds the current palette's colours; layers read it when they're styled.
 * (Basemap colour fields like `land` and `water` are left over from the light-style
 * version and unused with Standard.)
 */

/**
 * Mapbox Standard: 3D buildings and landmarks, light presets (dawn, day, dusk, night)
 * and built-in themes (default, faded). Its look comes from its own settings, so the
 * palettes below now only colour our layers (lines, stations, neighbourhoods, parks)
 * and the panel, following the light: Brownstone by day, Signage by night.
 */
export const BASEMAP_STYLE = "mapbox://styles/mapbox/standard";

export type LightPreset = "dawn" | "day" | "dusk" | "night";
export const LIGHT_PRESETS: LightPreset[] = ["dawn", "day", "dusk", "night"];
export type BasemapTheme = "default" | "faded";
/** Which palette suits each light: warm and inky by day, signage black and white after dark. */
export const themeForLight = (light: LightPreset): ThemeName => (light === "dusk" || light === "night" ? "signage" : "brownstone");

export interface MapPrefs { light: LightPreset; basemap: BasemapTheme; threeD: boolean }
const MAP_KEY = "standclear.map";
export function loadMapPrefs(): MapPrefs {
  const fallback: MapPrefs = { light: "day", basemap: "default", threeD: true };
  try {
    const saved = JSON.parse(localStorage.getItem(MAP_KEY) ?? "{}");
    return {
      light: LIGHT_PRESETS.includes(saved.light) ? saved.light : fallback.light,
      basemap: saved.basemap === "faded" ? "faded" : "default",
      threeD: typeof saved.threeD === "boolean" ? saved.threeD : fallback.threeD,
    };
  } catch { return fallback; }
}
export function saveMapPrefs(p: MapPrefs) {
  try { localStorage.setItem(MAP_KEY, JSON.stringify(p)); } catch { /* storage unavailable */ }
}

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

/** The current theme's colours (updated in place by setTheme). */
export const T: Colors = { ...THEMES.brownstone.colors };
export let currentTheme: ThemeName = "brownstone";

/** Switch palette: updates `T` and the page's `data-theme`. Restyle the map's layers after. */
export function setTheme(name: ThemeName) {
  currentTheme = name;
  Object.assign(T, THEMES[name].colors);
  document.documentElement.dataset.theme = name;
}
// Apply the theme for the saved light straight away, before the map or any CSS paints.
setTheme(themeForLight(loadMapPrefs().light));
