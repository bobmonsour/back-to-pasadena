# Property Listing Status — Design

**Date:** 2026-05-11
**Status:** Approved, pending implementation plan

## Summary

Add a "current listing status" indicator (Pending / Contingent / Under Contract / Sold / Coming Soon / Off Market) to each non-rejected property, refreshed automatically on every build by scraping Redfin. Display as a small colored banner overlaid on the property image in the card grid, detail gallery, and comparison view.

Active listings get no banner (the default state is implied by its absence).

## Goals

- Surface real-time listing status without manual updates.
- Avoid wasted work on properties the user has already rejected.
- Keep the build resilient: a scrape failure for one property must not break the build or wipe a previously known status.

## Non-Goals

- Sort/filter the grid by status (could be a follow-up).
- Notify the user when a status changes.
- Track historical status transitions.
- Re-scrape any field other than `status` on each build (price, beds, etc. remain one-shot research output).
- Add an automated test framework to the project.

## Status Vocabulary

Normalized to one of these literal strings:

| Value | Meaning | Banner |
|---|---|---|
| `Active` | For sale, no contract pending | none (default) |
| `Pending` | Offer accepted, contingencies satisfied | red, label `PENDING` |
| `Contingent` | Offer accepted, contingencies remain | red, label `CONTINGENT` |
| `Under Contract` | Offer accepted (broader umbrella) | red, label `UNDER CONTRACT` |
| `Coming Soon` | Not yet on market | red, label `COMING SOON` |
| `Off Market` | Withdrawn / temporarily unavailable | red, label `OFF MARKET` |
| `Sold` | Closed | gray, label `SOLD` |
| `null` | Unknown (never successfully scraped) | none |

Any other parsed value is treated as unknown and the prior `status` is preserved.

Sold properties stay in the main grid (gray banner). The user manually flags them `rejected` afterward via the existing status selector, which moves them to the Rejected section.

## Architecture

### Build Pipeline Insertion

```
eleventy.before hook:
  1. sync-kv.js          (existing — process new stubs → research.js)
  2. pull-state.js       (existing — KV → src/_data/mutableState.json)
  3. refresh-status.js   ← NEW
  → Eleventy reads src/_data/houses/*.json + mutableState.json
```

`refresh-status.js` runs after `pull-state.js` so it can read `mutableState.json` for the rejected/deleted filter. Wrapped in try/catch in `eleventy.config.js` like the other two — build proceeds on failure.

### refresh-status.js Logic

1. Read `src/_data/mutableState.json` (skip if missing → treat as no rejections).
2. List every `src/_data/houses/*.json`.
3. Filter to candidates: `mutableState[id].rejected !== true` AND `mutableState[id].deleted !== true` AND property has a non-empty `redfinUrl`.
4. Concurrency-limited pool (max 5 parallel fetches): for each candidate, fetch the Redfin URL with a 10s timeout and the same browser-like `User-Agent` as `research.js`.
5. Parse status from the HTML (see "Status Detection" below).
6. If parsed to a valid value, write it back to the property JSON's `status` field. If parse fails or fetch errors, log a warning and leave the existing `status` untouched.
7. Print a one-line summary per property: `1247 Meridian Ave → Pending (via og:title)` or `1247 Meridian Ave → SKIPPED (rejected)` or `1247 Meridian Ave → ERROR: timeout, keeping prior "Active"`.

### Status Detection (priority order)

For each Redfin HTML response, try sources in this order; first valid match wins:

1. **Embedded JSON** — regex-search the HTML for keys `"mlsStatus"`, `"searchStatus"`, `"listingStatus"`, `"status"` with string values. Redfin's hydrated page state typically contains a literal like `"Active"`, `"Pending"`, `"Contingent"`, etc.
2. **`og:title` / `<title>` prefix** — patterns like `"Pending: 1234 Foo St"`, `"SOLD - 1234 Foo St"`, `"Coming Soon: ..."`.
3. **JSON-LD `offers.availability`** — used as a coarse confirmation only:
   - `https://schema.org/InStock` is consistent with `Active`.
   - `OutOfStock` is consistent with `Sold` / `Off Market` but not specific enough alone.
4. **Visible-text regex** — last resort, scan the first ~50KB of HTML for `/\b(Pending|Contingent|Under Contract|Coming Soon|Off Market)\b/i`.

Each parsed raw value is normalized via a `normalizeStatus(raw)` function to one of the vocabulary values above. Unknown raw values return `null` (which the caller treats as "no update; keep prior").

The first implementation cut logs which source fired for each property; the priority order can be tuned after observing real data across the existing property set.

## Data Model

One new optional field added to `src/_data/houses/{id}.json`:

