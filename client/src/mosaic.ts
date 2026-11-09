/**
 * Mosaic theme: place names drawn as little tiled name tablets, like the ones set into
 * the walls of the old IRT stations ("28TH STREET", "DOWN·TOWN·TRAINS").
 *
 * Mapbox can only draw text in fonts hosted with the map style, so the names can't use
 * our web font directly. Instead each tablet is painted on a canvas (in Cinzel, with a
 * tile grid and a tiled border) and handed to the map as an image. Images are made on
 * demand, the first time the map needs one (`styleimagemissing`), so only names that
 * actually come into view are ever drawn.
 */
import type mapboxgl from "mapbox-gl";

type Expr = mapboxgl.ExpressionSpecification;

/** The tile colours, sampled from the station mosaics */
export const TILE = {
  cobalt: "#2c4596",
  celadon: "#6fae8f",
  terracotta: "#b65a44",
  ochre: "#d9b45a",
  tan: "#dcc794",
  umber: "#6e4a30",
  cream: "#f6f2e8",
};

/** The fill of a neighbourhood's tablet follows its area colour (0–4), so the patchwork carries over. */
const AREA_FIELDS = [TILE.cobalt, "#3f7f68", TILE.terracotta, "#8c6a2e", "#5b4a8a"];

export type PlaqueKind = "station" | "area" | "borough";
const PREFIX = "plaque:";

/** Image id for a name tablet, as a map expression. */
export const plaqueImage = (kind: PlaqueKind): Expr =>
  kind === "area"
    ? ["concat", PREFIX, "area:", ["to-string", ["get", "color"]], ":", ["get", "name"]]
    : kind === "borough"
      ? ["concat", PREFIX, "borough:0:", ["get", "borough"]]
      : ["concat", PREFIX, "station:0:", ["get", "name"]];

const ABBREVIATIONS: [RegExp, string][] = [
  [/\bSt\b/g, "Street"], [/\bAv\b|\bAve\b/g, "Avenue"], [/\bSq\b/g, "Square"], [/\bBlvd\b/g, "Boulevard"],
  [/\bPkwy\b/g, "Parkway"], [/\bHts\b/g, "Heights"], [/\bPl\b/g, "Place"], [/\bRd\b/g, "Road"],
  [/\bSts\b/g, "Streets"], [/\bCtr\b/g, "Center"], [/\bJct\b/g, "Junction"],
];
const ordinal = (n: number) => (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th");

/**
 * A station name the way the mosaics spell it: abbreviations written out, numbered
 * streets with a raised ordinal ("28" + "TH" + " STREET"), and dashes as centre dots.
 * Returns runs of text, each flagged if it's a raised ordinal.
 */
export function mosaicName(name: string): { text: string; sup: boolean }[] {
  let s = name;
  for (const [re, full] of ABBREVIATIONS) s = s.replace(re, full);
  s = s.replace(/\s*-\s*/g, " · ").toUpperCase();
  const runs: { text: string; sup: boolean }[] = [];
  let last = 0;
  // Numbered streets and avenues get a raised ordinal: 28 STREET → 28ᵀᴴ STREET.
  for (const m of s.matchAll(/\b(\d+)(?=\s+(STREET|AVENUE|PLACE|ROAD|DRIVE|TERRACE)\b)/g)) {
    const end = m.index! + m[1].length;
    runs.push({ text: s.slice(last, end), sup: false }, { text: ordinal(Number(m[1])).toUpperCase(), sup: true });
    last = end;
  }
  runs.push({ text: s.slice(last), sup: false });
  return runs.filter((r) => r.text);
}

/** Small seeded random numbers, so a name's tiles look the same every time. */
function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/** Nudge a hex colour lighter/darker by `amt` (-1..1), for tile-to-tile variation. */
function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v + amt * 255)));
  return `rgb(${ch(n >> 16)}, ${ch((n >> 8) & 255)}, ${ch(n & 255)})`;
}

