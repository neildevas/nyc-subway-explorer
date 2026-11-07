/**
 * Map layers for NYC neighbourhoods: a soft colour patchwork, thin outlines,
 * names, faint sub-neighbourhoods when zoomed in, and a selected highlight.
 */
import type mapboxgl from "mapbox-gl";
import type { Areas } from "./types";

type Expr = mapboxgl.ExpressionSpecification;

export const AREA_LAYERS = [
  "areas-fill", "areas-outline", "areas-sub-hit", "areas-sub-outline",
  "areas-selected-fill", "areas-selected-outline", "areas-labels", "areas-sub-labels",
] as const;

/**
 * The source data's five fill colours (tan, orange, blue, pink, teal), assigned
 * so neighbouring areas never share one. Shown at low opacity on the dark map.
 */
const PALETTE = ["#e5c494", "#fc8d62", "#8da0cb", "#e78ac3", "#66c2a5"];
const paletteColor: Expr = ["match", ["get", "color"], 0, PALETTE[0], 1, PALETTE[1], 2, PALETTE[2], 3, PALETTE[3], 4, PALETTE[4], PALETTE[0]];

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

  m.addLayer({
    id: "areas-fill",
    type: "fill",
    source: "areas",
    filter: isTop,
    layout: hidden,
    paint: { "fill-color": paletteColor, "fill-opacity": ["case", hovered, 0.22, 0.08] },
  }, beneath);
  m.addLayer({
    id: "areas-outline",
    type: "line",
    source: "areas",
    filter: isTop,
    layout: { ...hidden, "line-join": "round" },
    paint: {
      "line-color": ["case", hovered, paletteColor, "#8f8f8b"],
      "line-opacity": ["case", hovered, 0.9, 0.5],
      "line-width": ["interpolate", ["linear"], ["zoom"], 9, 0.5, 13, 1, 16, 1.5],
    },
  }, beneath);

  // Sub-neighbourhoods: an invisible fill (so hover can name them) and faint dashed outlines up close.
  m.addLayer({
    id: "areas-sub-hit",
    type: "fill",
    source: "areas",
    filter: isSub,
    layout: hidden,
    paint: { "fill-color": "#000", "fill-opacity": 0 },
  }, beneath);
  m.addLayer({
    id: "areas-sub-outline",
    type: "line",
    source: "areas",
    filter: isSub,
    minzoom: 12.5,
    layout: { ...hidden, "line-join": "round" },
    paint: { "line-color": "#8f8f8b", "line-opacity": 0.45, "line-width": 0.8, "line-dasharray": [2, 2] },
  }, beneath);

  const selected = ["areas-selected-fill", "areas-selected-outline"];
  m.addLayer({
    id: selected[0],
    type: "fill",
    source: "areas",
    filter: ["==", ["get", "id"], ""],
    layout: hidden,
    paint: { "fill-color": "#FFD600", "fill-opacity": 0.08 },
  }, beneath);
  m.addLayer({
    id: selected[1],
    type: "line",
    source: "areas",
    filter: ["==", ["get", "id"], ""],
    layout: { ...hidden, "line-join": "round" },
    paint: { "line-color": "#FFD600", "line-width": ["interpolate", ["linear"], ["zoom"], 9, 1.5, 14, 2.5] },
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
    paint: { "text-color": "#c4c4c0", "text-halo-color": "#0b0b0b", "text-halo-width": 1.2 },
  }, labelsBeneath);
  m.addLayer({
    id: "areas-sub-labels",
    type: "symbol",
    source: "areas",
    filter: isSub,
    minzoom: 13.5,
    layout: {
      ...hidden,
      "text-field": ["get", "name"],
      "text-size": 11,
      "text-max-width": 8,
      "text-font": ["DIN Pro Italic", "Arial Unicode MS Regular"],
    },
    paint: { "text-color": "#9a9a96", "text-halo-color": "#0b0b0b", "text-halo-width": 1 },
  }, labelsBeneath);
}

export function setAreasVisible(m: mapboxgl.Map, on: boolean) {
  for (const id of AREA_LAYERS) if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", on ? "visible" : "none");
  for (const id of basemapAreaLabels(m)) m.setLayoutProperty(id, "visibility", on ? "none" : "visible");
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
