/**
 * Decorative trains: a few small gray dots that roll slowly along random routes
 * and pause briefly at each station. Not based on live data. They just make the
 * map feel alive.
 *
 * Each train starts on a random station-to-station segment, follows its route
 * through a few stops (picking a random branch at junctions), then fades out
 * and respawns somewhere else.
 */
import type mapboxgl from "mapbox-gl";
import type { GeoJSONSource } from "mapbox-gl";
import type { Feature, FeatureCollection, Point } from "geojson";
import type { Lines } from "./types";
import { T } from "./theme";

type LonLat = [number, number];
type Expr = mapboxgl.ExpressionSpecification;

interface Segment {
  from: string;
  to: string;
  routeId: string;
  slot: number;
  coords: LonLat[];
  /** Cumulative distance (m) at each vertex */
  cum: number[];
  length: number;
}

interface Runner {
  seg: Segment;
  /** true = travelling from → to */
  forward: boolean;
  /** Distance travelled along the current segment (m) */
  dist: number;
  /** Seconds left waiting at the current station */
  dwell: number;
  hopsLeft: number;
  age: number;
}

export interface AmbientOptions {
  /** How many trains are on the map at once */
  count?: number;
  /** Speed in screen pixels per second (stays consistent across zoom levels) */
  pxPerSec?: number;
  /** Pause at each station, in seconds [min, max] */
  dwellS?: [number, number];
  /**
   * Lane spacing in px by zoom, as [zoom, px] stops. Must match the lines layer's
   * line-offset so each dot sits in its own route's lane on shared corridors.
   */
  laneSpacing: [number, number][];
  /** Insert the layer before this layer id (e.g. the basemap's first label layer) */
  beforeId?: string;
}

const SOURCE = "ambient";
const LAYER = "ambient-trains";
const KX = 111_320 * Math.cos((40.7 * Math.PI) / 180);
const KY = 110_540;
const FADE_S = 0.8;

