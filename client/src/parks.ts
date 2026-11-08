/** Map layers for NYC parks: green fills, outlines, names by size, and a selected highlight. */
import type mapboxgl from "mapbox-gl";
import type { Parks } from "./types";

type Expr = mapboxgl.ExpressionSpecification;

export const PARK_LAYERS = [
  "parks-fill", "parks-outline", "parks-selected", "parks-labels-large", "parks-labels-medium", "parks-labels-small",
] as const;

const GREEN = "#4caf6a";

/** Park types "Take me somewhere" can land on: places you'd plan a visit to (no traffic triangles). */
export const DESTINATION_TYPES = new Set([
  "Flagship Park", "Community Park", "Neighborhood Park", "Nature Area",
  "Waterfront Facility", "Historic House Park", "Recreational Field/Courts", "Recreation Field/Courts",
]);

/**
 * Everyday groups for the data's park types, used by the filter chips. Anything
 * not listed here falls under "Other".
 */
export const PARK_GROUPS: { key: string; label: string; types: string[] }[] = [
  { key: "big", label: "Big parks", types: ["Flagship Park", "Community Park"] },
  { key: "neighborhood", label: "Neighborhood parks", types: ["Neighborhood Park"] },
  { key: "playground", label: "Playgrounds", types: ["Playground", "Jointly Operated Playground"] },
  { key: "garden", label: "Gardens", types: ["Garden"] },
  { key: "nature", label: "Nature & waterfront", types: ["Nature Area", "Waterfront Facility"] },
  { key: "sports", label: "Sports", types: ["Recreational Field/Courts", "Recreation Field/Courts"] },
  { key: "plaza", label: "Plazas & triangles", types: ["Triangle/Plaza"] },
  { key: "other", label: "Other", types: [] },
];
const GROUPED = new Set(PARK_GROUPS.flatMap((g) => g.types));

/** The filter group a park type belongs to. */
export const parkGroupOf = (type: string) => PARK_GROUPS.find((g) => g.types.includes(type))?.key ?? "other";

/** Every park type covered by the chosen groups ("other" means every type not in a named group). */
export function typesForGroups(groups: string[], allTypes: string[]) {
  return allTypes.filter((t) => groups.includes(GROUPED.has(t) ? parkGroupOf(t) : "other"));
}

/** Each park layer's own filter, so the type filter can be added on top. */
const BASE_FILTERS = new Map<string, Expr | null>();

/**
 * Add the layers. Fills and outlines go above the neighbourhoods but under the
 * subway lines (`beneath`); names go just under the stops (`labelsBeneath`).
 */
export function addParkLayers(m: mapboxgl.Map, data: Parks, beneath?: string, labelsBeneath?: string) {
  m.addSource("parks", { type: "geojson", data, promoteId: "id" });
  // Names sit on one point per park, so multi-part parks get one label.
  m.addSource("parks-labels", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: data.features.map((f) => ({
        type: "Feature",
        properties: { id: f.properties.id, name: f.properties.name, acres: f.properties.acres, type: f.properties.type },
        geometry: { type: "Point", coordinates: f.properties.label },
      })),
    },
  });
  const hovered: Expr = ["boolean", ["feature-state", "hover"], false];

  m.addLayer({
    id: "parks-fill",
    type: "fill",
    source: "parks",
    paint: { "fill-color": GREEN, "fill-opacity": ["case", hovered, 0.42, 0.22] },
  }, beneath);
  m.addLayer({
    id: "parks-outline",
    type: "line",
    source: "parks",
    minzoom: 11,
    layout: { "line-join": "round" },
    paint: {
      "line-color": GREEN,
      "line-opacity": ["case", hovered, 0.95, 0.55],
      "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.5, 15, 1.2],
    },
  }, beneath);
  m.addLayer({
    id: "parks-selected",
    type: "line",
    source: "parks",
    filter: ["==", ["get", "id"], ""],
    layout: { "line-join": "round" },
    paint: { "line-color": "#FFD600", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.5, 15, 3] },
  }, beneath);

  // Big parks are named from further out, small ones only up close.
  BASE_FILTERS.set("parks-fill", null);
  BASE_FILTERS.set("parks-outline", null);
  const label = (id: string, minzoom: number, filter: Expr, size: Expr | number) => {
    BASE_FILTERS.set(id, filter);
    m.addLayer({
      id,
      type: "symbol",
      source: "parks-labels",
      minzoom,
      filter,
      layout: {
        "text-field": ["get", "name"],
        "text-size": size,
        "text-max-width": 7,
        "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
        // Bigger parks win when labels collide.
        "symbol-sort-key": ["-", 0, ["get", "acres"]],
      },
      paint: { "text-color": "#9be3ad", "text-halo-color": "#0b0b0b", "text-halo-width": 1.2 },
    }, labelsBeneath);
  };
  label("parks-labels-large", 10, [">=", ["get", "acres"], 100], ["interpolate", ["linear"], ["zoom"], 10, 10, 14, 13]);
  label("parks-labels-medium", 12.5, ["all", [">=", ["get", "acres"], 5], ["<", ["get", "acres"], 100]], ["interpolate", ["linear"], ["zoom"], 12.5, 10, 15, 12]);
  label("parks-labels-small", 14.5, ["<", ["get", "acres"], 5], 10.5);
}

export function setParksVisible(m: mapboxgl.Map, on: boolean) {
  for (const id of PARK_LAYERS) if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", on ? "visible" : "none");
}

/** Show only parks of these types (null shows every park). The selected park's outline always shows. */
export function setParkTypeFilter(m: mapboxgl.Map, types: string[] | null) {
  for (const [id, base] of BASE_FILTERS) {
    if (!m.getLayer(id)) continue;
    const byType: Expr | null = types ? ["in", ["get", "type"], ["literal", types]] : null;
    const filter = base && byType ? (["all", base, byType] as Expr) : base ?? byType;
    m.setFilter(id, filter);
  }
}

export function setSelectedPark(m: mapboxgl.Map, id: string | null) {
  if (m.getLayer("parks-selected")) m.setFilter("parks-selected", ["==", ["get", "id"], id ?? ""]);
}

/** Bounding box of a park, for framing it on the map. */
export function parkBounds(coords: number[][][][]): [[number, number], [number, number]] {
  const pts = coords.flat(2);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
}
