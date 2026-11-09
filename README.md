# Stand Clear — NYC Subway Explorer

An interactive Mapbox map of every NYC subway line and station, with live train
positions and a **"Take me somewhere"** button that rolls a random stop for you to go explore.

```
nyc-subway-explorer/
├── server/   Node + Express. Builds static GeoJSON from MTA GTFS; proxies & decodes realtime feeds
└── client/   Vite + React + TypeScript + mapbox-gl
```

## Why there's a server

| Data | Source | Browser-friendly? |
|---|---|---|
| Lines, stations, route colours | MTA static GTFS (zip of CSVs) | No — 30 MB+ zip. Pre-processed once into ~1 MB of GeoJSON |
| Live trains & arrivals | MTA GTFS-Realtime, 8 feeds, **no API key needed** | No — binary protobuf, and CORS. Decoded server-side, cached 20 s |

## Run it

Requires Node 20.11+.

```bash
# 1. Server
cd server
npm install
npm run build:data      # downloads MTA GTFS → server/data/*.geojson
npm run dev             # http://localhost:8787

# 2. Client (new terminal)
cd client
npm install
cp .env.example .env.local   # paste your Mapbox public token (pk.…)
npm run dev                  # http://localhost:5173
```

## Deploy (Render, free)

The repo includes a `render.yaml` [Blueprint](https://render.com/docs/blueprint-spec): one free web
service that downloads the data, builds the client, and serves both from the Express server.

1. On [Render](https://dashboard.render.com), choose **New → Blueprint** and connect this repo.
2. When asked, paste your Mapbox public token as `VITE_MAPBOX_TOKEN`.
3. Deploy. The first build takes a few minutes (it downloads the MTA GTFS and NYC Open Data).
4. In your Mapbox account, restrict the token to your `*.onrender.com` URL.

Free services sleep after 15 minutes without visitors, so the first visit after that takes about a
minute to wake up. Pushes to the connected branch redeploy automatically.

To try the production setup locally: `cd client && npm run build`, then `cd ../server && npm start`
and open http://localhost:8787.

## How it works

- **Lines** – the network is split into station-to-station segments (`server/src/segments.ts`). Each route's
  shape is cut at its stops, and express runs are also cut at the local stations they pass, so they line up
  with local segments. Every route gets its own line: where routes share a segment (4/5/6 on Lexington,
  B/C/D on Central Park West) each gets a `slot` and the client draws them side by side with `line-offset`.
  Express variants (6X, 7X, FX) fold into their base route, and only daytime routings are drawn.
- **Stations** – parent stops (`location_type = 1`) from `stops.txt`; the routes serving each one are
  derived by walking `stop_times.txt → trips.txt`.
- **Live trains** – `vehicle` entities from the realtime feeds give each train's route and the platform it's
  at or heading to (e.g. `127N`). The client snaps the train to that station. Polls every 30 s.
- **Arrivals** – `trip_update` entities give predicted times per platform; `/api/arrivals/:stationId` filters them.
- **Random stop** – crypto-random pick, optionally restricted to one line, avoiding stops you've
  already rolled (kept in `localStorage`) until you've seen them all.

## Ideas for next steps

1. **Smooth train movement.** Subway feeds don't include GPS. Interpolate each train between its previous
   and next stop along the route shape using the predicted arrival times (Turf.js `lineSlice` / `along`),
   and animate with `requestAnimationFrame`. This is the single most impressive upgrade.
2. **Service alerts** – `…/camsys/subway-alerts` feed; badge affected lines and stations.
3. **Exploration log** – "I went!" button, photos/notes per stop, a progress map of stops visited (472-ish).
4. **Smarter randomness** – "within 30 min of me" using a travel-time estimate, borough filter,
   "a stop I've never heard of" (weight by low ridership — MTA publishes hourly ridership on data.ny.gov).
5. **Deploy** – client on Vercel/Netlify, server on Fly/Render; commit `server/data/` or rebuild in CI.

## Attribution

Neighborhood boundaries: [NYC Neighborhood Boundaries](https://github.com/chriswhong/nyc-neighborhood-boundaries)
by Chris Whong and contributors, derived from Zillow's 2017 neighborhood boundaries, licensed
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). `server/data/neighborhoods.geojson` is a
simplified version of that data (outlines simplified, subway stops added) and is shared under the same license.

Transit data © MTA, used under the MTA developer terms. Don't use MTA logos or the official map without a
license — the route bullets here are plain coloured circles.
