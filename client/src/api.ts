import type { Areas, Arrival, Lines, Parks, Routes, Stations, Train } from "./types";

async function get<T>(path: string): Promise<T> {
  // no-store: always fetch fresh, so rebuilt data and live trains are never served from browser cache
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `${path}: HTTP ${res.status}`);
  return res.json();
}

export const fetchStatic = () =>
  Promise.all([
    get<Lines>("/api/lines.geojson"),
    get<Stations>("/api/stations.geojson"),
    get<Routes>("/api/routes.json"),
  ]);

export const fetchRealtime = () => get<{ fetchedAt: number; trains: Train[]; errors: string[] }>("/api/realtime");

/** Arrivals for a station, or for every station in its complex. */
export const fetchArrivals = (stationIds: string[]) =>
  get<{ fetchedAt: number; arrivals: Arrival[] }>(`/api/arrivals/${stationIds.map(encodeURIComponent).join(",")}`);

/** Neighbourhood outlines. Optional: the app works without them if the build skipped them. */
export const fetchAreas = () => get<Areas>("/api/neighborhoods.geojson");

/** NYC Parks properties. Optional: the app works without them if the build skipped them. */
export const fetchParks = () => get<Parks>("/api/parks.geojson");
