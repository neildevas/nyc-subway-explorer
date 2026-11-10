import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import mapboxgl, { type GeoJSONSource } from "mapbox-gl";
import type { Feature, FeatureCollection, MultiPolygon, Point } from "geojson";
import { fetchArrivals, fetchAreas, fetchParks, fetchRealtime, fetchStatic } from "./api";
import { loadVisited, pickRandom, saveVisited } from "./random";
import { type AmbientTrains, restyleAmbient, setAmbientFocus, startAmbientTrains } from "./ambient";
import { Bullet, routeSort } from "./Bullet";
import { RandomPicker, type RandomKind } from "./RandomPicker";
import { LayerToggles } from "./LayerToggles";
import { MapSettings } from "./MapSettings";
import { addPoiLayer, POI_LAYER, restylePois, setPoiKinds, setPoisVisible, setSelectedPoi } from "./poi";
import { type Poi, PoiPanel } from "./PoiPanel";
import { AreaPanel } from "./AreaPanel";
import { ParkPanel } from "./ParkPanel";
import { BASEMAP_STYLE, basemapColors, currentTheme, type LightPreset, QUIET_BASEMAP, loadMapPrefs, saveMapPrefs, setLight, T } from "./theme";
import { addParkLayers, DESTINATION_TYPES, PARK_GROUPS, parkBounds, parkGroupOf, restyleParks, setParksVisible, setParkTypeFilter, setSelectedPark, typesForGroups } from "./parks";
import { PlaceSearch, type PlacePick } from "./PlaceSearch";
import { addAreaLayers, areaBounds, boroughBounds, restyleAreas, SUB_ZOOM, setAreasVisible, setBoroughHighlight, setBoroughHover, setSelectedArea } from "./areas";
import type { AreaProps, Areas, Arrival, Lines, ParkProps, Parks, RouteInfo, Routes, StationProps, Stations, Train } from "./types";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN ?? "";

type Station = Feature<Point, StationProps>;
type Area = Feature<MultiPolygon, AreaProps>;
type Park = Feature<MultiPolygon, ParkProps>;
type Expr = mapboxgl.ExpressionSpecification;
const NYC: [number, number] = [-73.94, 40.72];
const REALTIME_MS = 30_000;

/** Line width by zoom. `focused` widens the hovered/selected route so it reads as raised. */
const lineWidth = (focused: Expr | boolean = false): Expr => {
  const w = (normal: number, raised: number): Expr | number =>
    focused === false ? normal : ["case", focused as Expr, raised, normal];
  return ["interpolate", ["linear"], ["zoom"], 9, w(2, 3.5), 12, w(2.5, 4), 14, w(4, 6), 17, w(8, 11)] as Expr;
};

/** Re-apply the current theme's colours to the transit layers. */
function restyleTransit(m: mapboxgl.Map) {
  m.setPaintProperty("lines-casing", "line-color", T.halo);
  m.setPaintProperty("stations", "circle-color", T.stationFill);
  m.setPaintProperty("stations", "circle-stroke-color", T.stationStroke);
  m.setPaintProperty("station-labels", "text-color", T.ink);
  m.setPaintProperty("station-labels", "text-halo-color", T.halo);
  m.setPaintProperty("selected", "circle-color", T.select);
  m.setPaintProperty("selected", "circle-stroke-color", T.selectInk);
}

/** The lines' outline: a little wider than the line itself, at every zoom. */
const casingWidth = (focused: Expr | boolean = false): Expr => {
  const w = (normal: number, raised: number): Expr | number =>
    focused === false ? normal : ["case", focused as Expr, raised, normal];
  return ["interpolate", ["linear"], ["zoom"], 9, w(3.5, 5.5), 12, w(4.5, 6.5), 14, w(6.5, 9), 17, w(11, 15)] as Expr;
};

/**
 * Sideways offset for parallel routes: slot × (width + gap). The ≥1 px gap keeps
 * parallel colours from antialiasing into each other when zoomed out.
 */
const LANE_SPACING: [number, number][] = [[9, 3], [12, 3.5], [14, 5], [17, 9]]; // [zoom, px]
const lineOffset = [
  "interpolate", ["linear"], ["zoom"],
  ...LANE_SPACING.flatMap(([zoom, px]) => [zoom, ["*", ["get", "slot"], px]]),
] as Expr;

/** Every map layer that belongs to the Transit toggle. */
/** Decorative gray trains: default, step and limit for the + / − buttons */
const AMBIENT_KEY = "standclear.ambientTrains";
const AMBIENT_DEFAULT = 15;
const AMBIENT_STEP = 5;
const AMBIENT_MAX = 60;

const TRANSIT_LAYERS = ["lines-casing", "lines", "lines-hit", "stations", "station-labels", "trains", "train-labels", "ambient-trains", "selected"];

/**
 * Which layers are switched on, remembered between visits. Both start on.
 * (The key is versioned: bumping it resets everyone to the current defaults.)
 */
const LAYERS_KEY = "standclear.layers.v2";
const DEFAULT_LAYERS = { transit: true, areas: true, boroughs: false, parks: true };
const loadLayerPrefs = (): { transit: boolean; areas: boolean; boroughs: boolean; parks: boolean } => {
  try { return { ...DEFAULT_LAYERS, ...JSON.parse(localStorage.getItem(LAYERS_KEY) ?? "{}") }; }
  catch { return DEFAULT_LAYERS; }
};

const BOROUGHS = ["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"];

/** Camera speed for flying to a stop or a neighbourhood (Mapbox flyTo `speed`; lower is slower). */
const STOP_FLY_SPEED = 0.9;
const HIGHLIGHT_KEY = "standclear.highlightBoroughs";
const PARK_FILTER_KEY = "standclear.parkGroups";

/** Map padding that keeps framed things clear of the side panel (or the bottom sheet on phones). */
const panelPadding = () =>
  window.innerWidth <= 600
    ? { top: 70, right: 30, left: 30, bottom: window.innerHeight * 0.55 + 20 }
    : { top: 70, right: 60, bottom: 90, left: 400 };

/** Standard's own colour settings, read before we change any, so other times of day can go back to them. */
let standardColors: Record<string, unknown> | null = null;

/** Quiet the basemap for this time of day (see basemapColors). */
function applyBasemapColors(m: mapboxgl.Map, light: LightPreset) {
  try {
    if (!standardColors) {
      // Read Standard's own colours first. They aren't available until its basemap has
      // loaded; until then, change nothing (the map's "load" event calls this again).
      const read: Record<string, unknown> = {};
      for (const key of Object.keys(basemapColors("day", {}))) read[key] = m.getConfigProperty("basemap", key);
      if (Object.values(read).some((v) => v == null)) return;
      standardColors = read;
    }
    for (const [key, value] of Object.entries(basemapColors(light, standardColors))) {
      if (value != null) m.setConfigProperty("basemap", key, value as string);
    }
  } catch (err) {
    console.warn("Couldn't recolour the basemap", err);
  }
}

/** How far to tilt the map in 3D mode (degrees). */
const THREE_D_PITCH = 55;

/**
 * Mapbox Standard places custom layers in "slots" rather than under named basemap
 * layers: lines and fills go in "middle" (above roads, under 3D buildings and labels),
 * dots and names in "top". This wraps addLayer so every layer gets the right slot, and a
 * `beforeId` is only used when it points at a layer in the same slot.
 *
 * Standard also lights custom layers with its light preset, which made the line colours
 * go murky at dusk and near-black at night. "Emissive strength" opts a layer out of that:
 * lines, dots and names keep their true colours (like lit signs), while fills keep a
 * little of the light so the map still feels like night.
 */