export function startAmbientTrains(m: mapboxgl.Map, lines: Lines, opts: AmbientOptions): () => void {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return () => {};
  const { count = 15, pxPerSec = 11, dwellS = [0.4, 0.9], laneSpacing } = opts;

  // ---- Index segments by route + station so trains can follow a route ----
  const segments: Segment[] = [];
  const atStation = new Map<string, Segment[]>();
  for (const f of lines.features) {
    const [from, to] = f.properties.key.split("|");
    const coords = f.geometry.coordinates as LonLat[];
    if (coords.length < 2) continue;
    const cum = [0];
    for (let i = 1; i < coords.length; i++) {
      cum.push(cum[i - 1] + Math.hypot((coords[i][0] - coords[i - 1][0]) * KX, (coords[i][1] - coords[i - 1][1]) * KY));
    }
    const seg: Segment = { from, to, coords, cum, routeId: f.properties.routeId, slot: f.properties.slot, length: cum[cum.length - 1] };
    if (seg.length < 1) continue;
    segments.push(seg);
    for (const station of [from, to]) {
      const k = `${seg.routeId}|${station}`;
      atStation.set(k, [...(atStation.get(k) ?? []), seg]);
    }
  }
  if (!segments.length) return () => {};

  // ---- Layer: a small, quiet gray dot -------------------------------------
  const empty: FeatureCollection = { type: "FeatureCollection", features: [] };
  m.addSource(SOURCE, { type: "geojson", data: empty });
  m.addLayer({
    id: LAYER,
    type: "circle",
    source: SOURCE,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 2, 12, 2.5, 14, 3.5, 17, 5],
      "circle-color": T.ambient,
      "circle-stroke-color": T.halo,
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 9, 0.5, 14, 1],
      "circle-opacity": ["*", ["get", "alpha"], 0.9],
      "circle-stroke-opacity": ["*", ["get", "alpha"], 0.9],
      "circle-pitch-alignment": "map",
    },
  }, opts.beforeId);

  // ---- Trains -------------------------------------------------------------
  const rand = (n: number) => Math.floor(Math.random() * n);
  const randDwell = () => dwellS[0] + Math.random() * (dwellS[1] - dwellS[0]);
  const spawn = (): Runner => {
    const seg = segments[rand(segments.length)];
    return { seg, forward: Math.random() < 0.5, dist: Math.random() * seg.length * 0.6, dwell: 0, hopsLeft: 2 + rand(5), age: 0 };
  };
  // Stagger the first ones so they don't all appear together.
  let runners = Array.from({ length: count }, () => ({ ...spawn(), age: -Math.random() * 5 }));

  const metresPerPixel = () => (78_271.517 * Math.cos((40.7 * Math.PI) / 180)) / 2 ** m.getZoom();

  /** Lane spacing in px at the current zoom, interpolated like the lines' line-offset. */
  const spacingPx = () => {
    const z = m.getZoom();
    if (z <= laneSpacing[0][0]) return laneSpacing[0][1];
    for (let i = 1; i < laneSpacing.length; i++) {
      const [z1, v1] = laneSpacing[i];
      const [z0, v0] = laneSpacing[i - 1];
      if (z <= z1) return v0 + ((z - z0) / (z1 - z0)) * (v1 - v0);
    }
    return laneSpacing[laneSpacing.length - 1][1];
  };

  /**
   * Point at distance d along the segment (in its own from → to direction), pushed
   * sideways into the route's lane. line-offset shifts to the right of the line's
   * direction, so we do the same: the right-hand normal of (dx, dy) is (dy, -dx).
   */
  const pointAt = (seg: Segment, d: number, offsetM: number): LonLat => {
    d = Math.max(0, Math.min(seg.length, d));
    let i = 1;
    while (i < seg.cum.length - 1 && seg.cum[i] < d) i++;
    const span = seg.cum[i] - seg.cum[i - 1] || 1;
    const t = (d - seg.cum[i - 1]) / span;
    const [a, b] = [seg.coords[i - 1], seg.coords[i]];
    const dx = (b[0] - a[0]) * KX, dy = (b[1] - a[1]) * KY;
    const len = Math.hypot(dx, dy) || 1;
    return [
      a[0] + (b[0] - a[0]) * t + ((dy / len) * offsetM) / KX,
      a[1] + (b[1] - a[1]) * t + ((-dx / len) * offsetM) / KY,
    ];
  };

  /** Move a train along, pausing briefly at each station before heading on. */
  const advance = (r: Runner, dt: number, metres: number): Runner => {
    if (r.dwell > 0) {
      r.dwell -= dt;
      if (r.dwell > 0) return r;
      if (r.hopsLeft <= 0) return spawn();
      const station = r.forward ? r.seg.to : r.seg.from;
      const next = (atStation.get(`${r.seg.routeId}|${station}`) ?? []).filter((s) => s !== r.seg);
      if (!next.length) return spawn(); // end of the line
      r.seg = next[rand(next.length)];
      r.forward = r.seg.from === station;
      r.dist = 0;
      r.hopsLeft--;
      return r;
    }
    r.dist += metres;
    if (r.dist >= r.seg.length) {
      r.dist = r.seg.length; // pull into the station
      // The last stop gets a longer wait so the dot has time to fade out.
      r.dwell = r.hopsLeft <= 0 ? FADE_S : randDwell();
    }
    return r;
  };

  let frame = 0;
  let last = performance.now();

  const tick = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000); // clamp so a background tab doesn't teleport everything
    last = now;
    const mpp = metresPerPixel();
    const lane = spacingPx() * mpp;

    const features: Feature<Point>[] = [];
    runners = runners.map((r) => {
      r.age += dt;
      if (r.age <= 0) return r; // still waiting to start
      const moved = advance(r, dt, pxPerSec * mpp * dt);
      if (moved !== r) return moved;

      // Fade in when spawned; fade out while waiting at the last stop.
      let alpha = Math.min(1, r.age / FADE_S);
      if (r.hopsLeft <= 0 && r.dwell > 0) alpha = Math.min(alpha, r.dwell / FADE_S);

      const along = r.forward ? r.dist : r.seg.length - r.dist;
      features.push({
        type: "Feature",
        properties: { routeId: r.seg.routeId, alpha },
        geometry: { type: "Point", coordinates: pointAt(r.seg, along, r.seg.slot * lane) },
      });
      return r;
    });

    (m.getSource(SOURCE) as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features });
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => cancelAnimationFrame(frame);
}

/** Dim trains on other lines when a route is focused, matching the lines layer. */
export function setAmbientFocus(m: mapboxgl.Map, routeId: string) {
  if (!m.getLayer(LAYER)) return;
  const focus: Expr | number = routeId ? ["case", ["==", ["get", "routeId"], routeId], 1, 0.15] : 1;
  m.setPaintProperty(LAYER, "circle-opacity", ["*", ["get", "alpha"], 0.9, focus]);
  m.setPaintProperty(LAYER, "circle-stroke-opacity", ["*", ["get", "alpha"], 0.6, focus]);
}
