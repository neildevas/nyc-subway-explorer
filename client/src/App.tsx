import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import mapboxgl, { type GeoJSONSource } from "mapbox-gl";
import type { Feature, FeatureCollection, MultiPolygon, Point } from "geojson";
import { fetchArrivals, fetchAreas, fetchRealtime, fetchStatic } from "./api";
import { loadVisited, pickRandom, saveVisited } from "./random";
import { setAmbientFocus, startAmbientTrains } from "./ambient";
import { Bullet, routeSort } from "./Bullet";
import { RandomPicker, type RandomKind } from "./RandomPicker";
import { LayerToggles } from "./LayerToggles";
import { AreaPanel } from "./AreaPanel";
import { AreaSearch } from "./AreaSearch";
import { addAreaLayers, areaBounds, boroughBounds, setAreasVisible, setBoroughHighlight, setBoroughHover, setSelectedArea } from "./areas";
import type { AreaProps, Areas, Arrival, Lines, RouteInfo, Routes, StationProps, Stations, Train } from "./types";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN ?? "";

type Station = Feature<Point, StationProps>;
type Area = Feature<MultiPolygon, AreaProps>;
type Expr = mapboxgl.ExpressionSpecification;
const NYC: [number, number] = [-73.94, 40.72];
const REALTIME_MS = 30_000;

