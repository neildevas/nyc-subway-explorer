import express, { type Request, type Response } from "express";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { gzipSync } from "node:zlib";
import { fetchSnapshot, type Snapshot } from "./realtime.js";

const PORT = Number(process.env.PORT ?? 8787);
const DATA_DIR = join(import.meta.dirname, "..", "data");
/** The built client (`npm run build` in /client). Served when present, i.e. in production. */
const CLIENT_DIR = join(import.meta.dirname, "..", "..", "client", "dist");
const CACHE_MS = 20_000; // MTA feeds refresh roughly every 30s

const app = express();
app.disable("x-powered-by");

// ---- Gzip ---------------------------------------------------------------------
// GeoJSON and the JS bundle shrink 5–8× gzipped. Done with Node's own zlib (no extra
// dependency), and each body is compressed once and kept, not on every request.
const acceptsGzip = (req: Request) => /\bgzip\b/.test(req.headers["accept-encoding"] ?? "");

interface Body { raw: Buffer; gz: Buffer }
const makeBody = (raw: Buffer): Body => ({ raw, gz: gzipSync(raw, { level: 9 }) });

function sendBody(req: Request, res: Response, body: Body, type: string) {
  res.type(type).vary("Accept-Encoding");
  if (acceptsGzip(req)) res.set("Content-Encoding", "gzip").send(body.gz);
  else res.send(body.raw);
}

// ---- Static network data (built by `npm run build:data`) -------------------
/** Compressed data files, re-read if the file changes (e.g. after a rebuild in dev). */
const dataCache = new Map<string, { mtime: number; body: Body }>();
function dataFile(file: string): Body | null {
  const path = join(DATA_DIR, file);
  if (!existsSync(path)) return null;
  const mtime = statSync(path).mtimeMs;
  const hit = dataCache.get(file);
  if (hit && hit.mtime === mtime) return hit.body;
  const body = makeBody(readFileSync(path));
  dataCache.set(file, { mtime, body });
  return body;
}

for (const file of ["lines.geojson", "stations.geojson", "routes.json", "neighborhoods.geojson", "parks.geojson"]) {
  app.get(`/api/${file}`, (req, res) => {
    const body = dataFile(file);
    if (!body) return res.status(503).json({ error: "Run `npm run build:data` in /server first." });
    // no-cache = the browser re-checks each load (cheap via ETag), so a rebuilt file shows up immediately
    res.set("Cache-Control", "no-cache");
    sendBody(req, res, body, "application/json");
  });
}

// ---- Realtime, cached so many browser tabs = one MTA request ---------------
let cache: { at: number; data: Snapshot; body: Body } | null = null;
let inflight: Promise<Snapshot> | null = null;

async function getSnapshot() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  inflight ??= fetchSnapshot()
    .then((data) => { cache = { at: Date.now(), data, body: makeBody(Buffer.from(JSON.stringify(data))) }; return data; })
    .finally(() => { inflight = null; });
  return inflight;
}

app.get("/api/realtime", async (req, res) => {
  try {
    await getSnapshot();
    sendBody(req, res, cache!.body, "application/json");
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

/**
 * Upcoming arrivals at a station, soonest first. Accepts one parent id ("127") or a
 * comma-separated station complex ("127,725,902,R16") so transfer hubs show every line.
 */
app.get("/api/arrivals/:stationIds", async (req, res) => {
  try {
    const ids = new Set(req.params.stationIds.split(","));
    const snap = await getSnapshot();
    const list = snap.arrivals
      .filter((a) => ids.has(a.stopId.replace(/[NS]$/, "")))
      .sort((a, b) => a.time - b.time)
      .slice(0, 16)
      .map((a) => ({ ...a, direction: a.stopId.endsWith("N") ? "N" : "S" }));
    res.json({ fetchedAt: snap.fetchedAt, arrivals: list });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

/** For the host's health check: up, and whether the data has been built. */
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, data: existsSync(join(DATA_DIR, "lines.geojson")) });
});

app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

// ---- The built client (production) ------------------------------------------
// In development Vite serves the client and proxies /api here, so this is skipped.
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".txt": "text/plain",
};
const COMPRESSIBLE = new Set([".html", ".js", ".css", ".json", ".svg", ".txt"]);

if (existsSync(join(CLIENT_DIR, "index.html"))) {
  // Load the whole build (a few MB) into memory once, compressed.
  const files = new Map<string, { type: string; body: Body | null; raw: Buffer }>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) { walk(path); continue; }
      const ext = extname(name).toLowerCase();
      const raw = readFileSync(path);
      files.set("/" + relative(CLIENT_DIR, path).split(sep).join("/"), {
        type: TYPES[ext] ?? "application/octet-stream",
        raw,
        body: COMPRESSIBLE.has(ext) ? makeBody(raw) : null,
      });
    }
  };
  walk(CLIENT_DIR);

  app.get("*", (req, res) => {
    // Unknown paths get the app itself (there's only one page).
    const file = files.get(req.path) ?? files.get("/index.html")!;
    // Vite puts a content hash in asset names, so those can be cached forever.
    res.set("Cache-Control", req.path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
    if (file.body) sendBody(req, res, file.body, file.type);
    else res.type(file.type).send(file.raw);
  });
  console.log(`Serving the client from ${CLIENT_DIR} (${files.size} files)`);
}

app.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));
