/**
 * Map layers for NYC neighbourhoods: a soft colour patchwork, thin outlines,
 * names, faint sub-neighbourhoods when zoomed in, and a selected highlight.
 * Plus a separate Boroughs layer: the five boroughs as single shapes with big names.
 */
import type mapboxgl from "mapbox-gl";
import type { Areas } from "./types";
import { T } from "./theme";

type Expr = mapboxgl.ExpressionSpecification;

/** Layers behind the Neighborhoods toggle. */
export const AREA_LAYERS = [
  "areas-fill", "areas-outline", "areas-sub-hit", "areas-sub-outline",
  "areas-selected-fill", "areas-selected-outline", "areas-labels", "areas-sub-labels",
] as const;

/**
 * From this zoom, sub-neighbourhoods (Yorkville, Hell's Kitchen…) show as their own
 * areas on top of their neighbourhood and take hovers and clicks.
 */
export const SUB_ZOOM = 13;

/** Sub-neighbourhood fill opacity: invisible below SUB_ZOOM (still queryable for hover names). */
const subFillOpacity = (hover: number, normal: number | Expr): Expr =>
  ["step", ["zoom"], 0, SUB_ZOOM, ["case", ["boolean", ["feature-state", "hover"], false], hover, normal]];

/** Layers behind the Boroughs toggle. */
export const BOROUGH_LAYERS = ["boroughs-fill", "boroughs-hover", "boroughs-labels"] as const;

/** One colour per borough for the zoomed-out view (from the current theme). */
const boroughColor = (): Expr => ["match", ["get", "borough"], ...Object.entries(T.boroughs).flat(), T.areaLine] as Expr;

/** Where each borough's name sits (hand-placed over its middle, clear of the water). */
const BOROUGH_LABELS: [string, [number, number]][] = [
  ["Manhattan", [-73.967, 40.785]],
  ["Brooklyn", [-73.947, 40.648]],
  ["Queens", [-73.815, 40.712]],
  ["Bronx", [-73.866, 40.848]],
  ["Staten Island", [-74.147, 40.582]],
];

/**
 * Each area's fill colour: the build gives every area a colour number 0–4, assigned so
 * neighbours never share one, and the current theme's palette says what each number is.
 */
const paletteColor = (): Expr => {
  const p = T.areaPalette;
  return ["match", ["get", "color"], 0, p[0], 1, p[1], 2, p[2], 3, p[3], 4, p[4], p[0]];
};

const isTop: Expr = ["==", ["get", "kind"], "neighborhood"];
const isSub: Expr = ["==", ["get", "kind"], "sub"];

/** The basemap's own neighbourhood labels, hidden while ours are showing so names don't double up. */
const basemapAreaLabels = (m: mapboxgl.Map) =>
  (m.getStyle()?.layers ?? []).filter((l) => l.type === "symbol" && /settlement-subdivision|neighbou?rhood/.test(l.id)).map((l) => l.id);

/**
 * Add the layers. Fills and outlines go under the subway lines (`beneath`); names
 * go just under the stops (`labelsBeneath`), so transit always reads on top.
 */
