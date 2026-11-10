/**
 * Palettes for our own layers and the panel, and the Mapbox Standard basemap settings.
 *
 *   brownstone – warm daylight: brown-black ink, leafy parks, a painted-row-house palette.
 *   signage    – the subway's own look: black, white, Helvetica, and the MTA line colours.
 *
 * `T` always holds the current palette's colours; layers read it when they're styled.
 * The basemap colour fields (`land`, `water`, `road`…) recolour Standard through its
 * colour overrides (see basemapColors).
 */

/**
 * Mapbox Standard: 3D buildings and landmarks, light presets (dawn, day, dusk, night)
 * and built-in themes (we use the default one). Its look comes from its own settings, so the
 * palettes below now only colour our layers (lines, stations, neighbourhoods, parks)
 * and the panel, following the light: Brownstone by day, Signage by night.
 */
export const BASEMAP_STYLE = "mapbox://styles/mapbox/standard";

export type LightPreset = "dawn" | "day" | "dusk" | "night";
export const LIGHT_PRESETS: LightPreset[] = ["dawn", "day", "dusk", "night"];
/** Which palette suits each light: warm and inky by day, signage black and white after dark. */
export const themeForLight = (light: LightPreset): ThemeName => (light === "dusk" || light === "night" ? "signage" : "brownstone");

