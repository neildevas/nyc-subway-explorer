/**
 * Downloads the MTA static subway GTFS (and NYC neighbourhood boundaries) and turns
 * them into small files the client can load directly:
 *   data/lines.geojson         – station-to-station segments per route, with slots for parallel lines
 *   data/stations.geojson      – one Point per station, with routes, transfers and neighbourhood
 *   data/routes.json           – route colours, names and ordered stop lists
 *   data/neighborhoods.geojson – neighbourhood + sub-neighbourhood outlines (CC BY-SA 4.0, see README)
 *   data/parks.geojson         – NYC Parks properties, with neighbourhood and nearest stops
 *
 * Run: npm run build:data   (re-run when the MTA publishes a new quarterly schedule)
 */
import AdmZip from "adm-zip";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseCsv } from "../src/csv.js";
import { buildSegments, type LonLat, type Pattern } from "../src/segments.js";
import { buildRouteStops } from "../src/route-stops.js";
import { loadNeighborhoods, NEIGHBORHOODS_SOURCE } from "../src/neighborhoods.js";
import { buildParks, PARKS_SOURCE } from "../src/parks.js";

const GTFS_URLS = [
  "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip",
  "http://web.mta.info/developers/data/nyct/subway/google_transit.zip",
];
const OUT_DIR = join(import.meta.dirname, "..", "data");