export function addAreaLayers(m: mapboxgl.Map, data: Areas, beneath?: string, labelsBeneath?: string) {
  // promoteId lets us flag the hovered neighbourhood with feature-state.
  m.addSource("areas", { type: "geojson", data, promoteId: "id" });
  const hovered: Expr = ["boolean", ["feature-state", "hover"], false];
  const hidden = { visibility: "none" as const };

  // ---- Boroughs: every neighbourhood filled in its borough's colour, with no
  // inner outlines, so each borough reads as one shape. Drawn under the neighbourhoods.
  m.addLayer({
    id: "boroughs-fill",
    type: "fill",
    source: "areas",
    filter: isTop,
    layout: hidden,
    paint: { "fill-color": boroughColor(), "fill-opacity": 0.12, "fill-antialias": false },
  }, beneath);
  m.addLayer({
    id: "boroughs-hover",
    type: "fill",
    source: "areas",
    filter: ["all", isTop, ["==", ["get", "borough"], ""]],
    layout: hidden,
    paint: { "fill-color": boroughColor(), "fill-opacity": 0.22, "fill-antialias": false },
  }, beneath);
  m.addSource("borough-labels", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: BOROUGH_LABELS.map(([borough, coordinates]) => ({ type: "Feature", properties: { borough }, geometry: { type: "Point", coordinates } })),
    },
  });
  m.addLayer({
    id: "boroughs-labels",
    type: "symbol",
    source: "borough-labels",
    layout: {
      ...hidden,
      "text-field": ["get", "borough"],
      "text-transform": "uppercase",
      "text-letter-spacing": 0.14,
      "text-size": ["interpolate", ["linear"], ["zoom"], 9, 11, 11, 15, 14, 20],
      "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"],
      "text-allow-overlap": true,
    },
    paint: { "text-color": T.ink, "text-halo-color": T.halo, "text-halo-width": 1.6 },
  }, labelsBeneath);

  // ---- Neighbourhoods
  m.addLayer({
    id: "areas-fill",
    type: "fill",
    source: "areas",
    filter: isTop,
    layout: hidden,
    paint: { "fill-color": paletteColor(), "fill-opacity": ["case", hovered, T.areaFill[1], T.areaFill[0]] },
  }, beneath);
  m.addLayer({
    id: "areas-outline",
    type: "line",
    source: "areas",
    filter: isTop,
    layout: { ...hidden, "line-join": "round" },
    paint: {
      "line-color": ["case", hovered, paletteColor(), T.areaLine],
      "line-opacity": ["case", hovered, 0.9, 0.5],
      "line-width": ["interpolate", ["linear"], ["zoom"], 9, 0.5, 13, 1, 16, 1.5],
    },
  }, beneath);

  // Sub-neighbourhoods: from SUB_ZOOM, their own tinted areas with outlines, on top of
  // their neighbourhood. The fill is always rendered (transparent when zoomed out) so
  // hovering can still name the sub-neighbourhood you're over.
  m.addLayer({
    id: "areas-sub-hit",
    type: "fill",
    source: "areas",
    filter: isSub,
    layout: hidden,
    paint: { "fill-color": paletteColor(), "fill-opacity": subFillOpacity(0.26, 0.1) },
  }, beneath);
  m.addLayer({
    id: "areas-sub-outline",
    type: "line",
    source: "areas",
    filter: isSub,
    minzoom: SUB_ZOOM,
    layout: { ...hidden, "line-join": "round" },
    paint: {
      "line-color": ["case", ["boolean", ["feature-state", "hover"], false], paletteColor(), T.subLine],
      "line-opacity": 0.6,
      "line-width": ["interpolate", ["linear"], ["zoom"], SUB_ZOOM, 0.8, 16, 1.4],
    },
  }, beneath);

  const selected = ["areas-selected-fill", "areas-selected-outline"];
  m.addLayer({
    id: selected[0],
    type: "fill",
    source: "areas",
    filter: ["==", ["get", "id"], ""],
    layout: hidden,
    paint: { "fill-color": T.select, "fill-opacity": 0.12 },
  }, beneath);
  m.addLayer({
    id: selected[1],
    type: "line",
    source: "areas",
    filter: ["==", ["get", "id"], ""],
    layout: { ...hidden, "line-join": "round" },
    paint: { "line-color": T.selectInk, "line-width": ["interpolate", ["linear"], ["zoom"], 9, 1.5, 14, 2.5] },
  }, beneath);

  m.addLayer({
    id: "areas-labels",
    type: "symbol",
    source: "areas",
    filter: isTop,
    minzoom: 10.5,
    layout: {
      ...hidden,
      "text-field": ["get", "name"],
      "text-transform": "uppercase",
      "text-letter-spacing": 0.08,
      "text-size": ["interpolate", ["linear"], ["zoom"], 10.5, 9, 14, 12],
      "text-max-width": 8,
      "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
    },
    paint: { "text-color": T.inkSoft, "text-halo-color": T.halo, "text-halo-width": 1.4 },
  }, labelsBeneath);
  m.addLayer({
    id: "areas-sub-labels",
    type: "symbol",
    source: "areas",
    filter: isSub,
    minzoom: SUB_ZOOM,
    layout: {
      ...hidden,
      "text-field": ["get", "name"],
      "text-size": ["interpolate", ["linear"], ["zoom"], SUB_ZOOM, 10.5, 16, 13],
      "text-max-width": 8,
      "text-font": ["DIN Pro Italic", "Arial Unicode MS Regular"],
    },
    paint: { "text-color": T.inkFaint, "text-halo-color": T.halo, "text-halo-width": 1.4 },
  }, labelsBeneath);
}

/**
 * Brighten neighbourhoods in the given boroughs and fade the rest. An empty list
 * clears the highlight. Hover still lifts any neighbourhood either way.
 */
