import express from "express";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchSnapshot, type Snapshot } from "./realtime.js";

const PORT = Number(process.env.PORT ?? 8787);
const DATA_DIR = join(import.meta.dirname, "..", "data");
const CACHE_MS = 20_000; // MTA feeds refresh roughly every 30s

const app = express();

// ---- Static network data (built by `npm run build:data`) -------------------
for (const file of ["lines.geojson", "stations.geojson", "routes.json", "neighborhoods.geojson", "parks.geojson"]) {
  app.get(`/api/${file}`, (_req, res) => {
    const path = join(DATA_DIR, file);
    if (!existsSync(path)) return res.status(503).json({ error: "Run `npm run build:data` in /server first." });
    // no-cache = the browser re-checks each load (cheap via ETag), so a rebuilt file shows up immediately
    res.type("application/json").set("Cache-Control", "no-cache").send(readFileSync(path));
  });
}

// ---- Realtime, cached so many browser tabs = one MTA request ---------------
let cache: { at: number; data: Snapshot } | null = null;
let inflight: Promise<Snapshot> | null = null;

async function getSnapshot() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  inflight ??= fetchSnapshot()
    .then((data) => { cache = { at: Date.now(), data }; return data; })
    .finally(() => { inflight = null; });
  return inflight;
}

app.get("/api/realtime", async (_req, res) => {
  try {
    res.json(await getSnapshot());
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

app.listen(PORT, () => console.log(`API on http://localhost:${PORT}`));