```jsonc
{
  // ... existing fields ...
  "status": "Pending"  // or "Active" | "Contingent" | "Under Contract" | "Sold" | "Coming Soon" | "Off Market" | null
}
```

- Owned by `refresh-status.js`; not present on properties that have never been successfully refreshed.
- Sits on the static JSON (research output), not in mutable KV state (which remains for user-edited fields).
- `research.js` does not need to set this on initial creation — it will be populated on the first build after the property is added.

## UI Rendering

### Banner Element

Single reusable HTML pattern, rendered wherever a property image is shown:

```html
<div class="status-banner status-banner--in-motion">PENDING</div>
```

Modifier classes:
- `status-banner--in-motion` → light red background (Pending, Contingent, Under Contract, Coming Soon, Off Market)
- `status-banner--sold` → gray background (Sold)

Rendered only when `house.status` is set and not `"Active"`.

### Placements

1. **Card grid** (`src/js/cards.js`) — overlay positioned at the lower-right of each card's image area.
2. **Detail page gallery** (`src/js/detail.js`) — overlay positioned at the lower-right of the large gallery image. Stays in place as the user navigates between photos.
3. **Comparison view** (`src/js/comparison.js`) — overlay positioned at the lower-right of each side-by-side image.

### Styling

CSS lives in `src/css/styles.css` alongside existing patterns (the file's existing `risk-low`/`risk-medium`/`risk-high` classes are good neighbors). Use CSS custom properties for colors so light/dark themes can override. Approximate look:

- Padding: ~4px 10px
- Font: uppercase, small, bold, condensed
- Border-radius: small (~3px)
- Position: absolute, bottom-right of containing image with ~8px inset
- Drop shadow for legibility over varied photos
- Light red ≈ `#e57373` background, white text
- Gray ≈ `#9e9e9e` background, white text

(Exact color values to be finalized during implementation against the existing palette.)

## Failure Handling

| Failure | Behavior |
|---|---|
| `refresh-status.js` crashes | `eleventy.before` try/catch logs it; build proceeds. |
| Fetch timeout / non-200 | Log warning; leave existing `status` untouched. |
| HTML parses but no status signal found | Log warning; leave existing `status` untouched. |
| Property has no `redfinUrl` | Skipped silently. |
| Property is rejected or deleted | Skipped (logged at INFO). |
| First-ever refresh fails for a property | `status` remains absent → no banner shown. |

The invariant is: **`refresh-status.js` only ever upgrades a property's `status` from a less-confident to a more-confident value, never downgrades to `null`.**

## Politeness

- Concurrency cap: 5 parallel fetches via a simple async pool.
- Same `User-Agent` string as `research.js`.
- No retry on failure (we'll get a fresh shot next build).
- ~30 properties × 1 fetch = 30 requests/build, spread over ~5–10 seconds at concurrency 5. Acceptable to user.

## Testing

- **Fixture parser test**: save a handful of real Redfin HTMLs (one of each status we can find in the wild) under `scripts/test-fixtures/redfin-status/` and write a small standalone test runner (`scripts/test-status-parser.js`) that asserts `parseStatus(html)` returns the correct normalized value for each. Runs via `node scripts/test-status-parser.js`. No test framework dependency.
- **Smoke run**: `node scripts/refresh-status.js` invoked manually on the real property set; eyeball the per-property log lines for sanity.

## File Inventory

**New files:**
- `scripts/refresh-status.js` — main refresh script.
- `scripts/test-status-parser.js` — fixture-based parser test.
- `scripts/test-fixtures/redfin-status/*.html` — saved Redfin pages with known statuses.

**Modified files:**
- `eleventy.config.js` — add `refresh-status.js` to the `eleventy.before` hook, after `pull-state.js`.
- `src/js/cards.js` — render banner in card template.
- `src/js/detail.js` — render banner over detail gallery image.
- `src/js/comparison.js` — render banner over each comparison image.
- `src/css/styles.css` — `.status-banner` and modifier classes.
- `package.json` — add `"refresh-status": "node scripts/refresh-status.js"` script entry for manual invocation.

**Untouched:**
- `scripts/research.js` — initial research keeps its current behavior; status will be populated on the next build after a property is added.
- `worker/index.js` — no API/KV changes; status lives in static JSON.
- Mutable KV state shape — unchanged.

## Open Items for Implementation

These are deliberately deferred to the implementation phase, not the design:

1. **Probe real listings** to confirm which detection source is most reliable. Save at least one HTML fixture per status we encounter.
2. **Final color values** matched to the existing light/dark palette.
3. **Banner positioning** on each of the three placements — verify it doesn't overlap any existing UI element (e.g. the diagonal red strikethrough on rejected card images, image-count badges).