export function setBoroughHighlight(m: mapboxgl.Map, boroughs: string[]) {
  if (!m.getLayer("areas-fill")) return;
  const hovered: Expr = ["boolean", ["feature-state", "hover"], false];
  const on = boroughs.length > 0;
  const inBoroughs: Expr = ["in", ["get", "borough"], ["literal", boroughs]];
  const pick = (hover: number, inside: number, outside: number, normal: number): Expr | number =>
    on ? ["case", hovered, hover, inBoroughs, inside, outside] : ["case", hovered, hover, normal];

  m.setPaintProperty("areas-fill", "fill-opacity", pick(T.areaFill[1] + 0.08, 0.24, 0.02, T.areaFill[0]) as Expr);
  m.setPaintProperty("areas-outline", "line-opacity", pick(0.9, 0.75, 0.15, 0.5) as Expr);
  m.setPaintProperty("areas-outline", "line-color", on
    ? ["case", ["any", hovered, inBoroughs], paletteColor(), T.areaLine]
    : ["case", hovered, paletteColor(), T.areaLine]);
  m.setPaintProperty("areas-labels", "text-opacity", on ? ["case", inBoroughs, 1, 0.3] : 1);
  m.setPaintProperty("areas-sub-outline", "line-opacity", on ? ["case", inBoroughs, 0.6, 0.12] : 0.6);
  m.setPaintProperty("areas-sub-hit", "fill-opacity", subFillOpacity(0.26, on ? ["case", inBoroughs, 0.14, 0.02] : 0.1));
  m.setPaintProperty("areas-sub-labels", "text-opacity", on ? ["case", inBoroughs, 1, 0.3] : 1);
  // Boroughs layer: highlighted boroughs stand out, the others fade.
  m.setPaintProperty("boroughs-fill", "fill-opacity", on ? ["case", inBoroughs, 0.2, 0.04] : 0.12);
  m.setPaintProperty("boroughs-labels", "text-opacity", on ? ["case", inBoroughs, 1, 0.4] : 1);
}

/**
 * Re-apply the current theme's colours to every neighbourhood and borough layer.
 * Call setBoroughHighlight afterwards: it owns the outline colours and opacities.
 */
export function restyleAreas(m: mapboxgl.Map) {
  if (!m.getLayer("areas-fill")) return;
  const set = (id: string, prop: string, value: unknown) => m.setPaintProperty(id, prop as never, value as never);
  set("boroughs-fill", "fill-color", boroughColor());
  set("boroughs-hover", "fill-color", boroughColor());
  set("areas-fill", "fill-color", paletteColor());
  set("areas-sub-hit", "fill-color", paletteColor());
  set("areas-sub-outline", "line-color", ["case", ["boolean", ["feature-state", "hover"], false], paletteColor(), T.subLine]);
  set("areas-selected-fill", "fill-color", T.select);
  set("areas-selected-outline", "line-color", T.selectInk);
  for (const [id, color] of [["boroughs-labels", T.ink], ["areas-labels", T.inkSoft], ["areas-sub-labels", T.inkFaint]] as const) {
    set(id, "text-color", color);
    set(id, "text-halo-color", T.halo);
  }
}

/** Brighten the borough under the cursor on the Boroughs layer (null to clear). */
export function setBoroughHover(m: mapboxgl.Map, borough: string | null) {
  if (m.getLayer("boroughs-hover")) m.setFilter("boroughs-hover", ["all", isTop, ["==", ["get", "borough"], borough ?? ""]]);
}

/** Bounding box of every neighbourhood in the given boroughs. */
export function boroughBounds(data: Areas, boroughs: string[]): [[number, number], [number, number]] | null {
  const pts = data.features
    .filter((f) => f.properties.kind === "neighborhood" && boroughs.includes(f.properties.borough))
    .flatMap((f) => f.geometry.coordinates.flat(2));
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
}

/** Show or hide the Neighborhoods and Boroughs layers (independently). */
export function setAreasVisible(m: mapboxgl.Map, neighborhoods: boolean, boroughs: boolean) {
  const show = (ids: readonly string[], on: boolean) => {
    for (const id of ids) if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", on ? "visible" : "none");
  };
  show(AREA_LAYERS, neighborhoods);
  show(BOROUGH_LAYERS, boroughs);
  // The basemap's own neighbourhood/borough names step aside while either of ours is showing.
  for (const id of basemapAreaLabels(m)) m.setLayoutProperty(id, "visibility", neighborhoods || boroughs ? "none" : "visible");
}

export function setSelectedArea(m: mapboxgl.Map, id: string | null) {
  for (const layer of ["areas-selected-fill", "areas-selected-outline"]) {
    if (m.getLayer(layer)) m.setFilter(layer, ["==", ["get", "id"], id ?? ""]);
  }
}

/** Bounding box of a neighbourhood's outline, for framing it on the map. */
export function areaBounds(coords: number[][][][]): [[number, number], [number, number]] {
  const pts = coords.flat(2);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
}