async function download(): Promise<Buffer> {
  for (const url of GTFS_URLS) {
    try {
      console.log(`Downloading ${url} …`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      console.warn(`  failed: ${(err as Error).message}`);
    }
  }
  throw new Error("Could not download the subway GTFS from any source.");
}

function readTable(zip: AdmZip, name: string) {
  const entry = zip.getEntry(name);
  if (!entry) throw new Error(`${name} missing from GTFS zip`);
  return parseCsv(entry.getData().toString("utf8"));
}

async function main() {
  const zip = new AdmZip(await download());
  const areas = await loadNeighborhoods();

  const routes = readTable(zip, "routes.txt");
  const trips = readTable(zip, "trips.txt");
  const stops = readTable(zip, "stops.txt");
  const shapes = readTable(zip, "shapes.txt");
  const stopTimes = readTable(zip, "stop_times.txt");

  const routeInfo = new Map(
    routes.map((r) => [
      r.route_id,
      {
        id: r.route_id,
        name: r.route_short_name || r.route_id,
        longName: r.route_long_name,
        color: `#${r.route_color || "808183"}`,
        textColor: `#${r.route_text_color || "FFFFFF"}`,
      },
    ]),
  );

  // Express variants ("6X", "7X", "FX") are the same line on the map: fold them into the base route.
  const baseRoute = (r: string) => (/^[0-9A-Z]X$/.test(r) && routeInfo.has(r[0]) ? r[0] : r);

  const tripToRoute = new Map<string, string>();
  const tripToShape = new Map<string, string>();
  for (const t of trips) {
    tripToRoute.set(t.trip_id, baseRoute(t.route_id));
    if (t.shape_id) tripToShape.set(t.trip_id, t.shape_id);
  }

  // Platforms ("127N") roll up to their parent station ("127").
  const parentOf = new Map<string, string>();
  for (const s of stops) if (s.parent_station) parentOf.set(s.stop_id, s.parent_station);

  // One pass over stop_times: which routes serve each station, and each trip's stop sequence.
  const routesAtStation = new Map<string, Set<string>>();
  const tripStops = new Map<string, { seq: number; station: string; time: string }[]>();
  for (const st of stopTimes) {
    const station = parentOf.get(st.stop_id) ?? st.stop_id;
    const route = tripToRoute.get(st.trip_id);
    if (!route) continue;
    const set = routesAtStation.get(station) ?? new Set();
    set.add(route);
    routesAtStation.set(station, set);
    const list = tripStops.get(st.trip_id) ?? [];
    list.push({ seq: Number(st.stop_sequence), station, time: st.departure_time || st.arrival_time });
    tripStops.set(st.trip_id, list);
  }

  // ---- Lines -------------------------------------------------------------
  const shapePoints = new Map<string, { seq: number; lon: number; lat: number }[]>();
  for (const s of shapes) {
    const list = shapePoints.get(s.shape_id) ?? [];
    list.push({ seq: Number(s.shape_pt_sequence), lon: Number(s.shape_pt_lon), lat: Number(s.shape_pt_lat) });
    shapePoints.set(s.shape_id, list);
  }
  for (const pts of shapePoints.values()) pts.sort((a, b) => a.seq - b.seq);

  // Unique stopping patterns (route + stop list), each with the shape it runs along,
  // and how many daytime trips use it.
  const patterns = new Map<string, Pattern & { dayTrips: number }>();
  for (const [tripId, list] of tripStops) {
    const routeId = tripToRoute.get(tripId)!;
    const shapeId = tripToShape.get(tripId);
    const shape = shapeId && shapePoints.get(shapeId);
    const info = routeInfo.get(routeId);
    if (!shape || !info) continue;
    list.sort((a, b) => a.seq - b.seq);
    const stopIds = list.map((s) => s.station);
    const key = `${routeId}:${stopIds.join(">")}`;
    const hour = Number(list[0].time.split(":")[0]);
    const daytime = hour >= 6 && hour < 21 ? 1 : 0;
    const existing = patterns.get(key);
    if (existing) { existing.dayTrips += daytime; continue; }
    patterns.set(key, { routeId, color: info.color, stops: stopIds, coords: shape.map((p) => [p.lon, p.lat]), dayTrips: daytime });
  }

  // Draw what runs in the daytime, like the official map: skip late-night-only routings
  // (e.g. the A running local on Central Park West) and one-off trips. Routes that never
  // run in the daytime keep all their patterns so they still appear.
  const daytimeRoutes = new Set([...patterns.values()].filter((p) => p.dayTrips >= 2).map((p) => p.routeId));
  const drawn = [...patterns.values()].filter((p) => p.dayTrips >= 2 || !daytimeRoutes.has(p.routeId));

  const stationCoords = new Map<string, LonLat>(
    stops
      .filter((s) => s.location_type === "1" && routesAtStation.has(s.stop_id))
      .map((s) => [s.stop_id, [Number(s.stop_lon), Number(s.stop_lat)]]),
  );

  // Official route order (1, 2, 3 … A, B, C …), so each route keeps a
  // consistent side wherever corridors are shared.
  const routeOrder = [...routeInfo.keys()].sort(routeSort);
  const lines = buildSegments(drawn, stationCoords, routeOrder);
  const shared = lines.features.filter((f) => f.properties.slot !== 0).length;
  console.log(`${drawn.length} of ${patterns.size} stopping patterns drawn → ${lines.features.length} line segments (${shared} side by side)`);
  // Sanity checks on corridors everyone knows.
  for (const [label, station] of [["81 St (Central Park West)", "A21"], ["86 St (Lexington Ave)", "626"], ["72 St (Broadway)", "123"]]) {
    const segs = lines.features.filter((f) => f.properties.key.split("|").includes(station)).map((f) => `${f.properties.routeId}@${f.properties.slot}`);
    console.log(`  ${label}: ${segs.join("  ") || "none found"}`);
  }

  // ---- Stop lists per route (side panel) ----------------------------------
  const routeStops = buildRouteStops(drawn, stationCoords);

  // ---- Station complexes ---------------------------------------------------
  // Big transfer hubs are several GTFS stations (Times Sq = 127 + 725 + 902 + R16)
  // joined by in-station transfers. Union them so each station knows every route
  // you can reach without leaving the system.
  const group = new Map<string, string>();
  const find = (x: string): string => {
    const p = group.get(x) ?? x;
    if (p === x) return x;
    const root = find(p);
    group.set(x, root);
    return root;
  };
  const transfers = zip.getEntry("transfers.txt") ? readTable(zip, "transfers.txt") : [];
  for (const t of transfers) {
    const a = find(parentOf.get(t.from_stop_id) ?? t.from_stop_id);
    const b = find(parentOf.get(t.to_stop_id) ?? t.to_stop_id);
    if (a !== b) group.set(a, b);
  }
  const complexRoutes = new Map<string, Set<string>>();
  const complexMembers = new Map<string, string[]>();
  for (const [station, set] of routesAtStation) {
    const root = find(station);
    const all = complexRoutes.get(root) ?? new Set();
    set.forEach((r) => all.add(r));
    complexRoutes.set(root, all);
    complexMembers.set(root, [...(complexMembers.get(root) ?? []), station]);
  }

  // ---- Stations ----------------------------------------------------------

  const stationFeatures = stops
    .filter((s) => s.location_type === "1")
    .map((s) => {
      const routeIds = [...(routesAtStation.get(s.stop_id) ?? [])].sort(routeSort);
      const allRoutes = [...(complexRoutes.get(find(s.stop_id)) ?? routeIds)].sort(routeSort);
      const point: [number, number] = [Number(s.stop_lon), Number(s.stop_lat)];
      const area = areas?.neighborhoodAt(point) ?? null;
      const sub = areas?.subNeighborhoodAt(point) ?? null;
      return {
        type: "Feature" as const,
        properties: {
          id: s.stop_id,
          name: s.stop_name,
          routes: routeIds,
          /** Every route in this station's complex, including transfers */
          allRoutes,
          /** Every station id in the complex (itself included), for combined arrivals */
          complexIds: complexMembers.get(find(s.stop_id)) ?? [s.stop_id],
          borough: area?.borough ?? "",
          neighborhood: area?.name ?? "",
          /** Neighbourhood id, matches an id in neighborhoods.geojson */
          areaId: area?.id ?? "",
          /** Smaller named area inside the neighbourhood, e.g. "Yorkville" (often empty) */
          subNeighborhood: sub?.name ?? "",
          /** Sub-neighbourhood id, matches an id in neighborhoods.geojson (often empty) */
          subAreaId: sub?.id ?? "",
          colors: routeIds.map((r) => routeInfo.get(r)?.color ?? "#808183"),
        },
        geometry: { type: "Point" as const, coordinates: [round(Number(s.stop_lon)), round(Number(s.stop_lat))] },
      };
    })
    .filter((f) => f.properties.routes.length > 0); // drop stations with no scheduled service

  mkdirSync(OUT_DIR, { recursive: true });
  writeJson("lines.geojson", lines);
  writeJson("stations.geojson", { type: "FeatureCollection", features: stationFeatures });
  writeJson(
    "routes.json",
    Object.fromEntries([...routeInfo].map(([id, info]) => [id, { ...info, ...routeStops[id] }])),
  );
  if (areas) {
    // Each neighbourhood with the stations inside it and the lines that stop there.
    const byArea = new Map<string, typeof stationFeatures>();
    for (const f of stationFeatures) {
      // Each station counts toward its neighbourhood and, if it's in one, its sub-neighbourhood.
      for (const id of [f.properties.areaId, f.properties.subAreaId]) {
        if (id) byArea.set(id, [...(byArea.get(id) ?? []), f]);
      }
    }
    const neighborhoods = areas.toGeoJson((id) => {
      const inside = byArea.get(id) ?? [];
      return {
        stations: inside.map((f) => f.properties.id),
        routes: [...new Set(inside.flatMap((f) => f.properties.routes))].sort(routeSort),
      };
    });
    writeJson("neighborhoods.geojson", neighborhoods);
    const kb = Math.round(JSON.stringify(neighborhoods).length / 1024);
    const { neighborhoods: n, subNeighborhoods: subN } = areas.counts;
    console.log(`  Wrote ${n} neighbourhoods + ${subN} sub-neighbourhoods (${kb} KB) from ${NEIGHBORHOODS_SOURCE} (CC BY-SA 4.0)`);
    const ues = stationFeatures.find((f) => f.properties.id === "626");
    console.log(`  86 St (Lexington) is in: ${[ues?.properties.subNeighborhood, ues?.properties.neighborhood].filter(Boolean).join(" · ") || "not found"}`);

    const missing = stationFeatures.filter((f) => !f.properties.neighborhood).map((f) => f.properties.name);
    const boroughs = new Set(stationFeatures.map((f) => f.properties.borough).filter(Boolean));
    console.log(`  Neighbourhoods: ${stationFeatures.length - missing.length}/${stationFeatures.length} stations tagged across ${boroughs.size} boroughs${missing.length ? ` (untagged: ${missing.slice(0, 5).join(", ")})` : ""}`);
  }
  // ---- Parks ---------------------------------------------------------------
  const parks = await buildParks(
    stationFeatures.map((f) => ({ id: f.properties.id, coords: f.geometry.coordinates as [number, number] })),
    areas?.neighborhoodAt,
    areas?.subNeighborhoodAt,
  );
  if (parks) {
    writeJson("parks.geojson", parks.geojson);
    const kb = Math.round(JSON.stringify(parks.geojson).length / 1024);
    const { total, kept, skipped, byType } = parks.summary;
    console.log(`  Wrote ${kept} of ${total} parks (${kb} KB) from ${PARKS_SOURCE}`);
    console.log(`    Kept: ${byType}`);
    console.log(`    Skipped: ${skipped || "none"}`);
    const cp = parks.geojson.features.find((f) => f.properties.name === "Central Park");
    console.log(`    Central Park: ${cp ? `${cp.properties.acres} acres, ${cp.properties.nearby.length} nearby stops, in ${cp.properties.neighborhood || "?"}` : "not found"}`);
    const rp = parks.geojson.features.find((f) => f.properties.name === "Riverside Park");
    console.log(`    Riverside Park passes through: ${rp ? rp.properties.areaIds.join(", ") : "not found"}`);
  }

  const ts = stationFeatures.find((f) => f.properties.id === "127");
  console.log(`  Times Sq (127) transfers: ${ts?.properties.allRoutes.join(" ") ?? "not found"}`);
  console.log(`Wrote ${lines.features.length} line segments and ${stationFeatures.length} stations to ${OUT_DIR}`);
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

function routeSort(a: string, b: string) {
  const an = /^\d/.test(a), bn = /^\d/.test(b);
  if (an !== bn) return an ? -1 : 1;
  return a.localeCompare(b, "en", { numeric: true });
}

function writeJson(file: string, data: unknown) {
  writeFileSync(join(OUT_DIR, file), JSON.stringify(data));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
