# Back to Pasadena — House Hunting App

## Project Overview

A password-protected house hunting web app for comparing properties in the Pasadena, CA area. Built as a static site with a Cloudflare Workers API backend for mutable state (notes, favorites, status).

## Tech Stack

- **Static Site Generator**: Eleventy 3 (ESM, Nunjucks templates)
- **Hosting**: Cloudflare Workers with static assets (`_site/`)
- **Mutable State**: Cloudflare KV (namespace binding: `HOUSES`)
- **Research**: Redfin scraping (JSON-LD + embedded data) + Claude API (Sonnet) for neighborhood info + Google Maps Distance Matrix API
- **Lot Size**: LA County Assessor GIS API (surveyed parcel polygons via `Shape.STArea()`), Redfin fallback for non-LA-County
- **Risk Data**: CAL FIRE FHSZ ArcGIS API (fire) + FEMA NFHL ArcGIS API (flood)
- **Geocoding**: Google Maps Geocoding API with US Census geocoder fallback (free, no key)
- **Dependencies**: `@anthropic-ai/sdk`, `@googlemaps/google-maps-services-js`, `dotenv`
- **Fonts**: Playfair Display, Source Sans 3, JetBrains Mono (Google Fonts)
- **Theme**: Light/dark mode, editorial design tone

## Architecture

### Data Flow
1. User adds property via "Add Property" modal (Redfin URL input) → POST `/api/addresses` → worker parses address/city from URL path → saves stub to KV
2. Eleventy `before` event runs `sync-kv.js` (processes stubs from both local + remote KV → runs research per stub → writes JSON + images), then `pull-state.js` (pulls mutable state from remote KV → writes `src/_data/mutableState.json`), then `refresh-status.js` (scrapes current Redfin listing status for non-rejected properties → writes `status` field back to each JSON)
3. Eleventy reads `src/_data/houses.js` (loads all JSON files) → bakes data into `window.__HOUSES__` in `index.njk`
4. At runtime, static data merges with mutable state fetched from `/api/state`

### Research Pipeline (`scripts/research.js`)
1. **Redfin scrape**: Fetch listing page HTML → extract JSON-LD structured data (price, beds, baths, sqft, year built, images, geo coords, date listed) + embedded escaped JSON events array (price history, last sold) + agent info, Redfin estimate
2. **Geocode**: Use Redfin JSON-LD geo coordinates (or Google Maps geocoding, or US Census geocoder fallback)
3. **Lot size**: Query LA County Assessor GIS parcel API by address (`SitusAddress LIKE` query) → `Shape.STArea()` returns precise lot area in sqft from surveyed parcel polygons. Runs in parallel with fire/flood. Preferred over Redfin lot size; falls back to Redfin for non-LA-County properties.
4. **Fire risk**: Query CAL FIRE FHSZ ArcGIS REST API (SRA layer 0 + LRA layer 1) with lat/lon → "Low" if no zone, else "Moderate"/"High"/"Very High"
5. **Flood risk**: Query FEMA NFHL ArcGIS REST API (layer 28) with lat/lon → interpret FEMA zone codes (X=Low, A/AE=High, V/VE=High coastal)
6. **Claude research**: Web search for neighborhood description, park proximity, crime rating only (not property details)
7. **Google Maps**: Distance matrix to preset destinations
8. **Peep Rating**: Parse friend/family locations from `src/_data/peep-map.kml` (supports CDATA names) → parallel driving + walking Distance Matrix API calls → average driving distance/time + per-peep breakdown with coordinates
9. **Images**: Download up to 20 listing photos from Redfin JSON-LD image array
10. **Merge all**: Write combined JSON to `src/_data/houses/{id}.json`