function assignSlots(m: mapboxgl.Map) {
  const slots = new Map<string, string>();
  const add = m.addLayer.bind(m);
  type Layer = Parameters<typeof m.addLayer>[0];
  m.addLayer = ((layer: Layer, before?: string) => {
    const type = (layer as { type?: string }).type;
    const slot = type === "symbol" || type === "circle" ? "top" : "middle";
    slots.set(layer.id, slot);
    const glow: Record<string, number> =
      type === "line" ? { "line-emissive-strength": 1 }
      : type === "circle" ? { "circle-emissive-strength": 1 }
      : type === "symbol" ? { "text-emissive-strength": 1, "icon-emissive-strength": 1 }
      : type === "fill" ? { "fill-emissive-strength": 0.6 }
      : {};
    const paint = { ...glow, ...((layer as { paint?: object }).paint ?? {}) };
    return add({ ...layer, slot, paint } as Layer, before && slots.get(before) === slot ? before : undefined);
  }) as typeof m.addLayer;
}

/** Express variants (6X, 7X, FX) count as their base route. */
const baseRoute = (r: string, routes: Routes) => (/^[0-9A-Z]X$/.test(r) && routes[r[0]] ? r[0] : r);

/** Every line you can catch at a station, transfers included, in route order. */
const stationRoutes = (s: Feature<Point, StationProps>, routes: Routes) =>
  [...new Set((s.properties.allRoutes ?? s.properties.routes).map((r) => baseRoute(r, routes)))].sort(routeSort);


