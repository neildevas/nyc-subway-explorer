import type { FeatureCollection, LineString, MultiPolygon, Point } from "geojson";

export interface StationProps {
  id: string;
  name: string;
  routes: string[];
  /** Every route in the station's complex, including transfers (Times Sq: 1 2 3 7 N Q R W S) */
  allRoutes?: string[];
  /** Every station id in the complex, itself included */
  complexIds?: string[];
  /** e.g. "Brooklyn" (empty if neighbourhood data wasn't available at build time) */
  borough?: string;
  /** Neighbourhood name, e.g. "Upper East Side" */
  neighborhood?: string;
  /** Neighbourhood id, matching an id in neighborhoods.geojson */
  areaId?: string;
  /** Smaller named area inside the neighbourhood, e.g. "Yorkville" (often empty) */
  subNeighborhood?: string;
  /** Sub-neighbourhood id, matching an id in neighborhoods.geojson (often empty) */
  subAreaId?: string;
  colors: string[];
}
export type Stations = FeatureCollection<Point, StationProps>;
/** One route's station-to-station segment. `routes` is comma-wrapped (",B,"); `slot` is the side-by-side position. */
export type Lines = FeatureCollection<LineString, { key: string; routeId: string; color: string; routes: string; slot: number }>;

export interface RouteInfo {
  id: string;
  name: string;
  longName: string;
  color: string;
  textColor: string;
  /** Main line stops in order (north → south, or west → east) */
  stops?: string[];
  /** Branches off the main line, e.g. the A's Lefferts Blvd branch */
  branches?: { from: string | null; stops: string[] }[];
}
export type Routes = Record<string, RouteInfo>;

export interface Train {
  tripId: string;
  routeId: string;
  direction: "N" | "S" | null;
  stopId: string | null;
  status: "STOPPED_AT" | "INCOMING_AT" | "IN_TRANSIT_TO" | null;
  timestamp: number | null;
}

export interface Arrival {
  tripId: string;
  routeId: string;
  stopId: string;
  direction: "N" | "S";
  time: number;
}

/**
 * A neighbourhood, or a sub-neighbourhood inside one, from NYC Neighborhood
 * Boundaries (Chris Whong, CC BY-SA 4.0).
 */
export interface AreaProps {
  id: string;
  name: string;
  borough: string;
  /** "neighborhood" (Upper East Side) or "sub" (Yorkville, inside it) */
  kind: "neighborhood" | "sub";
  /** 0–4: map colour, chosen in the source data so neighbours never match */
  color: number;
  summary: string;
  wikipedia: string;
  /** e.g. ["UES"] */
  alternateNames: string[];
  /** Sub-neighbourhood names inside a neighbourhood */
  includes: string[];
  /** For a sub-neighbourhood, the id of the neighbourhood it's in */
  parent: string;
  /** Station ids inside the neighbourhood (or sub-neighbourhood) */
  stations: string[];
  /** Lines that stop inside it */
  routes: string[];
}
export type Areas = FeatureCollection<MultiPolygon, AreaProps>;

/** A property managed by NYC Parks (NYC Open Data, Parks Properties). */
export interface ParkProps {
  id: string;
  name: string;
  /** e.g. "Flagship Park", "Playground", "Garden" */
  type: string;
  subcategory: string;
  acres: number;
  borough: string;
  address: string;
  /** NYC Parks page */
  url: string;
  waterfront: boolean;
  areaId: string;
  neighborhood: string;
  subAreaId: string;
  subNeighborhood: string;
  /** Every neighbourhood the park passes through, main one first (older builds lack this) */
  areaIds?: string[];
  /** Every sub-neighbourhood it passes through */
  subAreaIds?: string[];
  /** [lon, lat] where the park's name goes */
  label: [number, number];
  /** Nearest subway stations: id and straight-line metres (0 = inside the park) */
  nearby: { id: string; m: number }[];
}
export type Parks = FeatureCollection<MultiPolygon, ParkProps>;

/** A farmers market (NYC Open Data, NYC Farmers Markets, from the Health Department). */
export interface MarketProps {
  id: string;
  name: string;
  address: string;
  borough: string;
  /** As written in the data, e.g. "Saturday" or "Wed & Sat" */
  daysText: string;
  /** Day numbers it runs (0 = Sunday); empty if the build couldn't read the text */
  days: number[];
  /** False for markets that only run some weeks ("1st and 3rd Monday"); older builds lack it */
  weekly?: boolean;
  hours: string;
  yearRound: boolean;
  /** ["MM-DD", "MM-DD"] (may wrap over New Year), or null if unknown */
  season: [string, string] | null;
  seasonText: string;
  ebt: boolean;
  healthBucks: boolean;
  /** Other features from the data, e.g. "Kids Activities" */
  features: string[];
  website: string;
  phone: string;
  /** Which yearly list this came from */
  year: number | null;
  /** First year this market appears in the city's list */
  since?: number | null;
  areaId: string;
  neighborhood: string;
  subAreaId: string;
  subNeighborhood: string;
  /** Nearest subway stations: id and straight-line metres */
  nearby: { id: string; m: number }[];
}
export type Markets = FeatureCollection<Point, MarketProps>;