### Key Directories
```
src/
  _data/houses.js       — Eleventy data file, reads src/_data/houses/*.json
  _data/houses/         — Per-property JSON files (immutable research data)
  _data/peep-map.kml    — Google My Maps KML export with friend/family locations for peep rating
  images/{id}/          — Downloaded property photos (up to 20 per listing)
  js/                   — Client-side modules (ES modules, no bundler)
    app.js              — Entry point, auth, state, global event wiring
    api.js              — API client (auth, state CRUD, URL submission)
    add-property.js     — Add property modal logic (Redfin URL input)
    cards.js            — Card grid rendering, sorting, filtering
    detail.js           — Full-page detail view, gallery/lightbox, inline-editable fields
    comparison.js       — Side-by-side comparison view (2-3 properties)
    status-banner.js    — Banner HTML helper (Pending/Contingent/Sold/etc. overlays)
    utils.js            — formatPrice, getDaysOnMarket, theme toggle
  css/styles.css        — All styles (CSS custom properties, light/dark themes)
  index.njk             — Single-page app template
worker/index.js         — Cloudflare Worker (auth, KV state, Redfin URL stubs)
scripts/
  research.js           — Redfin scraping + Claude neighborhood research + risk APIs + distances + peep rating
  peep-rating.js        — Backfill peep rating (driving + walking distances) for all properties from KML
  sync-kv.js            — Prebuild: process KV stubs → run research → write data files
  pull-state.js         — Prebuild: pull mutable KV state to src/_data/mutableState.json
  refresh-status.js     — Prebuild: scrape current Redfin status per non-rejected property (5-concurrency pool, 10s timeout, build-safe)
  status-parser.js      — Pure parser: parseStatus(html) + normalizeStatus(raw). No I/O.
  test-status-parser.js — Bare-bones test runner (15 tests) using node:assert/strict
  test-fixtures/        — Saved Redfin HTML fixtures for parser tests (active, pending, contingent, sold, closed-sale, backup-offers)
  migrate-kv.js         — One-time migration from old KV format
```

### Property Data Model (JSON in `src/_data/houses/{id}.json`)
```json
{
  "id": 1772771370317,
  "address": "1247 Meridian Ave",
  "city": "South Pasadena, CA 91030",
  "price": 1200000,
  "beds": 3,
  "baths": 2,
  "sqft": 1500,
  "yearBuilt": 1925,
  "images": ["/images/{id}/photo-1.jpg", "/images/{id}/photo-2.jpg"],
  "neighborhood": "...",
  "parkProximity": "0.3 miles to Garfield Park",
  "floodRisk": "Low — Zone X, minimal flood hazard (FEMA NFHL)",
  "fireRisk": "Low — not in a fire hazard severity zone (CAL FIRE FHSZ)",
  "crimeRating": "Very Low — Grade A (CrimeGrade.org)",
  "distances": [{ "name": "Whole Foods Market", "miles": "2.1 mi", "time": "7 min" }],
  "peepRating": {
    "avgMiles": "7.4 mi", "avgTime": "14 min",
    "distances": [{ "name": "Joan & David", "lat": 34.15, "lon": -118.16, "driving": { "miles": "3.2 mi", "time": "8 min" }, "walking": { "miles": "2.8 mi", "time": "52 min" } }]
  },
  "agent": { "name": "...", "phone": "...", "email": "..." },
  "dateListed": "2026-01-15",
  "priceHistory": [{ "type": "listed", "label": "Listed", "date": "Jan 15, 2026", "amount": 1200000 }],
  "lastSold": { "date": "Sep 8, 2023", "price": 900000 },
  "estimates": { "redfin": 1150000 },
  "listingUrl": "https://www.redfin.com/...",
  "listingSource": "redfin",
  "redfinUrl": "https://www.redfin.com/...",
  "dateAdded": "2026-03-15T16:00:00.000Z",
  "status": "Active"
}
```

### Mutable State (KV `state:{id}`)
```json
{ "notes": "", "visited": false, "offer": false, "rejected": false, "deleted": false, "favorite": false, "sidewalks": null, "streetTrees": null, "corner": null, "roadNoise": null, "stories": null, "condition": null, "backyard": null, "studio": null, "twoSinks": null, "wallOvens": null, "pool": null, "walkInShower": null, "characterHome": null, "garage": null }
```

### KV Stub Format (KV `stub:{id}`)
```json
{ "id": 1772814416071, "url": "https://www.redfin.com/CA/Pasadena/...", "address": "1234 Oak St", "city": "Pasadena, CA 91101", "createdAt": "2026-03-06T..." }
```

## Commands

- `npm run build` — Build static site (runs sync-kv.js as prebuild)
- `npm run dev` — Build + start Wrangler dev server
- `npm run deploy` — Build + deploy to Cloudflare Workers
- `npm run research` — Manual research: `node scripts/research.js "<address>" "<city>" <id> "<redfinUrl>"`
- `npm run sync` — Process pending address stubs from KV
- `npm run refresh-status` — Manually refresh Redfin listing status for non-rejected properties (also runs automatically each build)
- `npm run peep-rating` — Backfill peep rating (driving + walking distances from KML) for all properties

## Key Patterns

