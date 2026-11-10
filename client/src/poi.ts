/**
 * Our own points of interest: NYC's culture and history. Standard can only show all of
 * its POIs or none, so its POIs stay off and this layer draws them instead, from the
 * same Mapbox Streets data (`poi_label`).
 *
 * Everyday places are left out on purpose: restaurants and bars (for now), hotels, shops, groceries, banks and other
 * services, gas stations and parking, hospitals and clinics, schools, gyms, offices,
 * toilets and info points. Parks and outdoors aren't here either: the Parks layer
 * covers those.
 */
import type mapboxgl from "mapbox-gl";
import { T } from "./theme";

type Expr = mapboxgl.ExpressionSpecification;

export const POI_LAYER = "pois";

export type PoiKind = "arts" | "landmarks" | "religion" | "learning";

/**
 * Each category: its label, dot colour, and what it covers: Mapbox Streets `class`
 * values, and/or `maki` icon names (for places whose class is too broad, like
 * universities inside "education" or libraries inside "public_facility").
 */
export const POI_KINDS: { key: PoiKind; label: string; color: string; classes: string[]; maki: string[] }[] = [
  {
    key: "arts", label: "Arts & entertainment", color: "#a64fd1",
    classes: ["arts_and_entertainment"],
    maki: ["museum", "art-gallery", "theatre", "cinema", "music", "stadium", "zoo", "aquarium"],
  },
  { key: "landmarks", label: "Landmarks & history", color: "#c9921a", classes: ["landmark", "historic"], maki: ["monument", "castle", "town-hall", "landmark"] },
  { key: "religion", label: "Religious sites", color: "#3f7fc4", classes: ["religion"], maki: ["religious-christian", "religious-jewish", "religious-muslim", "religious-buddhist", "place-of-worship"] },
  { key: "learning", label: "Universities & libraries", color: "#1f9d8a", classes: [], maki: ["college", "library"] },
];
export const ALL_POI_KINDS = POI_KINDS.map((k) => k.key);

/** True for features in this category. */
const inKind = (k: (typeof POI_KINDS)[number]): Expr => ["any",
  ["in", ["get", "class"], ["literal", k.classes.length ? k.classes : ["__none__"]]],
  ["in", ["get", "maki"], ["literal", k.maki.length ? k.maki : ["__none__"]]],
];

/** A small dot with a white ring, one per category, drawn on a canvas for the map. */
function dot(color: string, pixelRatio = 2) {
  const size = 15 * pixelRatio;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - pixelRatio, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2 * pixelRatio;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}

/** Which category a feature is in, as an icon name ("poi-arts", …). Universities and libraries first, so they don't fall into a broader class. */
const ORDER: PoiKind[] = ["learning", "arts", "landmarks", "religion"];
const iconFor: Expr = ["case",
  ...ORDER.flatMap((key) => [inKind(POI_KINDS.find((k) => k.key === key)!), `poi-${key}`]),
  "poi-landmarks",
] as Expr;

/** Only the switched-on categories, and fewer, more important places when zoomed out. */
function filterFor(kinds: PoiKind[]): Expr {
  const on = POI_KINDS.filter((k) => kinds.includes(k.key));
  return ["all",
    on.length ? (["any", ...on.map(inKind)] as Expr) : ["==", 1, 0],
    // filterrank: 0 = most important. From city zoom only the best-known places show
    // (the Met, MoMA, St. Patrick's…); more fill in as you zoom in.
    ["<=", ["get", "filterrank"], ["step", ["zoom"], 0, 12.5, 1, 13.5, 2, 14.5, 3, 15.5, 4, 16.5, 5]],
  ];
}

/** The category a place falls in, matching the map's colour (null if none). */
export function poiKindOf(cls: string, maki: string): PoiKind | null {
  for (const key of ORDER) {
    const k = POI_KINDS.find((x) => x.key === key)!;
    if (k.maki.includes(maki) || k.classes.includes(cls)) return key;
  }
  return null;
}

/** A ring around the selected place. */
export function setSelectedPoi(m: mapboxgl.Map, coords: [number, number] | null) {
  const src = m.getSource("poi-selected") as mapboxgl.GeoJSONSource | undefined;
  src?.setData({ type: "FeatureCollection", features: coords ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: coords } }] : [] });
}

export function addPoiLayer(m: mapboxgl.Map, kinds: PoiKind[], beforeId?: string) {
  for (const k of POI_KINDS) if (!m.hasImage(`poi-${k.key}`)) m.addImage(`poi-${k.key}`, dot(k.color), { pixelRatio: 2 });
  m.addSource("pois", { type: "vector", url: "mapbox://mapbox.mapbox-streets-v8" });
  m.addLayer({
    id: POI_LAYER,
    type: "symbol",
    source: "pois",
    "source-layer": "poi_label",
    minzoom: 9, // the map's furthest-out zoom
    filter: filterFor(kinds),
    layout: {
      "icon-image": iconFor,
      "icon-size": ["interpolate", ["linear"], ["zoom"], 9, 0.5, 11, 0.6, 13, 0.8, 17, 1.1],
      "text-field": ["get", "name"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 9, 10, 14, 11.5, 17, 13],
      "text-max-width": 8,
      "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
      "text-variable-anchor": ["left", "right", "top"],
      "text-radial-offset": 0.7,
      "text-optional": true, // keep the dot even when its name doesn't fit
      "symbol-sort-key": ["get", "filterrank"],
    },
    paint: { "text-color": T.ink, "text-halo-color": T.halo, "text-halo-width": 1.6 },
  }, beforeId);
  m.addSource("poi-selected", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  m.addLayer({
    id: "poi-selected",
    type: "circle",
    source: "poi-selected",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 9, 17, 13],
      "circle-color": "rgba(0, 0, 0, 0)",
      "circle-stroke-color": T.selectInk,
      "circle-stroke-width": 2.5,
    },
  }, beforeId);
}

/** Show only these categories (an empty list hides the layer's places). */
export function setPoiKinds(m: mapboxgl.Map, kinds: PoiKind[]) {
  if (m.getLayer(POI_LAYER)) m.setFilter(POI_LAYER, filterFor(kinds));
}

export function setPoisVisible(m: mapboxgl.Map, on: boolean) {
  if (m.getLayer(POI_LAYER)) m.setLayoutProperty(POI_LAYER, "visibility", on ? "visible" : "none");
}

/** Re-apply the current palette's text colours. */
export function restylePois(m: mapboxgl.Map) {
  if (!m.getLayer(POI_LAYER)) return;
  m.setPaintProperty(POI_LAYER, "text-color", T.ink);
  m.setPaintProperty(POI_LAYER, "text-halo-color", T.halo);
  if (m.getLayer("poi-selected")) m.setPaintProperty("poi-selected", "circle-stroke-color", T.selectInk);
}