/** Line width by zoom. `focused` widens the hovered/selected route so it reads as raised. */
const lineWidth = (focused: Expr | boolean = false): Expr => {
  const w = (normal: number, raised: number): Expr | number =>
    focused === false ? normal : ["case", focused as Expr, raised, normal];
  return ["interpolate", ["linear"], ["zoom"], 9, w(2, 3.5), 12, w(2.5, 4), 14, w(4, 6), 17, w(8, 11)] as Expr;
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
const TRANSIT_LAYERS = ["lines", "lines-hit", "stations", "station-labels", "trains", "train-labels", "ambient-trains", "selected"];

/**
 * Which layers are switched on, remembered between visits. Both start on.
 * (The key is versioned: bumping it resets everyone to the current defaults.)
 */
const LAYERS_KEY = "standclear.layers.v2";
const DEFAULT_LAYERS = { transit: true, areas: true, boroughs: false };
const loadLayerPrefs = (): { transit: boolean; areas: boolean; boroughs: boolean } => {
  try { return { ...DEFAULT_LAYERS, ...JSON.parse(localStorage.getItem(LAYERS_KEY) ?? "{}") }; }
  catch { return DEFAULT_LAYERS; }
};

const BOROUGHS = ["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"];

/** Camera speed for flying to a stop or a neighbourhood (Mapbox flyTo `speed`; lower is slower). */
const STOP_FLY_SPEED = 0.9;
const HIGHLIGHT_KEY = "standclear.highlightBoroughs";

/** Map padding that keeps framed things clear of the side panel (or the bottom sheet on phones). */
const panelPadding = () =>
  window.innerWidth <= 600
    ? { top: 70, right: 30, left: 30, bottom: window.innerHeight * 0.55 + 20 }
    : { top: 70, right: 60, bottom: 90, left: 400 };

/** The basemap's first text layer; our lines go under it so place names stay on top. */
const firstLabelLayer = (m: mapboxgl.Map) => m.getStyle()?.layers?.find((l) => l.type === "symbol")?.id;

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
  const [showAreas, setShowAreas] = useState(() => loadLayerPrefs().areas);
  const [showBoroughs, setShowBoroughs] = useState(() => loadLayerPrefs().boroughs);
  const [areas, setAreas] = useState<Areas | null>(null);
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  /** Hovered neighbourhood, plus the sub-neighbourhood under the cursor if any (e.g. "Yorkville") */
  const [areaHover, setAreaHover] = useState<{ id: string; sub?: string; x: number; y: number } | null>(null);
  useEffect(() => {
    try { localStorage.setItem(LAYERS_KEY, JSON.stringify({ transit: showTransit, areas: showAreas, boroughs: showBoroughs })); } catch { /* storage unavailable */ }
  }, [showTransit, showAreas, showBoroughs]);

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
    setSelectedAreaId((current) => (toggle && current === id ? null : id));
  };
  const selectAreaRef = useRef(selectArea);
  selectAreaRef.current = selectArea;

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

  // Esc backs out one step at a time: the selected stop, then the neighbourhood, then the focused line.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (selected) setSelected(null);
      else if (selectedAreaId) setSelectedAreaId(null);
      else if (lineFilter) setLineFilter("");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, selectedAreaId, lineFilter]);

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

    const m = new mapboxgl.Map({
      container: mapEl.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: NYC,
      zoom: 10.6,
      minZoom: 9,
      maxBounds: [[-74.6, 40.35], [-73.4, 41.1]],
    });
    map.current = m;
    let stopAmbient = () => {};
    m.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");

    m.on("load", async () => {
      try {
        const [lines, stationsData, routesData] = await fetchStatic();
        if (lines.features.length && typeof lines.features[0].properties?.slot !== "number") {
          setError("Line data is out of date. Run `npm run build:data` in /server, then reload.");
        }
        setStations(stationsData);
        setRoutes(routesData);
        addLayers(m, lines, stationsData);
        // Above station dots (so a waiting train isn't hidden), below station names.
        stopAmbient = startAmbientTrains(m, lines, { laneSpacing: LANE_SPACING, beforeId: "station-labels" });
      } catch (e) {
        setError((e as Error).message);
        return;
      }
      // Neighbourhoods are optional: if the build couldn't download them, the toggle just stays off.
      try {
        const areaData = await fetchAreas();
        if (areaData.features.length && !areaData.features[0].properties?.kind) {
          setError("Neighborhood data is out of date. Run `npm run build:data` in /server, then reload.");
          return;
        }
        addAreaLayers(m, areaData, "lines", "stations");
        setAreas(areaData);
      } catch (e) {
        console.warn("neighborhoods unavailable", e);
      }
    });

    // ---- Neighbourhood hover + click (transit, when shown, wins) ----------
    const overTransit = (point: mapboxgl.Point) =>
      m.queryRenderedFeatures(point, { layers: ["stations", "lines-hit"].filter((l) => m.getLayer(l)) }).length > 0;
    let hoveredArea: string | null = null;
    const setAreaHoverState = (id: string | null) => {
      if (hoveredArea === id) return;
      if (hoveredArea) m.setFeatureState({ source: "areas", id: hoveredArea }, { hover: false });
      if (id) m.setFeatureState({ source: "areas", id }, { hover: true });
      hoveredArea = id;
    };
    m.on("mousemove", "areas-fill", (e) => {
      const id = e.features?.[0]?.properties?.id as string | undefined;
      if (!id || overTransit(e.point)) { setAreaHoverState(null); setAreaHover(null); return; }
      setAreaHoverState(id);
      m.getCanvas().style.cursor = "pointer";
      const sub = m.queryRenderedFeatures(e.point, { layers: ["areas-sub-hit"] })[0]?.properties?.name as string | undefined;
      setAreaHover({ id, sub, x: e.point.x, y: e.point.y });
    });
    m.on("mouseleave", "areas-fill", () => {
      setAreaHoverState(null);
      setAreaHover(null);
      m.getCanvas().style.cursor = "";
    });
    m.on("click", "areas-fill", (e) => {
      if (overTransit(e.point)) return;
      const id = e.features?.[0]?.properties?.id as string | undefined;
      if (id) selectAreaRef.current(id);
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
      if (!borough || overTransit(e.point) || neighborhoodsShowing()) { clearBoroughHover(); return; }
      if (borough !== hoveredBorough) { setBoroughHover(m, borough); hoveredBorough = borough; }
      m.getCanvas().style.cursor = "pointer";
      setBoroughHoverCard({ name: borough, x: e.point.x, y: e.point.y });
    });
    m.on("mouseleave", "boroughs-fill", () => {
      clearBoroughHover();
      m.getCanvas().style.cursor = "";
    });
    m.on("click", "boroughs-fill", (e) => {
      if (overTransit(e.point) || neighborhoodsShowing()) return;
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
      if (m.queryRenderedFeatures(e.point, { layers: ["stations"] }).length) return;
      const routeId = e.features?.[0]?.properties?.routeId as string | undefined;
      if (routeId) setLineFilter((current) => (current === routeId ? "" : routeId));
    });

    return () => { stopAmbient(); m.remove(); map.current = null; };
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

  // Borough highlight: brighten those boroughs' neighbourhoods and, after a change, frame them.
  useEffect(() => {
    const m = map.current;
    if (!m || !areas) return;
    setBoroughHighlight(m, highlightBoroughs);
    if (!frameBoroughs.current) return;
    frameBoroughs.current = false;
    const bounds = highlightBoroughs.length ? boroughBounds(areas, highlightBoroughs) : null;
    if (bounds) m.fitBounds(bounds, { padding: panelPadding(), maxZoom: 13, duration: 800 });
  }, [highlightBoroughs, areas]);

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
    setSelectedAreaId(null); // so the panel opens on the stop, not a neighbourhood from earlier
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

  const takeMeSomewhere = (kind: RandomKind, boroughs: string[]) =>
    kind === "stop" ? rollStop(boroughs) : rollNeighborhood(boroughs);
  // Borough chips only make sense once stations carry borough data (from the neighbourhood build).
  const hasBoroughs = !!stations?.features.some((s) => s.properties.borough);


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
          <p className="sub">Every line, stop and train in NYC's subway. Poke around.</p>
        </header>

        {areas && <AreaSearch areas={areas.features as Area[]} onSelect={(id) => selectArea(id, false)} />}

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

        {selectedArea && (
          <AreaPanel
            area={selectedArea}
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
            <h2>{selected.properties.name}</h2>
            {selected.properties.neighborhood && (
              <p className="place">
                {selected.properties.subNeighborhood && `${selected.properties.subNeighborhood} · `}
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

      {areaHover && !hover && areasById.get(areaHover.id) && (() => {
        const a = areasById.get(areaHover.id)!.properties;
        const flip = areaHover.x > window.innerWidth - 300;
        return (
          <div className={`line-card area-hover${flip ? " flip" : ""}`} style={{ left: areaHover.x, top: areaHover.y }}>
            <div>
              <strong>{a.name}</strong>
              <span>
                {areaHover.sub ? `${areaHover.sub} · ` : ""}
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
        areasAvailable={!!areas}
        onTransit={setShowTransit}
        onAreas={setShowAreas}
        onBoroughs={setShowBoroughs}
      />

      <RandomPicker
        onPick={takeMeSomewhere}
        disabled={!stations}
        unavailable={areas ? [] : ["neighborhood"]}
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
          <h2>{route.longName || `${route.name} train`}</h2>
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

  // Put the subway lines under the basemap's first text layer, so neighbourhood,
  // borough and street names stay readable on top of them.
  const beforeLabels = firstLabelLayer(m);

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
      "circle-color": "#ffffff",
      "circle-stroke-color": "#111111",
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
    paint: { "text-color": "#e8e8e8", "text-halo-color": "#000", "text-halo-width": 1.2 },
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
      "circle-color": "rgba(255, 214, 0, 0.18)",
      "circle-stroke-color": "#FFD600",
      "circle-stroke-width": 3,
    },
  });
}