- **No bundler**: Client JS uses native ES modules with `import`/`export`
- **Window bindings**: All functions exposed via `window.functionName` in `app.js` for `onclick` handlers
- **IDs are timestamps**: `Date.now()` used as property IDs
- **Hash routing**: Detail view opens at `#property/{id}`, enabling browser back/forward navigation between grid and detail views. `popstate` listener in `app.js` handles navigation. Direct URLs work after auth.
- **Full-page detail view**: Detail view is a full-page layout (not a slide-in panel), toggling `#detailPage` / `#cardGrid` visibility. Uses native document scrolling (fixes iOS scroll issues). Sticky topbar with back button and status selector.
- **Deferred card re-render**: Status/note changes on the detail page set `state.cardsDirty = true` instead of immediately re-rendering. Grid re-renders only when closing the detail view via `closeDetail()`.
- **Status flags**: Properties use independent boolean flags (`visited`, `offer`, `rejected`, `deleted`) instead of a single status string. "New" is computed (`!visited && !offer && !rejected`). Multiple flags can coexist. Old `status` strings are migrated to booleans at read-time in `migrateStatus()`.
- **Rejected properties**: Cards with `rejected: true` are separated into a distinct section below active cards with reduced opacity and a darker background. Rejected card images show a diagonal red strikethrough.
- **Listing status banner**: Each property carries a `status` field — one of `Active | Pending | Contingent | Under Contract | Sold | Coming Soon | Off Market | null`. `scripts/refresh-status.js` updates it on every build by scraping the Redfin `mlsStatusDisplay.displayValue` (primary detector) and falling back to JSON-LD `offers.availability` for Sold. Skips rejected/deleted properties. On scrape failure, prior `status` is preserved (never downgraded to null). `src/js/status-banner.js` exports `statusBannerHtml(status)`, which renders a light-red banner for non-Active in-motion states and gray for Sold (no banner for Active or null). Banners overlay the lower-right of property images in the card grid, detail gallery, and comparison view; each container is `position: relative` so the absolute banner anchors correctly.
- **Risk display**: `riskClass()` in `detail.js` maps risk strings to CSS classes (`risk-low`, `risk-medium`, `risk-high`) based on prefix matching
- **Inline-editable fields**: Sidewalks, street trees, corner lot, road noise, stories, condition, backyard, studio, two sinks, wall ovens, pool, walk-in shower, character home, garage — toggle between display/edit mode, persist to KV. Gallery position preserved during inline edits.
- **Auth**: Simple shared password, token stored in localStorage as `btp_token`
- **Redfin URL parsing**: Worker extracts address/city from URL path pattern `/CA/City-Name/123-Street-Name-91030/home/12345`
- **Image gallery**: Detail view shows prev/next nav + counter for multi-image listings (dots shown for ≤10 images). Arrow key navigation in both gallery and lightbox. Touch swipe support for gallery and lightbox.
- **Peep Rating**: Average driving distance/time to friends & family from `src/_data/peep-map.kml`. Detail header shows summary line + expandable `<details>` dropdown with per-peep driving/walking Google Maps direction links (sorted by driving distance ascending). KML parsing handles both `<name>Text</name>` and `<name><![CDATA[Text]]></name>`. Backfill script `scripts/peep-rating.js` updates all house JSONs; also computed during initial research.
- **Native fetch()**: research.js uses Node's built-in `fetch()` instead of `https.get` to avoid interference from the Anthropic SDK's HTTP stack

## External APIs (no keys required)

- **LA County Assessor GIS**: `https://public.gis.lacounty.gov/public/rest/services/LACounty_Cache/LACounty_Parcel/MapServer/0/query` (lot size via `Shape.STArea()`, searchable by `SitusAddress LIKE` or `AIN`)
- **CAL FIRE FHSZ**: `https://services.gis.ca.gov/arcgis/rest/services/Environment/Fire_Severity_Zones/MapServer` (layers 0=SRA, 1=LRA)
- **FEMA NFHL**: `https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28`
- **US Census Geocoder**: `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress` (fallback when no Google Maps key)

## Destinations for Distance Calculations
Multiple locations per store across Pasadena, South Pasadena, Glendale, Montrose, and Arcadia. The research script calculates driving distance to all locations and keeps only the closest per store name. Stores: Whole Foods Market, Trader Joe's, Costco, Target, Home Depot, Republik Coffee.

## Environment Variables (`.env`)
- `ANTHROPIC_API_KEY` — For Claude research
- `GOOGLE_MAPS_API_KEY` — For distance matrix and geocoding (optional — Census geocoder used as fallback)
- `WORKER_URL` — Production worker URL (for remote stub sync)
- `APP_PASSWORD` — Shared app password (also needed in `.dev.vars` for local Wrangler dev — see below)

## Local Worker Secrets (`.dev.vars`)
Wrangler reads worker secrets from `.dev.vars`, NOT `.env`. For `npm run dev` auth to work locally, create `.dev.vars` with `APP_PASSWORD=...`. File is gitignored.