export default function App() {
  const mapEl = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);

  const [stations, setStations] = useState<Stations | null>(null);
  const [routes, setRoutes] = useState<Routes>({});
  const [selected, setSelected] = useState<Station | null>(null);
  const [arrivals, setArrivals] = useState<Arrival[] | null>(null);
  const [lineFilter, setLineFilter] = useState<string>("");
  const [visited, setVisited] = useState<string[]>(() => loadVisited("stop"));
  const [visitedAreas, setVisitedAreas] = useState<string[]>(() => loadVisited("neighborhood"));
  const [showTrains, setShowTrains] = useState(true);
  const [trainCount, setTrainCount] = useState(0);
  const [trainsByRoute, setTrainsByRoute] = useState<Record<string, number>>({});
  const [hover, setHover] = useState<{ routeId: string; x: number; y: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Map layers: Transit and Neighborhoods, toggled independently.
  const [showTransit, setShowTransit] = useState(() => loadLayerPrefs().transit);

  // ---- Basemap: Mapbox Standard's light, theme and 3D (remembered) ---------
  const [mapPrefs, setMapPrefs] = useState(loadMapPrefs);
  const mapPrefsRef = useRef(mapPrefs);
  mapPrefsRef.current = mapPrefs;
  const updateMap = (patch: Partial<typeof mapPrefs>) => setMapPrefs((p) => ({ ...p, ...patch }));
  useEffect(() => {
    saveMapPrefs(mapPrefs);
    const m = map.current;
    if (!m) return;
    try {
      m.setConfigProperty("basemap", "lightPreset", mapPrefs.light);
      m.setConfigProperty("basemap", "show3dObjects", mapPrefs.threeD);
      m.setConfigProperty("basemap", "showRoadLabels", mapPrefs.streetNames);
    } catch { /* style still loading: the constructor's config covers it */ }
    setPoisVisible(m, mapPrefs.poi);
    setPoiKinds(m, mapPrefs.poiKinds);
    // Our layers and the panel follow the light: Brownstone by day, Signage after dark,
    // with per-light tweaks (see setLight). Changing the key restyles our layers.
    setLight(mapPrefs.light);
    setPaletteKey(mapPrefs.light);
    applyBasemapColors(m, mapPrefs.light);
  }, [mapPrefs]);
  // Tilt for 3D, flatten for 2D.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    m.easeTo({ pitch: mapPrefs.threeD ? THREE_D_PITCH : 0, duration: 800 });
  }, [mapPrefs.threeD]);

  // ---- Palette: recolour our layers in place and swap the CSS variables ------
  /** Changes whenever the palette does, to restyle our layers */
  const [paletteKey, setPaletteKey] = useState<string>(currentTheme);
  useEffect(() => {
    const m = map.current;
    if (!m?.getLayer("lines")) return; // first load styles itself
    restyleTransit(m);
    restylePois(m);
    restyleAreas(m);
    restyleParks(m);
    restyleAmbient(m);
  }, [paletteKey]);

  // ---- Decorative gray trains: how many are running (remembered) -----------
  const [ambientCount, setAmbientCount] = useState(() => {
    try {
      const n = Number(localStorage.getItem(AMBIENT_KEY));
      return localStorage.getItem(AMBIENT_KEY) !== null && Number.isFinite(n) ? Math.min(AMBIENT_MAX, Math.max(0, n)) : AMBIENT_DEFAULT;
    } catch { return AMBIENT_DEFAULT; }
  });
  const ambient = useRef<AmbientTrains | null>(null);
  const ambientCountRef = useRef(ambientCount);
  ambientCountRef.current = ambientCount;
  useEffect(() => {
    ambient.current?.setCount(ambientCount);
    try { localStorage.setItem(AMBIENT_KEY, String(ambientCount)); } catch { /* storage unavailable */ }
  }, [ambientCount]);
  const [showAreas, setShowAreas] = useState(() => loadLayerPrefs().areas);
  const [showBoroughs, setShowBoroughs] = useState(() => loadLayerPrefs().boroughs);
  const [showParks, setShowParks] = useState(() => loadLayerPrefs().parks);
  const [areas, setAreas] = useState<Areas | null>(null);
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  /**
   * Hovered area: a neighbourhood, or (zoomed in past SUB_ZOOM) a sub-neighbourhood.
   * Zoomed out, `sub` names the sub-neighbourhood under the cursor as a hint.
   */
  const [areaHover, setAreaHover] = useState<{ id: string; sub?: string; x: number; y: number } | null>(null);
  useEffect(() => {
    try { localStorage.setItem(LAYERS_KEY, JSON.stringify({ transit: showTransit, areas: showAreas, boroughs: showBoroughs, parks: showParks })); } catch { /* storage unavailable */ }
  }, [showTransit, showAreas, showBoroughs, showParks]);

  // ---- Parks -----------------------------------------------------------------
  const [parks, setParks] = useState<Parks | null>(null);
  const [selectedParkId, setSelectedParkId] = useState<string | null>(null);
  /** A clicked point of interest (museum, landmark, library…) */
  const [selectedPoi, setSelectedPoiState] = useState<Poi | null>(null);
  const [poiHover, setPoiHover] = useState<{ name: string; type: string; x: number; y: number } | null>(null);
  const [parkHover, setParkHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [visitedParks, setVisitedParks] = useState<string[]>(() => loadVisited("park"));
  const parksById = useMemo(() => new Map((parks?.features ?? []).map((f) => [f.properties.id, f as Park])), [parks]);
  /** Parks in each neighbourhood and sub-neighbourhood, counting every one a park passes through */
  const parksByArea = useMemo(() => {
    const byArea = new Map<string, Park[]>();
    for (const f of (parks?.features ?? []) as Park[]) {
      const p = f.properties;
      const ids = new Set([...(p.areaIds ?? [p.areaId]), ...(p.subAreaIds ?? [p.subAreaId])].filter(Boolean));
      for (const id of ids) byArea.set(id, [...(byArea.get(id) ?? []), f]);
    }
    return byArea;
  }, [parks]);
  const selectedPark = selectedParkId ? parksById.get(selectedParkId) ?? null : null;

  // Park type filter: chosen groups (none = every park), remembered between visits.
  const [parkGroups, setParkGroups] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(PARK_FILTER_KEY) ?? "[]"); } catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem(PARK_FILTER_KEY, JSON.stringify(parkGroups)); } catch { /* storage unavailable */ }
  }, [parkGroups]);
  const parkGroupCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of parks?.features ?? []) { const g = parkGroupOf(f.properties.type); counts[g] = (counts[g] ?? 0) + 1; }
    return counts;
  }, [parks]);
  /** Park types currently shown, or null for all of them */
  const visibleParkTypes = useMemo(() => {
    if (!parks || !parkGroups.length) return null;
    return typesForGroups(parkGroups, [...new Set(parks.features.map((f) => f.properties.type))]);
  }, [parks, parkGroups]);

  // Boroughs whose neighbourhoods are highlighted on the map (none = no highlight).
  const [highlightBoroughs, setHighlightBoroughs] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(HIGHLIGHT_KEY) ?? "[]"); } catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem(HIGHLIGHT_KEY, JSON.stringify(highlightBoroughs)); } catch { /* storage unavailable */ }
  }, [highlightBoroughs]);
  /** Set when the user changes the chips, so the map frames them (but not on page load). */
  const frameBoroughs = useRef(false);
  const toggleHighlight = (b: string) => {
    frameBoroughs.current = true;
    setHighlightBoroughs((list) => (list.includes(b) ? list.filter((x) => x !== b) : [...list, b]));
  };

  const areasById = useMemo(
    () => new Map((areas?.features ?? []).map((f) => [f.properties.id, f as Area])),
    [areas],
  );

  // Boroughs layer: hover card, and click to toggle that borough's highlight (same as the chips).
  const [boroughHover, setBoroughHoverCard] = useState<{ name: string; x: number; y: number } | null>(null);
  const boroughStats = useMemo(() => {
    const stats: Record<string, { neighborhoods: number; stops: number }> = {};
    for (const b of BOROUGHS) stats[b] = { neighborhoods: 0, stops: 0 };
    for (const f of areas?.features ?? []) if (f.properties.kind === "neighborhood" && stats[f.properties.borough]) stats[f.properties.borough].neighborhoods++;
    for (const f of stations?.features ?? []) if (f.properties.borough && stats[f.properties.borough]) stats[f.properties.borough].stops++;
    return stats;
  }, [areas, stations]);

  const toggleHighlightRef = useRef(toggleHighlight);
  toggleHighlightRef.current = toggleHighlight;
  const selectedArea = selectedAreaId ? areasById.get(selectedAreaId) ?? null : null;

  /** Select a neighbourhood (or deselect it if it's already selected). */
  const selectArea = (id: string, toggle = true) => {
    if (!areasById.has(id)) return;
    setShowAreas(true);
    setSelectedParkId(null); // one place card at a time: a neighbourhood, a park or a place
    setSelectedPoiState(null);
    setSelectedAreaId((current) => (toggle && current === id ? null : id));
  };
  const selectAreaRef = useRef(selectArea);
  selectAreaRef.current = selectArea;

  /** Select a park (or deselect it if it's already selected). */
  const selectPark = (id: string, toggle = true) => {
    setShowParks(true);
    setSelectedAreaId(null);
    setSelectedPoiState(null);
    setSelectedParkId((current) => (toggle && current === id ? null : id));
  };
  const selectParkRef = useRef(selectPark);
  selectParkRef.current = selectPark;

  /** Select a point of interest (clicking the selected one again closes it). */
  const selectPoi = (poi: Poi) => {
    setSelectedAreaId(null);
    setSelectedParkId(null);
    setSelectedPoiState((current) => (current && current.name === poi.name && current.coords.join() === poi.coords.join() ? null : poi));
  };
  const selectPoiRef = useRef(selectPoi);
  selectPoiRef.current = selectPoi;

  // Ring the selected place and bring it into view.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    setSelectedPoi(m, selectedPoi?.coords ?? null);
    if (selectedPoi) m.flyTo({ center: selectedPoi.coords, zoom: Math.max(m.getZoom(), 16), speed: STOP_FLY_SPEED, essential: true, padding: panelPadding() });
  }, [selectedPoi]);

  const stationsById = useMemo(
    () => new Map((stations?.features ?? []).map((f) => [f.properties.id, f as Station])),
    [stations],
  );

  /**
   * Select a station, or deselect it if it's already selected. If a line is focused
   * and doesn't stop here, move the focus to a line that does: the one under the
   * cursor if there is one, otherwise the station's first line.
   */
  const selectStation = (id: string, linesUnderCursor: string[] = [], toggle = true) => {
    const station = stationsById.get(id);
    if (!station) return;
    if (toggle && selected?.properties.id === id) { setSelected(null); return; }
    setSelected(station);
    if (!lineFilter) return;
    const here = stationRoutes(station, routes);
    if (here.includes(lineFilter)) return;
    const own = station.properties.routes.map((r) => baseRoute(r, routes));
    const next = linesUnderCursor.map((r) => baseRoute(r, routes)).find((r) => own.includes(r)) ?? own[0] ?? here[0];
    if (next) setLineFilter(next);
  };
  // The map's click handlers are bound once, so they call through this ref to see current state.
  const selectStationRef = useRef(selectStation);
  selectStationRef.current = selectStation;

  // Esc backs out one step at a time: the selected stop, then the park or neighbourhood, then the focused line.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (selected) setSelected(null);
      else if (selectedPoi) setSelectedPoiState(null);
      else if (selectedParkId) setSelectedParkId(null);
      else if (selectedAreaId) setSelectedAreaId(null);
      else if (lineFilter) setLineFilter("");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, selectedPoi, selectedParkId, selectedAreaId, lineFilter]);

  // station id -> coordinates, for placing trains
  const coordsById = useMemo(() => {
    const m = new Map<string, [number, number]>();
    stations?.features.forEach((f) => m.set(f.properties.id, f.geometry.coordinates as [number, number]));
    return m;
  }, [stations]);

  // ---- Map setup -----------------------------------------------------------
  useEffect(() => {
    if (!mapEl.current || map.current) return;
    if (!mapboxgl.accessToken) { setError("Add VITE_MAPBOX_TOKEN to client/.env.local"); return; }

    const prefs = mapPrefsRef.current;
    const m = new mapboxgl.Map({
      container: mapEl.current,
      style: BASEMAP_STYLE,
      config: {
        basemap: {
          lightPreset: prefs.light,
          theme: "default",
          show3dObjects: prefs.threeD,
          // We draw our own stations and lines; Mapbox's transit labels would double them up.
          showTransitLabels: false,
          // Standard's POIs are all-or-nothing, so ours (poi.ts) replace them, by category.
          showPointOfInterestLabels: false,
          ...QUIET_BASEMAP,
          showRoadLabels: prefs.streetNames,
          // Colours are applied once the style loads (applyBasemapColors), after reading Standard's own.
        },
      },
      center: NYC,
      zoom: 10.6,
      pitch: prefs.threeD ? THREE_D_PITCH : 0,
      minZoom: 9,
      maxBounds: [[-74.6, 40.35], [-73.4, 41.1]],
    });
    map.current = m;
    assignSlots(m);
    m.on("style.load", () => applyBasemapColors(m, mapPrefsRef.current.light));
    m.on("load", () => applyBasemapColors(m, mapPrefsRef.current.light));
    // The compass shows (and resets) rotation and tilt, which matter in 3D.
    m.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "bottom-right");

    m.on("load", async () => {
      try {
        const [lines, stationsData, routesData] = await fetchStatic();
        if (lines.features.length && typeof lines.features[0].properties?.slot !== "number") {
          setError("Line data is out of date. Run `npm run build:data` in /server, then reload.");
        }
        setStations(stationsData);
        setRoutes(routesData);
        addLayers(m, lines, stationsData);
        addPoiLayer(m, mapPrefsRef.current.poiKinds, "stations");
        setPoisVisible(m, mapPrefsRef.current.poi);
        // Above station dots (so a waiting train isn't hidden), below station names.
        ambient.current = startAmbientTrains(m, lines, { count: ambientCountRef.current, laneSpacing: LANE_SPACING, beforeId: "station-labels" });
      } catch (e) {
        setError((e as Error).message);
        return;
      }
      // Neighbourhoods are optional: if the build couldn't download them, the toggle just stays off.
      try {
        const areaData = await fetchAreas();
        // Sub-neighbourhood stops come from a newer build (older ones left them all empty).
        const subs = areaData.features.filter((f) => f.properties.kind === "sub");
        if (areaData.features.length && !areaData.features[0].properties?.kind) {
          setError("Neighborhood data is out of date. Run `npm run build:data` in /server, then reload.");
        } else {
          addAreaLayers(m, areaData, "lines-casing", "stations");
          setAreas(areaData);
          if (subs.length && subs.every((f) => !f.properties.stations?.length)) {
            setError("Neighborhood data is out of date. Run `npm run build:data` in /server, then reload.");
          }
        }
      } catch (e) {
        console.warn("neighborhoods unavailable", e);
      }
      // Parks are optional too. Added after the neighbourhoods so they draw on top of them
      // (and still under the subway lines).
      try {
        const parkData = await fetchParks();
        addParkLayers(m, parkData, "lines-casing", "stations");
        setParks(parkData);
      } catch (e) {
        console.warn("parks unavailable (run npm run build:data)", e);
      }
    });

    // ---- Park hover + click (transit, when shown, wins) --------------------
    const overTransitForParks = (point: mapboxgl.Point) =>
      m.queryRenderedFeatures(point, { layers: ["stations", "lines-hit", POI_LAYER].filter((l) => m.getLayer(l)) }).length > 0;

    // ---- Points of interest: hover + click (a station under the cursor wins) ----
    const poiAt = (point: mapboxgl.Point) =>
      m.getLayer(POI_LAYER) ? m.queryRenderedFeatures(point, { layers: [POI_LAYER] })[0] : undefined;
    const stationAt = (point: mapboxgl.Point) => m.queryRenderedFeatures(point, { layers: ["stations"] }).length > 0;
    m.on("mousemove", POI_LAYER, (e) => {
      const f = e.features?.[0];
      if (!f || stationAt(e.point)) { setPoiHover(null); return; }
      m.getCanvas().style.cursor = "pointer";
      setPoiHover({ name: String(f.properties?.name ?? ""), type: String(f.properties?.type ?? ""), x: e.point.x, y: e.point.y });
    });
    m.on("mouseleave", POI_LAYER, () => { setPoiHover(null); m.getCanvas().style.cursor = ""; });
    m.on("click", POI_LAYER, (e) => {
      const f = e.features?.[0];
      if (!f || stationAt(e.point) || f.geometry.type !== "Point") return;
      const p = f.properties ?? {};
      selectPoiRef.current({
        name: String(p.name ?? ""),
        type: String(p.type ?? p.category_en ?? ""),
        class: String(p.class ?? ""),
        maki: String(p.maki ?? ""),
        coords: f.geometry.coordinates as [number, number],
      });
    });
    let hoveredPark: string | null = null;
    const setParkHoverState = (id: string | null) => {
      if (hoveredPark === id) return;
      if (hoveredPark) m.setFeatureState({ source: "parks", id: hoveredPark }, { hover: false });
      if (id) m.setFeatureState({ source: "parks", id }, { hover: true });
      hoveredPark = id;
    };
    m.on("mousemove", "parks-fill", (e) => {
      const id = e.features?.[0]?.properties?.id as string | undefined;
      if (!id || overTransitForParks(e.point)) { setParkHoverState(null); setParkHover(null); return; }
      setParkHoverState(id);
      m.getCanvas().style.cursor = "pointer";
      setParkHover({ id, x: e.point.x, y: e.point.y });
    });
    m.on("mouseleave", "parks-fill", () => {
      setParkHoverState(null);
      setParkHover(null);
      m.getCanvas().style.cursor = "";
    });
    m.on("click", "parks-fill", (e) => {
      if (overTransitForParks(e.point)) return;
      const id = e.features?.[0]?.properties?.id as string | undefined;
      if (id) selectParkRef.current(id);
    });
    /** Parks sit above neighbourhoods and boroughs, so they take hovers and clicks first. */
    const overPark = (point: mapboxgl.Point) =>
      !!m.getLayer("parks-fill") && m.getLayoutProperty("parks-fill", "visibility") !== "none" &&
      m.queryRenderedFeatures(point, { layers: ["parks-fill"] }).length > 0;

    // ---- Neighbourhood hover + click (transit, when shown, wins) ----------
    const overTransit = (point: mapboxgl.Point) =>
      m.queryRenderedFeatures(point, { layers: ["stations", "lines-hit", POI_LAYER].filter((l) => m.getLayer(l)) }).length > 0;
    let hoveredArea: string | null = null;
    const setAreaHoverState = (id: string | null) => {
      if (hoveredArea === id) return;
      if (hoveredArea) m.setFeatureState({ source: "areas", id: hoveredArea }, { hover: false });
      if (id) m.setFeatureState({ source: "areas", id }, { hover: true });
      hoveredArea = id;
    };
    /** The sub-neighbourhood under the point, if any (they're queryable at every zoom). */
    const subAt = (point: mapboxgl.Point) =>
      m.queryRenderedFeatures(point, { layers: ["areas-sub-hit"] })[0]?.properties as { id: string; name: string } | undefined;
    /** What a hover or click at this point targets: the sub-neighbourhood once zoomed in, else the neighbourhood. */
    const areaTarget = (point: mapboxgl.Point, parentId: string) => {
      const sub = subAt(point);
      return sub && m.getZoom() >= SUB_ZOOM ? { id: sub.id } : { id: parentId, sub: sub?.name };
    };
    m.on("mousemove", "areas-fill", (e) => {
      const parentId = e.features?.[0]?.properties?.id as string | undefined;
      if (!parentId || overTransit(e.point) || overPark(e.point)) { setAreaHoverState(null); setAreaHover(null); return; }
      const target = areaTarget(e.point, parentId);
      setAreaHoverState(target.id);
      m.getCanvas().style.cursor = "pointer";
      setAreaHover({ ...target, x: e.point.x, y: e.point.y });
    });
    m.on("mouseleave", "areas-fill", () => {
      setAreaHoverState(null);
      setAreaHover(null);
      m.getCanvas().style.cursor = "";
    });
    m.on("click", "areas-fill", (e) => {
      if (overTransit(e.point) || overPark(e.point)) return;
      const parentId = e.features?.[0]?.properties?.id as string | undefined;
      if (parentId) selectAreaRef.current(areaTarget(e.point, parentId).id);
    });

    // ---- Borough hover + click (Boroughs layer) ------------------------------
    // When Neighborhoods is also on, it sits on top and gets the hovers and clicks.
    const neighborhoodsShowing = () => m.getLayer("areas-fill") && m.getLayoutProperty("areas-fill", "visibility") === "visible";
    let hoveredBorough: string | null = null;
    const clearBoroughHover = () => {
      if (hoveredBorough) setBoroughHover(m, null);
      hoveredBorough = null;
      setBoroughHoverCard(null);
    };
    m.on("mousemove", "boroughs-fill", (e) => {
      const borough = e.features?.[0]?.properties?.borough as string | undefined;
      if (!borough || overTransit(e.point) || overPark(e.point) || neighborhoodsShowing()) { clearBoroughHover(); return; }
      if (borough !== hoveredBorough) { setBoroughHover(m, borough); hoveredBorough = borough; }
      m.getCanvas().style.cursor = "pointer";
      setBoroughHoverCard({ name: borough, x: e.point.x, y: e.point.y });
    });
    m.on("mouseleave", "boroughs-fill", () => {
      clearBoroughHover();
      m.getCanvas().style.cursor = "";
    });
    m.on("click", "boroughs-fill", (e) => {
      if (overTransit(e.point) || overPark(e.point) || neighborhoodsShowing()) return;
      const borough = e.features?.[0]?.properties?.borough as string | undefined;
      if (borough) toggleHighlightRef.current(borough);
    });

    m.on("click", "stations", (e) => {
      const id = e.features?.[0]?.properties?.id as string | undefined;
      if (!id) return;
      // Lines under the cursor tell us which line the user was pointing at.
      const underCursor = m
        .queryRenderedFeatures(e.point, { layers: ["lines-hit"] })
        .map((f) => f.properties?.routeId as string);
      selectStationRef.current(id, underCursor);
    });
    m.on("mouseenter", "stations", () => (m.getCanvas().style.cursor = "pointer"));
    m.on("mouseleave", "stations", () => (m.getCanvas().style.cursor = ""));

    // Hovering a line focuses that route and shows its card; clicking pins the focus.
    m.on("mousemove", "lines-hit", (e) => {
      const routeId = e.features?.[0]?.properties?.routeId as string | undefined;
      if (!routeId) return;
      m.getCanvas().style.cursor = "pointer";
      setHover({ routeId, x: e.point.x, y: e.point.y });
    });
    m.on("mouseleave", "lines-hit", () => {
      m.getCanvas().style.cursor = "";
      setHover(null);
    });
    m.on("click", "lines-hit", (e) => {
      // A click on a station sitting on the line is a station click, not a line click.
      if (m.queryRenderedFeatures(e.point, { layers: ["stations"] }).length || poiAt(e.point)) return;
      const routeId = e.features?.[0]?.properties?.routeId as string | undefined;
      if (routeId) setLineFilter((current) => (current === routeId ? "" : routeId));
    });

    return () => { ambient.current?.stop(); ambient.current = null; m.remove(); map.current = null; };
  }, []);

  // ---- Realtime trains -----------------------------------------------------
  useEffect(() => {
    if (!stations || !showTrains) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const { trains } = await fetchRealtime();
        if (cancelled) return;
        const fc = trainsToGeoJson(trains, coordsById, routes);
        (map.current?.getSource("trains") as GeoJSONSource | undefined)?.setData(fc);
        setTrainCount(fc.features.length);
        const counts: Record<string, number> = {};
        for (const t of trains) {
          const r = baseRoute(t.routeId, routes);
          counts[r] = (counts[r] ?? 0) + 1;
        }
        setTrainsByRoute(counts);
      } catch (e) {
        console.warn("realtime failed", e);
      }
    };
    tick();
    const id = setInterval(tick, REALTIME_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [stations, showTrains, coordsById, routes]);

  // ---- Layer visibility ------------------------------------------------------
  useEffect(() => {
    const m = map.current;
    if (!m || !stations) return;
    for (const id of TRANSIT_LAYERS) {
      if (!m.getLayer(id)) continue;
      const isLive = id === "trains" || id === "train-labels";
      m.setLayoutProperty(id, "visibility", showTransit && (!isLive || showTrains) ? "visible" : "none");
    }
    if (!showTransit) { setLineFilter(""); setHover(null); }
  }, [showTransit, showTrains, stations]);

  useEffect(() => {
    const m = map.current;
    if (!m || !areas) return;
    setAreasVisible(m, showAreas, showBoroughs);
    if (!showAreas) { setSelectedAreaId(null); setAreaHover(null); }
    if (!showBoroughs || showAreas) setBoroughHoverCard(null);
  }, [showAreas, showBoroughs, areas]);

  useEffect(() => {
    const m = map.current;
    if (!m || !parks) return;
    setParksVisible(m, showParks);
    if (!showParks) { setSelectedParkId(null); setParkHover(null); }
  }, [showParks, parks]);

  useEffect(() => {
    const m = map.current;
    if (m && parks) setParkTypeFilter(m, visibleParkTypes);
  }, [visibleParkTypes, parks]);

  // Highlight the selected park and fly to it, the same way as stops and neighbourhoods.
  useEffect(() => {
    const m = map.current;
    if (!m || !parks) return;
    setSelectedPark(m, selectedParkId);
    const park = selectedParkId ? parksById.get(selectedParkId) : null;
    if (!park) return;
    const camera = m.cameraForBounds(parkBounds(park.geometry.coordinates), { padding: panelPadding(), maxZoom: 16 });
    if (camera) m.flyTo({ ...camera, speed: STOP_FLY_SPEED, essential: true });
  }, [selectedParkId, parks, parksById]);

  // Borough highlight: brighten those boroughs' neighbourhoods and, after a change, frame them.
  useEffect(() => {
    const m = map.current;
    if (!m || !areas) return;
    setBoroughHighlight(m, highlightBoroughs); // also re-run on theme change: it sets outline colours
    if (!frameBoroughs.current) return;
    frameBoroughs.current = false;
    const bounds = highlightBoroughs.length ? boroughBounds(areas, highlightBoroughs) : null;
    if (bounds) m.fitBounds(bounds, { padding: panelPadding(), maxZoom: 13, duration: 800 });
  }, [highlightBoroughs, areas, paletteKey]);

  // Highlight the selected neighbourhood and frame it on the map.
  useEffect(() => {
    const m = map.current;
    if (!m || !areas) return;
    setSelectedArea(m, selectedAreaId);
    const area = selectedAreaId ? areasById.get(selectedAreaId) : null;
    if (!area) return;
    // Same camera move as selecting a stop (flyTo at speed 0.9), framed to fit the whole neighbourhood.
    const camera = m.cameraForBounds(areaBounds(area.geometry.coordinates), { padding: panelPadding(), maxZoom: 15 });
    if (camera) m.flyTo({ ...camera, speed: STOP_FLY_SPEED, essential: true });
  }, [selectedAreaId, areas, areasById]);

  // ---- Focus: the hovered (or picked) route stays bright and raised; the rest dim
  const focusRoute = hover?.routeId || lineFilter;
  useEffect(() => {
    const m = map.current;
    if (!m?.getLayer("lines")) return;
    const isFocus: Expr = ["==", ["get", "routeId"], focusRoute];
    m.setPaintProperty("lines", "line-opacity", focusRoute ? ["case", isFocus, 1, 0.15] : 1);
    m.setPaintProperty("lines-casing", "line-opacity", focusRoute ? ["case", isFocus, 0.95, 0] : 0.95);
    m.setPaintProperty("lines-casing", "line-width", casingWidth(focusRoute ? isFocus : false));
    m.setPaintProperty("lines", "line-width", focusRoute ? lineWidth(isFocus) : lineWidth());
    // Draw the focused route last so it sits on top of its neighbours.
    m.setLayoutProperty("lines", "line-sort-key", focusRoute ? ["case", isFocus, 1, 0] : 0);
    setAmbientFocus(m, focusRoute);
  }, [focusRoute, stations]);

  // ---- Selection: highlight, fly, load arrivals ----------------------------
  useEffect(() => {
    const m = map.current;
    (m?.getSource("selected") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: selected ? [selected] : [],
    });
    if (!selected) return;
    m?.flyTo({ center: selected.geometry.coordinates as [number, number], zoom: 14.5, speed: STOP_FLY_SPEED, essential: true });

    let cancelled = false;
    setArrivals(null);
    const load = () => fetchArrivals(selected.properties.complexIds ?? [selected.properties.id]).then((r) => !cancelled && setArrivals(r.arrivals)).catch(() => !cancelled && setArrivals([]));
    load();
    const id = setInterval(load, REALTIME_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [selected]);

  // ---- "Take me somewhere": a random stop or neighbourhood, preferring new ones
  // `boroughs` limits where we can land; empty means anywhere.
  const inBoroughs = (borough: string | undefined, boroughs: string[]) => !boroughs.length || boroughs.includes(borough ?? "");

  const rollStop = (boroughs: string[]) => {
    if (!stations) return;
    setShowTransit(true); // the roll lands on a stop, so make sure stops are showing
    const pool = (stations.features as Station[]).filter((s) => inBoroughs(s.properties.borough, boroughs));
    const pick = pickRandom(pool, visited);
    if (!pick) return;
    const next = [...visited.filter((v) => v !== pick.properties.id), pick.properties.id];
    setVisited(next);
    saveVisited(next, "stop");
    setSelectedAreaId(null); // so the panel opens on the stop, not a neighbourhood or park from earlier
    setSelectedParkId(null);
    setSelectedPoiState(null);
    selectStation(pick.properties.id, [], false);
  };
  const rollNeighborhood = (boroughs: string[]) => {
    if (!areas) return;
    const pool = (areas.features as Area[]).filter((a) => a.properties.kind === "neighborhood" && inBoroughs(a.properties.borough, boroughs));
    const pick = pickRandom(pool, visitedAreas);
    if (!pick) return;
    const next = [...visitedAreas.filter((v) => v !== pick.properties.id), pick.properties.id];
    setVisitedAreas(next);
    saveVisited(next, "neighborhood");
    setSelected(null); // so the panel opens on the neighbourhood, not a stop from earlier
    selectArea(pick.properties.id, false);
  };

  const rollPark = (boroughs: string[]) => {
    if (!parks) return;
    // The park types picked in the left panel, or by default proper parks only
    // (no traffic triangles or playgrounds), in the chosen boroughs.
    const typeOk = (t: string) => (visibleParkTypes ? visibleParkTypes.includes(t) : DESTINATION_TYPES.has(t));
    const pool = (parks.features as Park[]).filter((p) => typeOk(p.properties.type) && inBoroughs(p.properties.borough, boroughs));
    const pick = pickRandom(pool, visitedParks);
    if (!pick) return;
    const next = [...visitedParks.filter((v) => v !== pick.properties.id), pick.properties.id];
    setVisitedParks(next);
    saveVisited(next, "park");
    setSelected(null); // so the panel opens on the park
    selectPark(pick.properties.id, false);
  };

  const takeMeSomewhere = (kind: RandomKind, boroughs: string[]) =>
    kind === "stop" ? rollStop(boroughs) : kind === "park" ? rollPark(boroughs) : rollNeighborhood(boroughs);
  // Borough chips only make sense once stations carry borough data (from the neighbourhood build).
  const hasBoroughs = !!stations?.features.some((s) => s.properties.borough);


  // ---- Search: picking a result does what clicking it on the map would ------
  const routesAtStation = useMemo(
    () => (s: Station) => [...new Set(s.properties.routes.map((r) => baseRoute(r, routes)))].sort(routeSort),
    [routes],
  );
  const pickFromSearch = ({ kind, id }: PlacePick) => {
    if (kind === "neighborhood" || kind === "sub") selectArea(id, false);
    else if (kind === "park") selectPark(id, false);
    else if (kind === "station") { setShowTransit(true); selectStation(id, [], false); }
    else if (kind === "line") { setShowTransit(true); setLineFilter(id); }
    else if (kind === "borough") {
      if (!showAreas && !showBoroughs) setShowAreas(true); // so the highlight has something to show
      if (!highlightBoroughs.includes(id)) toggleHighlight(id);
    }
  };

  const routeList = useMemo(
    () => Object.values(routes).filter((r) => stations?.features.some((s) => s.properties.routes.includes(r.id))),
    [routes, stations],
  );

  return (
    <div className="app">
      <div ref={mapEl} className="map" />

      <aside className="panel">
        <header>
          <h1>Stand Clear</h1>
          <p className="sub">
            Live subway trains{areas ? ", the neighborhoods they run through" : ""}{parks ? (areas ? " and the parks in between" : " and the parks nearby") : ""}.
            Search for anything, or hit “Take me somewhere” and go somewhere new.
          </p>
        </header>

        {stations && (
          <PlaceSearch
            areas={(areas?.features ?? []) as Area[]}
            parks={(parks?.features ?? []) as Park[]}
            stations={stations.features as Station[]}
            routes={routes}
            routesAt={routesAtStation}
            onPick={pickFromSearch}
          />
        )}

        {areas && (showAreas || showBoroughs) && (
          <div className="borough-highlight">
            <div className="borough-highlight-head">
              <span className="filter-label">Highlight boroughs</span>
              {highlightBoroughs.length > 0 && (
                <button className="text-button" onClick={() => setHighlightBoroughs([])}>Clear</button>
              )}
            </div>
            <div className="chips" role="group" aria-label="Highlight boroughs">
              {BOROUGHS.map((b) => (
                <button
                  key={b}
                  className={`chip${highlightBoroughs.includes(b) ? " on" : ""}`}
                  aria-pressed={highlightBoroughs.includes(b)}
                  onClick={() => toggleHighlight(b)}
                >
                  {b}
                </button>
              ))}
            </div>
          </div>
        )}

        {parks && showParks && (
          <div className="borough-highlight">
            <div className="borough-highlight-head">
              <span className="filter-label">Park types</span>
              {parkGroups.length > 0 && (
                <button className="text-button" onClick={() => setParkGroups([])}>Show all</button>
              )}
            </div>
            <div className="chips" role="group" aria-label="Filter parks by type">
              {PARK_GROUPS.filter((g) => parkGroupCounts[g.key]).map((g) => {
                const on = parkGroups.includes(g.key);
                return (
                  <button
                    key={g.key}
                    className={`chip park-chip${on ? " on" : ""}`}
                    aria-pressed={on}
                    onClick={() => setParkGroups((list) => (on ? list.filter((x) => x !== g.key) : [...list, g.key]))}
                  >
                    {g.label} <span className="chip-count">{parkGroupCounts[g.key]}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {showTransit && (
        <>
        <label className="field">
          <span>Show line</span>
          <select value={lineFilter} onChange={(e) => setLineFilter(e.target.value)}>
            <option value="">Any line</option>
            {routeList.map((r) => (
              <option key={r.id} value={r.id}>{r.name} — {r.longName}</option>
            ))}
          </select>
        </label>

        <label className="toggle">
          <input type="checkbox" checked={showTrains} onChange={(e) => setShowTrains(e.target.checked)} />
          <span>Live trains {showTrains && trainCount ? `· ${trainCount} running` : ""}</span>
        </label>
        </>
        )}

        {selectedPoi && stations && (
          <PoiPanel
            poi={selectedPoi}
            areas={(areas?.features ?? []) as Area[]}
            stations={stations.features as Station[]}
            routes={routes}
            selectedStationId={selected?.properties.id}
            onSelectArea={(id) => selectArea(id, false)}
            onSelectStation={(id) => { setShowTransit(true); selectStation(id); }}
            onClose={() => setSelectedPoiState(null)}
          />
        )}

        {selectedPark && (
          <ParkPanel
            park={selectedPark}
            routes={routes}
            stationsById={stationsById}
            areaExists={(id) => areasById.has(id)}
            selectedStationId={selected?.properties.id}
            onSelectArea={(id) => selectArea(id, false)}
            onSelectStation={(id) => { setShowTransit(true); selectStation(id); }}
            onClose={() => setSelectedParkId(null)}
          />
        )}

        {selectedArea && (
          <AreaPanel
            area={selectedArea}
            parks={(parksByArea.get(selectedArea.properties.id) ?? []).filter((pk) => !visibleParkTypes || visibleParkTypes.includes(pk.properties.type))}
            onSelectPark={(id) => selectPark(id, false)}
            parent={selectedArea.properties.parent ? areasById.get(selectedArea.properties.parent) ?? null : null}
            subs={(areas?.features as Area[] | undefined)?.filter((f) => f.properties.kind === "sub" && f.properties.parent === selectedArea.properties.id) ?? []}
            onSelectArea={(id) => selectArea(id, false)}
            routes={routes}
            stationsById={stationsById}
            focusedLine={lineFilter}
            selectedStationId={selected?.properties.id}
            transitOn={showTransit}
            onFocusLine={(r) => setLineFilter((current) => (current === r ? "" : r))}
            onSelectStation={(id) => { setShowTransit(true); selectStation(id); }}
            onClose={() => setSelectedAreaId(null)}
          />
        )}

        {lineFilter && routes[lineFilter] && (
          <LineStops
            route={routes[lineFilter]}
            routes={routes}
            stationsById={stationsById}
            selectedId={selected?.properties.id}
            onSelect={(s) => selectStation(s.properties.id)}
            onClose={() => setLineFilter("")}
          />
        )}

        {selected && (
          <section className="card">
            <div className="station-head">
              <div className="bullets">
                {stationRoutes(selected, routes).map((r) => (
                  <button
                    key={r}
                    className={`bullet-button${r === lineFilter ? " active" : ""}`}
                    onClick={() => setLineFilter((current) => (current === r ? "" : r))}
                    title={r === lineFilter ? "Unfocus this line" : `Show all ${routes[r]?.name ?? r} stops`}
                  >
                    <Bullet route={routes[r]} id={r} />
                  </button>
                ))}
              </div>
              <button className="close" onClick={() => setSelected(null)} aria-label="Close stop" title="Close (Esc)">×</button>
            </div>
            <h2 className="sign">{selected.properties.name}</h2>
            {selected.properties.neighborhood && (
              <p className="place">
                {selected.properties.subNeighborhood && (
                  <>
                    {selected.properties.subAreaId && areasById.has(selected.properties.subAreaId) ? (
                      <button className="place-link" onClick={() => selectArea(selected.properties.subAreaId!, false)} title="Show this area">
                        {selected.properties.subNeighborhood}
                      </button>
                    ) : (
                      selected.properties.subNeighborhood
                    )}
                    {" · "}
                  </>
                )}
                {selected.properties.areaId && areasById.has(selected.properties.areaId) ? (
                  <button className="place-link" onClick={() => selectArea(selected.properties.areaId!, false)} title="Show this neighborhood">
                    {selected.properties.neighborhood}
                  </button>
                ) : (
                  selected.properties.neighborhood
                )}
                {" · "}{selected.properties.borough}
              </p>
            )}
            <a
              className="link"
              target="_blank"
              rel="noreferrer"
              href={`https://www.google.com/maps/search/?api=1&query=${selected.geometry.coordinates[1]},${selected.geometry.coordinates[0]}`}
            >
              What's around here? ↗
            </a>

            <h3>Next trains</h3>
            {arrivals === null ? (
              <p className="muted">Checking the boards…</p>
            ) : arrivals.length === 0 ? (
              <p className="muted">No live arrivals right now.</p>
            ) : (
              <ul className="arrivals">
                {arrivals.slice(0, 10).map((a) => (
                  <li key={a.tripId + a.stopId}>
                    <Bullet route={routes[baseRoute(a.routeId, routes)]} id={a.routeId} small />
                    <span>{a.direction === "N" ? "Uptown / Bronx-bound" : "Downtown / Brooklyn-bound"}</span>
                    <strong>{minutesUntil(a.time)}</strong>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <footer className="muted">
          {visited.length} stops rolled · Data: MTA GTFS &amp; GTFS-RT · Neighborhoods:{" "}
          <a href="https://github.com/chriswhong/nyc-neighborhood-boundaries" target="_blank" rel="noreferrer">NYC Neighborhood Boundaries</a>{" "}
          (<a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>)
          {parks && <> · Parks: <a href="https://data.cityofnewyork.us/Recreation/Parks-Properties/enfh-gkve" target="_blank" rel="noreferrer">NYC Parks via NYC Open Data</a></>}
        </footer>
      </aside>

      {hover && routes[hover.routeId] && (
        <LineCard
          route={routes[hover.routeId]}
          trains={trainsByRoute[hover.routeId] ?? 0}
          showTrains={showTrains}
          pinned={lineFilter === hover.routeId}
          x={hover.x}
          y={hover.y}
        />
      )}

      {boroughHover && !hover && boroughStats[boroughHover.name] && (() => {
        const st = boroughStats[boroughHover.name];
        const flip = boroughHover.x > window.innerWidth - 300;
        return (
          <div className={`line-card area-hover${flip ? " flip" : ""}`} style={{ left: boroughHover.x, top: boroughHover.y }}>
            <div>
              <strong>{boroughHover.name}</strong>
              <span>
                {st.neighborhoods} neighborhoods · {st.stops} stops ·{" "}
                {highlightBoroughs.includes(boroughHover.name) ? "Click to remove highlight" : "Click to highlight"}
              </span>
            </div>
          </div>
        );
      })()}

      {poiHover && (
        <div className={`line-card poi-hover${poiHover.x > window.innerWidth - 300 ? " flip" : ""}`} style={{ left: poiHover.x, top: poiHover.y }}>
          <div>
            <strong>{poiHover.name}</strong>
            <span>{poiHover.type || "Place"}{selectedPoi?.name === poiHover.name ? " · Click to close" : ""}</span>
          </div>
        </div>
      )}

      {parkHover && !hover && !poiHover && parksById.get(parkHover.id) && (() => {
        const p = parksById.get(parkHover.id)!.properties;
        const flip = parkHover.x > window.innerWidth - 300;
        return (
          <div className={`line-card park-hover${flip ? " flip" : ""}`} style={{ left: parkHover.x, top: parkHover.y }}>
            <div>
              <strong>{p.name}</strong>
              <span>
                {p.type || "Park"}{p.acres >= 1 ? ` · ${Math.round(p.acres).toLocaleString()} acres` : ""}
                {selectedParkId === p.id ? " · Click to close" : ""}
              </span>
            </div>
          </div>
        );
      })()}

      {areaHover && !hover && !parkHover && areasById.get(areaHover.id) && (() => {
        const a = areasById.get(areaHover.id)!.properties;
        const parent = a.kind === "sub" ? areasById.get(a.parent)?.properties : undefined;
        const flip = areaHover.x > window.innerWidth - 300;
        return (
          <div className={`line-card area-hover${flip ? " flip" : ""}`} style={{ left: areaHover.x, top: areaHover.y }}>
            <div>
              <strong>{a.name}</strong>
              <span>
                {parent ? `in ${parent.name} · ` : areaHover.sub ? `${areaHover.sub} · ` : ""}
                {a.borough} · {a.stations.length === 0 ? "no subway stops" : `${a.stations.length} ${a.stations.length === 1 ? "stop" : "stops"}`}
                {selectedAreaId === a.id ? " · Click to close" : ""}
              </span>
            </div>
          </div>
        );
      })()}

      <LayerToggles
        transit={showTransit}
        areas={showAreas}
        boroughs={showBoroughs}
        parks={showParks}
        areasAvailable={!!areas}
        parksAvailable={!!parks}
        onTransit={setShowTransit}
        onAreas={setShowAreas}
        onBoroughs={setShowBoroughs}
        onParks={setShowParks}
        places={mapPrefs.poi}
        onPlaces={(poi) => updateMap({ poi })}
      />

      <MapSettings
        light={mapPrefs.light}
        onLight={(light) => updateMap({ light })}
        threeD={mapPrefs.threeD}
        onThreeD={(threeD) => updateMap({ threeD })}
        streetNames={mapPrefs.streetNames}
        onStreetNames={(streetNames) => updateMap({ streetNames })}
        poiKinds={mapPrefs.poiKinds}
        onPoiKinds={(poiKinds) => updateMap({ poiKinds })}
        trains={ambientCount}
        trainsMax={AMBIENT_MAX}
        trainsStep={AMBIENT_STEP}
        trainsOff={!showTransit}
        onTrains={setAmbientCount}
      />

      <RandomPicker
        onPick={takeMeSomewhere}
        disabled={!stations}
        unavailable={[...(areas ? [] : ["neighborhood" as const]), ...(parks ? [] : ["park" as const])]}
        boroughsAvailable={hasBoroughs}
      />

      {error && <div className="error">{error}</div>}
    </div>
  );
}

/** Strip map of one line: every stop in order, with transfers to other lines. */
function LineStops({ route, routes, stationsById, selectedId, onSelect, onClose }: {
  route: RouteInfo;
  routes: Routes;
  stationsById: Map<string, Station>;
  selectedId?: string;
  onSelect: (s: Station) => void;
  onClose: () => void;
}) {
  const nameOf = (id: string | null) => (id && stationsById.get(id)?.properties.name) || "";
  const total = (route.stops?.length ?? 0) + (route.branches ?? []).reduce((n, b) => n + b.stops.length, 0);

  const renderStops = (ids: string[]) => (
    <ol className="strip" style={{ "--route": route.color } as CSSProperties}>
      {ids.map((id) => {
        const station = stationsById.get(id);
        if (!station) return null;
        // Other lines you can change to here, counting X variants as their base route.
        const others = stationRoutes(station, routes).filter((r) => r !== route.id);
        return (
          <li key={id} className={`${others.length ? "transfer" : ""}${id === selectedId ? " selected" : ""}`}>
            <button onClick={() => onSelect(station)}>
              <span className="stop-name">{station.properties.name}</span>
              {others.length > 0 && (
                <span className="transfers">
                  {others.map((r) => <Bullet key={r} route={routes[r]} id={r} small />)}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );

  return (
    <section className="card line-stops">
      <div className="line-head">
        <Bullet route={route} id={route.id} />
        <div>
          <h2 className="sign">{route.longName || `${route.name} train`}</h2>
          <p className="muted">{route.stops ? `${total} stops` : "Run npm run build:data to load stops"}</p>
        </div>
        <button className="close" onClick={onClose} aria-label="Close line">×</button>
      </div>
      {route.stops && (
        <div className="strip-scroll">
          {renderStops(route.stops)}
          {route.branches?.map((b) => (
            <div key={b.stops[0]} className="branch">
              <h3>Branch{b.from ? ` from ${nameOf(b.from)}` : ""}</h3>
              {renderStops(b.stops)}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function LineCard({ route, trains, showTrains, pinned, x, y }: {
  route: { id: string; name: string; longName: string; color: string; textColor: string };
  trains: number;
  showTrains: boolean;
  pinned: boolean;
  x: number;
  y: number;
}) {
  // Sit to the right of the cursor, or flip left near the screen edge.
  const flip = x > window.innerWidth - 300;
  return (
    <div className={`line-card${flip ? " flip" : ""}`} style={{ left: x, top: y, borderLeftColor: route.color }}>
      <Bullet route={route} id={route.id} />
      <div>
        <strong>{route.longName || `${route.name} train`}</strong>
        <span>
          {showTrains && `${trains} train${trains === 1 ? "" : "s"} running · `}
          {pinned ? "Click to unfocus" : "Click to focus"}
        </span>
      </div>
    </div>
  );
}

function minutesUntil(t: number) {
  const m = Math.round((t - Date.now() / 1000) / 60);
  return m <= 0 ? "now" : `${m} min`;
}

function trainsToGeoJson(trains: Train[], coords: Map<string, [number, number]>, routes: Routes): FeatureCollection<Point> {
  const features: Feature<Point>[] = [];
  for (const t of trains) {
    if (!t.stopId) continue;
    const base = coords.get(t.stopId.replace(/[NS]$/, ""));
    if (!base) continue;
    // Nudge N/S-bound trains apart so they don't sit exactly on top of each other.
    const off = t.direction === "N" ? 0.0004 : t.direction === "S" ? -0.0004 : 0;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [base[0] + off, base[1]] },
      properties: {
        routeId: t.routeId,
        name: routes[t.routeId]?.name ?? t.routeId,
        color: routes[t.routeId]?.color ?? "#808183",
        textColor: routes[t.routeId]?.textColor ?? "#ffffff",
        status: t.status,
      },
    });
  }
  return { type: "FeatureCollection", features };
}

function addLayers(m: mapboxgl.Map, lines: Lines, stations: Stations) {
  m.addSource("lines", { type: "geojson", data: lines });
  m.addSource("stations", { type: "geojson", data: stations });
  m.addSource("trains", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  m.addSource("selected", { type: "geojson", data: { type: "FeatureCollection", features: [] } });

  // Lines go in the "middle" slot (see assignSlots), under the basemap's labels.
  const beforeLabels = undefined;

  // A paper-coloured outline under the lines, so even pale lines (N/Q/R/W, G, shuttles)
  // stand out from the cream basemap.
  m.addLayer({
    id: "lines-casing",
    type: "line",
    source: "lines",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: {
      "line-color": T.halo,
      "line-width": casingWidth(),
      "line-offset": lineOffset,
      "line-opacity": 0.95,
    },
  }, beforeLabels);

  m.addLayer({
    id: "lines",
    type: "line",
    source: "lines",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: {
      "line-color": ["get", "color"],
      "line-width": lineWidth(),
      "line-offset": lineOffset,
      "line-opacity": 1,
    },
  }, beforeLabels);

  // Invisible, wider copy of the lines that catches the mouse, so thin lines are easy to hover.
  m.addLayer({
    id: "lines-hit",
    type: "line",
    source: "lines",
    paint: {
      "line-color": "rgba(0, 0, 0, 0)",
      "line-width": ["interpolate", ["linear"], ["zoom"], 9, 8, 14, 10, 17, 14],
      "line-offset": lineOffset,
    },
  }, beforeLabels);

  // Stops and live trains stay hidden at city scale (just the lines), and fade in
  // from about borough scale, where they're far enough apart to read and tap.
  const DETAIL_FROM = 12.5;
  const fadeIn = (to: number | mapboxgl.ExpressionSpecification = 1): mapboxgl.ExpressionSpecification =>
    ["interpolate", ["linear"], ["zoom"], DETAIL_FROM, 0, DETAIL_FROM + 0.5, to];
  m.addLayer({
    id: "stations",
    type: "circle",
    source: "stations",
    minzoom: DETAIL_FROM,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], DETAIL_FROM, 2.5, 14, 5, 17, 9],
      "circle-color": T.stationFill,
      "circle-stroke-color": T.stationStroke,
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], DETAIL_FROM, 0.75, 14, 1.5],
      "circle-opacity": fadeIn(),
      "circle-stroke-opacity": fadeIn(),
    },
  });

  m.addLayer({
    id: "station-labels",
    type: "symbol",
    source: "stations",
    minzoom: 13,
    layout: {
      "text-field": ["get", "name"],
      "text-size": 12,
      "text-offset": [0, 1.2],
      "text-anchor": "top",
      "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
    },
    paint: { "text-color": T.ink, "text-halo-color": T.halo, "text-halo-width": 1.5 },
  });

  m.addLayer({
    id: "trains",
    type: "circle",
    source: "trains",
    minzoom: DETAIL_FROM,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], DETAIL_FROM, 5, 14, 9],
      "circle-color": ["get", "color"],
      "circle-stroke-color": "#fff",
      "circle-stroke-width": 1.5,
      // Trains waiting at a platform are solid; ones between stops are slightly faded.
      "circle-opacity": fadeIn(["match", ["get", "status"], "STOPPED_AT", 1, 0.75]),
      "circle-stroke-opacity": fadeIn(),
    },
  });

  m.addLayer({
    id: "train-labels",
    type: "symbol",
    source: "trains",
    minzoom: DETAIL_FROM,
    layout: {
      "text-field": ["get", "name"],
      "text-size": 10,
      "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"],
      "text-allow-overlap": true,
    },
    paint: { "text-color": ["get", "textColor"], "text-opacity": fadeIn() },
  });

  m.addLayer({
    id: "selected",
    type: "circle",
    source: "selected",
    paint: {
      "circle-radius": 16,
      "circle-color": T.select,
      "circle-opacity": 0.22,
      "circle-stroke-color": T.selectInk,
      "circle-stroke-width": 3,
    },
  });
}