export type PoiKindName = "arts" | "landmarks" | "religion" | "learning";
const POI_KIND_NAMES: PoiKindName[] = ["arts", "landmarks", "religion", "learning"];
export interface MapPrefs { light: LightPreset; threeD: boolean; poi: boolean; poiKinds: PoiKindName[]; streetNames: boolean }
const MAP_KEY = "standclear.map";
export function loadMapPrefs(): MapPrefs {
  const fallback: MapPrefs = { light: "day", threeD: true, poi: true, poiKinds: [...POI_KIND_NAMES], streetNames: true };
  try {
    const saved = JSON.parse(localStorage.getItem(MAP_KEY) ?? "{}");
    return {
      light: LIGHT_PRESETS.includes(saved.light) ? saved.light : fallback.light,
      threeD: typeof saved.threeD === "boolean" ? saved.threeD : fallback.threeD,
      poi: typeof saved.poi === "boolean" ? saved.poi : fallback.poi,
      streetNames: typeof saved.streetNames === "boolean" ? saved.streetNames : fallback.streetNames,
      poiKinds: Array.isArray(saved.poiKinds)
        ? [...saved.poiKinds.filter((k: string) => POI_KIND_NAMES.includes(k as PoiKindName)), ...(saved.poiKinds.includes("learning") || saved.poiKindsV === 2 ? [] : ["learning" as const])]
        : fallback.poiKinds,
    };
  } catch { return fallback; }
}
export function saveMapPrefs(p: MapPrefs) {
  try { localStorage.setItem(MAP_KEY, JSON.stringify({ ...p, poiKindsV: 2 })); } catch { /* storage unavailable */ }
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
/**
 * Small adjustments per light on top of the palette, so neighbourhood boundaries stay
 * readable against Standard's basemap in each light: deeper outlines and stronger fills
 * on the pale day and dawn maps, lighter outlines and stronger fills on the darker dusk
 * and night maps.
 */
const LIGHT_TWEAKS: Partial<Record<LightPreset, Partial<Colors>>> = {
  dawn: { areaLine: "#7a6247", subLine: "#977f62", areaFill: [0.15, 0.3] },
  day: { areaLine: "#86704f", subLine: "#a08a6a", areaFill: [0.13, 0.28] },
  dusk: { areaLine: "#a6a29b", subLine: "#8a8680", areaFill: [0.16, 0.32] },
  night: { areaLine: "#8a8a8a", subLine: "#6f6f6f", areaFill: [0.18, 0.34] },
};

/**
 * Streets as soft, light lanes that sit just above the land colour, like the old
 * Brownstone (near-white on cream) and Signage (light gray on black) maps, so our own
 * layers carry the map.
 *
 * Standard lights everything with its light preset, which dims pure white to a light
 * gray, and it darkens road edges based on the road colour. Blending roads *into* the
 * land made those edges read as gray lines; making them *lighter* than the land, up to
 * white by day, keeps them reading as pale lanes.
 */
const STREET_LIGHTEN = { roads: 0.35, major: 0.5 }; // after dark: how far towards white
const BUILDING_STRENGTH = 0.45; // how much building colour to keep (the rest is land)

/** Any CSS colour → [r, g, b, a], via a canvas (which understands every CSS colour format). Null if it isn't one. */
function rgba(color: unknown): [number, number, number, number] | null {
  if (typeof color !== "string") return null;
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#000";
  ctx.fillStyle = color;
  const c = ctx.fillStyle as string;
  if (c.startsWith("#")) {
    const n = parseInt(c.slice(1), 16);
    return [n >> 16, (n >> 8) & 255, n & 255, 1];
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const [r, g, b, a = "1"] = m[1].split(",").map((x) => x.trim());
  return [Number(r), Number(g), Number(b), Number(a)];
}

/** Mix `amount` of `color` into `base`. Falls back to `color` unchanged if either isn't a plain colour. */
function blend(base: unknown, color: unknown, amount: number): unknown {
  const a = rgba(base), b = rgba(color);
  if (!a || !b) return color;
  const mix = (i: number) => Math.round(a[i] + (b[i] - a[i]) * amount);
  return `rgb(${mix(0)}, ${mix(1)}, ${mix(2)})`;
}

/** Standard's zoning colours: setting them to the land colour removes most of the street-level noise. */
const ZONING = ["colorCommercial", "colorEducation", "colorMedical", "colorIndustrial"];

/**
 * Standard's colour overrides for a time of day.
 *
 * Day: the quiet street level of the old Brownstone map (cream land, soft roads, warm
 * buildings, softer labels). Dawn, dusk and night keep Standard's own colours (`defaults`,
 * read from the style once it loads), with only the zoning patchwork removed.
 */
export function basemapColors(light: LightPreset, defaults: Record<string, unknown>): Record<string, unknown> {
  if (light !== "day") {
    const quiet: Record<string, unknown> = { ...defaults };
    for (const key of ZONING) quiet[key] = defaults.colorLand;
    // Streets: a shade lighter than the land, so they read as pale lanes, not lines.
    quiet.colorRoads = blend(defaults.colorLand, "#ffffff", STREET_LIGHTEN.roads);
    quiet.colorTrunks = blend(defaults.colorLand, "#ffffff", STREET_LIGHTEN.major);
    quiet.colorMotorways = blend(defaults.colorLand, "#ffffff", STREET_LIGHTEN.major);
    quiet.colorBuildings = blend(defaults.colorLand, defaults.colorBuildings, BUILDING_STRENGTH);
    return quiet;
  }
  return {
    colorLand: T.land,
    colorWater: T.water,
    colorGreenspace: T.park,
    colorBuildings: blend(T.land, T.building, BUILDING_STRENGTH),
    // Pure white: under Standard's daylight it lands close to the old near-white streets.
    colorRoads: "#ffffff",
    colorTrunks: "#ffffff",
    colorMotorways: "#ffffff",
    colorCommercial: T.land,
    colorEducation: T.land,
    colorMedical: T.land,
    colorIndustrial: T.land,
    colorPlaceLabels: T.inkSoft,
    colorRoadLabels: T.inkFaint,
    colorAdminBoundaries: T.boundary,
  };
}

/** Basemap details switched off to keep the map calm. */
export const QUIET_BASEMAP = {
  showPedestrianRoads: false, // footpaths and trails: lots of thin lines at street level
  showLandmarkIcons: false, // our Places layer covers landmarks
  showAdminBoundaries: false,
};

/** Set the palette for a time of day: the light's theme, plus its tweaks. Restyle the map's layers after. */
export function setLight(light: LightPreset) {
  setTheme(themeForLight(light));
  Object.assign(T, LIGHT_TWEAKS[light] ?? {});
}

// Apply the palette for the saved light straight away, before the map or any CSS paints.
setLight(loadMapPrefs().light);