/** Fill a rectangle with small square tiles, each a slightly different shade. */
function tiles(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, size: number, rand: () => number, vary = 0.07) {
  for (let ty = y; ty < y + h; ty += size) {
    for (let tx = x; tx < x + w; tx += size) {
      ctx.fillStyle = shade(color, (rand() - 0.5) * vary * 2);
      ctx.fillRect(tx, ty, Math.min(size, x + w - tx), Math.min(size, y + h - ty));
    }
  }
}

/**
 * Paint one tablet: a tiled field, white letters, a tan tile border and an umber outline,
 * then grout lines over everything so even the letters look laid in tile.
 */
export function drawPlaque(kind: PlaqueKind, colorIndex: number, text: string, pixelRatio = 2): ImageData {
  const r = pixelRatio;
  const size = { station: 12, area: 11, borough: 18 }[kind] * r; // font px
  const tile = (kind === "borough" ? 3.5 : 2.5) * r; // tile size
  const border = (kind === "borough" ? 3 : 2) * tile; // tan band
  const padX = size * 0.7, padY = size * 0.42;
  const field = kind === "area" ? AREA_FIELDS[colorIndex] ?? TILE.cobalt : TILE.cobalt;
  const runs = kind === "station" ? mosaicName(text) : [{ text: text.toUpperCase().replace(/\s*-\s*/g, " · "), sup: false }];
  const label = runs.map((r) => r.text).join("");

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const font = `600 ${size}px Cinzel, "Trajan Pro", Georgia, serif`;
  const supFont = `700 ${Math.round(size * 0.55)}px Cinzel, "Trajan Pro", Georgia, serif`;
  const spacing = size * 0.06;
  // Width of every character as it'll be drawn (raised ordinals are smaller).
  const advance = (ch: string, sup: boolean) => { ctx.font = sup ? supFont : font; return ctx.measureText(ch).width + spacing; };
  const textW = Math.ceil(runs.reduce((sum, r) => sum + [...r.text].reduce((a, ch) => a + advance(ch, r.sup), 0), 0));
  const w = Math.ceil(textW + padX * 2 + border * 2 + 2 * r);
  const h = Math.ceil(size + padY * 2 + border * 2 + 2 * r);
  canvas.width = w;
  canvas.height = h;
  const rand = rng(kind + label);

  // Outline, tan border band, then the field.
  ctx.fillStyle = TILE.umber;
  ctx.fillRect(0, 0, w, h);
  tiles(ctx, r, r, w - 2 * r, h - 2 * r, TILE.tan, tile, rand, 0.08);
  // A thin inner line of darker tiles, like the brown rows framing the 28th St tablet.
  ctx.fillStyle = shade(TILE.umber, 0.1);
  ctx.fillRect(r + border - r, r + border - r, w - 2 * (r + border) + 2 * r, h - 2 * (r + border) + 2 * r);
  tiles(ctx, r + border, r + border, w - 2 * (r + border), h - 2 * (r + border), field, tile, rand, 0.09);

  // Letters (Cinzel is all capitals, like the mosaics), with a little tracking.
  ctx.fillStyle = TILE.cream;
  ctx.textBaseline = "middle";
  let x = r + border + padX;
  const y = h / 2 + size * 0.04;
  for (const run of runs) {
    for (const ch of run.text) {
      ctx.font = run.sup ? supFont : font;
      ctx.fillText(ch, x, run.sup ? y - size * 0.22 : y);
      x += ctx.measureText(ch).width + spacing;
    }
  }

  // Grout: thin dark lines on the tile grid, over the letters too.
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = "#1c1a17";
  for (let gx = r; gx < w; gx += tile) ctx.fillRect(Math.round(gx), 0, Math.max(1, r * 0.4), h);
  for (let gy = r; gy < h; gy += tile) ctx.fillRect(0, Math.round(gy), w, Math.max(1, r * 0.4));
  ctx.globalAlpha = 1;

  return ctx.getImageData(0, 0, w, h);
}

