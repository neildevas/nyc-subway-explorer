/**
 * "Warm daylight explorer": a sunny walk down a tree-lined, pre-war block. Limestone
 * land, brownstone buildings, leafy parks, soft blue water, and brown-black ink, with
 * an eclectic mix of neighbourhood colours (terracotta, mustard, teal, plum, sage).
 *
 * Map colours used by our own layers live here so the look can be changed in one place.
 */
import type mapboxgl from "mapbox-gl";

export const BASEMAP_STYLE = "mapbox://styles/mapbox/light-v11";

export const T = {
  /** Page background behind the map while it loads */
  page: "#f2e9da",
  /** Limestone and parchment */
  land: "#f5eee2",
  water: "#9fcbe0",
  waterLabel: "#3f7391",
  /** Leafy */
  park: "#cde2b2",
  /** Brownstone: buildings read as warm brown blocks when zoomed in */
  building: "#e7d4be",
  buildingEdge: "#d6bea2",
  road: "#ffffff",
  roadCasing: "#e2d4bf",
  roadMinor: "#fcf8f1",
  boundary: "#c4b298",
  /** Brown-black ink, like an old printed map, and the paper halo that keeps it readable */
  ink: "#33251a",
  inkSoft: "#644d3b",
  inkFaint: "#8d7964",
  halo: "#fffaf1",
  /** Selection: mustard glow with a dark ink outline (yellow alone vanishes on cream) */
  select: "#e3a72f",
  selectInk: "#33251a",
  /** Station dots */
  stationFill: "#ffffff",
  stationStroke: "#33251a",
  /** Decorative trains */
  ambient: "#6f5a47",
  /** Parks, deeper than the basemap green so they read as "our" data */
  parkGreen: "#5a9e4f",
  parkLabel: "#2e6630",
  /** Neighbourhood outlines when not highlighted */
  areaLine: "#bba78c",
  subLine: "#cdbba2",
};

/**
 * Neighbourhood colours: an eclectic, painted-row-house mix. Five, because the build
 * colours neighbouring areas 0–4 so no two that touch share a colour.
 */
export const AREA_PALETTE = ["#e3a72f", "#d46a43", "#4e9a8c", "#9a6aa0", "#7ea35f"];
/** Borough tints (the Boroughs layer) */
export const BOROUGH_COLORS: Record<string, string> = {
  Manhattan: "#d46a43",
  Brooklyn: "#9a6aa0",
  Queens: "#4e9a8c",
  Bronx: "#e3a72f",
  "Staten Island": "#7ea35f",
};

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
