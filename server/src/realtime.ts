/**
 * Fetches and decodes the MTA subway GTFS-Realtime feeds (protobuf, no API key needed).
 * The browser can't easily read these directly (binary protobuf + CORS), which is
 * why this small server exists.
 */
import GtfsRealtimeBindings from "gtfs-realtime-bindings";

const { transit_realtime } = GtfsRealtimeBindings;
const BASE = "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs";

export const FEEDS = ["", "-ace", "-bdfm", "-g", "-jz", "-nqrw", "-l", "-si"].map((suffix) => BASE + suffix);

export interface Train {
  tripId: string;
  routeId: string;
  direction: "N" | "S" | null;
  /** Platform stop id the train is at or approaching, e.g. "127N" */
  stopId: string | null;
  status: "STOPPED_AT" | "INCOMING_AT" | "IN_TRANSIT_TO" | null;
  timestamp: number | null;
}

export interface Arrival {
  tripId: string;
  routeId: string;
  stopId: string; // platform id
  time: number;   // unix seconds
}

export interface Snapshot {
  fetchedAt: number;
  trains: Train[];
  arrivals: Arrival[];
  errors: string[];
}

const STATUS = ["INCOMING_AT", "STOPPED_AT", "IN_TRANSIT_TO"] as const;
const num = (v: unknown) => (v == null ? null : Number(v));

async function fetchFeed(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  return transit_realtime.FeedMessage.decode(buf);
}

export async function fetchSnapshot(): Promise<Snapshot> {
  const results = await Promise.allSettled(FEEDS.map(fetchFeed));
  const trains: Train[] = [];
  const arrivals: Arrival[] = [];
  const errors: string[] = [];
  const now = Date.now() / 1000;

  for (const r of results) {
    if (r.status === "rejected") { errors.push(String(r.reason?.message ?? r.reason)); continue; }
    for (const entity of r.value.entity) {
      const v = entity.vehicle;
      if (v?.trip?.tripId && v.trip.routeId) {
        const stopId = v.stopId ?? null;
        trains.push({
          tripId: v.trip.tripId,
          routeId: v.trip.routeId,
          direction: stopId?.endsWith("N") ? "N" : stopId?.endsWith("S") ? "S" : null,
          stopId,
          status: v.currentStatus != null ? STATUS[v.currentStatus] ?? null : "IN_TRANSIT_TO",
          timestamp: num(v.timestamp),
        });
      }
      const tu = entity.tripUpdate;
      if (tu?.trip?.tripId && tu.trip.routeId) {
        for (const stu of tu.stopTimeUpdate ?? []) {
          const t = num(stu.arrival?.time ?? stu.departure?.time);
          if (!stu.stopId || t == null || t < now - 30) continue;
          arrivals.push({ tripId: tu.trip.tripId, routeId: tu.trip.routeId, stopId: stu.stopId, time: t });
        }
      }
    }
  }
  return { fetchedAt: Math.floor(now), trains, arrivals, errors };
}