/** Draw tablets on demand whenever the map asks for one it doesn't have. Call once per map. */
export function installPlaques(m: mapboxgl.Map) {
  m.on("styleimagemissing", (e: { id: string }) => {
    if (!e.id.startsWith(PREFIX) || m.hasImage(e.id)) return;
    const [kind, color, ...rest] = e.id.slice(PREFIX.length).split(":");
    const img = drawPlaque(kind as PlaqueKind, Number(color) || 0, rest.join(":"));
    m.addImage(e.id, img, { pixelRatio: 2 });
  });
}

/** Load the tablet font before any tablet is drawn (a canvas won't wait for it). */
export const plaqueFontReady = () =>
  Promise.all([document.fonts.load('600 24px "Cinzel"'), document.fonts.load('600 36px "Cinzel"')]).then(() => undefined, () => undefined);

// ---- Swapping text labels for tablets ------------------------------------------
/** Each label layer's own filter, kept so it can be restored. */
const baseFilters = new Map<string, unknown>();
const NOTHING: Expr = ["==", 1, 0];

/** Show a layer (with its own filter) or hide it with a filter, leaving its visibility to the layer toggles. */
function shown(m: mapboxgl.Map, id: string, on: boolean) {
  if (!m.getLayer(id)) return;
  if (!baseFilters.has(id)) baseFilters.set(id, m.getFilter(id) ?? null);
  m.setFilter(id, on ? (baseFilters.get(id) as Expr | null) : NOTHING);
}

/** Pairs of [text label layer, tablet layer] */
const SWAPS: [string, string][] = [
  ["station-labels", "station-plaques"],
  ["areas-labels", "areas-plaques"],
  ["boroughs-labels", "boroughs-plaques"],
];

/** Use tablets instead of text for station, neighbourhood and borough names (or switch back). */
export function setPlaques(m: mapboxgl.Map, on: boolean) {
  for (const [text, plaque] of SWAPS) {
    shown(m, text, !on);
    shown(m, plaque, on);
  }
}

/**
 * Add the tablet layers (hidden until setPlaques turns them on). Each one shares its
 * text layer's source, zoom range and toggle.
 */
export function addPlaqueLayers(m: mapboxgl.Map) {
  const common = { "icon-allow-overlap": false, "icon-padding": 2 } as const;
  if (m.getLayer("station-labels") && !m.getLayer("station-plaques")) {
    m.addLayer({
      id: "station-plaques",
      type: "symbol",
      source: "stations",
      minzoom: 13,
      filter: NOTHING,
      layout: {
        ...common,
        "icon-image": plaqueImage("station"),
        "icon-anchor": "top",
        "icon-offset": [0, 14],
        "icon-size": ["interpolate", ["linear"], ["zoom"], 13, 0.8, 16, 1],
      },
    }, "station-labels");
  }
  if (m.getLayer("areas-labels") && !m.getLayer("areas-plaques")) {
    m.addLayer({
      id: "areas-plaques",
      type: "symbol",
      source: "areas",
      minzoom: 10.5,
      filter: NOTHING,
      layout: {
        ...common,
        visibility: m.getLayoutProperty("areas-labels", "visibility") ?? "visible",
        "icon-image": plaqueImage("area"),
        "icon-size": ["interpolate", ["linear"], ["zoom"], 10.5, 0.6, 13, 0.85, 15, 1],
      },
    }, "areas-labels");
    baseFilters.set("areas-plaques", ["==", ["get", "kind"], "neighborhood"]);
  }
  if (m.getLayer("boroughs-labels") && !m.getLayer("boroughs-plaques")) {
    m.addLayer({
      id: "boroughs-plaques",
      type: "symbol",
      source: "borough-labels",
      filter: NOTHING,
      layout: {
        ...common,
        visibility: m.getLayoutProperty("boroughs-labels", "visibility") ?? "visible",
        "icon-image": plaqueImage("borough"),
        "icon-allow-overlap": true,
        "icon-size": ["interpolate", ["linear"], ["zoom"], 9, 0.6, 11, 0.85, 14, 1.1],
      },
    }, "boroughs-labels");
  }
  baseFilters.set("station-plaques", null);
  baseFilters.set("boroughs-plaques", null);
}
