# Property Listing Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Redfin-scraped listing status (`Pending`, `Contingent`, `Sold`, etc.) to each non-rejected property, refreshed on every build, and display it as a colored banner overlaying property images in the card grid, detail gallery, and comparison view.

**Architecture:** A small reusable parser module (`scripts/status-parser.js`) detects status from Redfin HTML using four fallback signals. A new build-step script (`scripts/refresh-status.js`) reads existing property JSONs, skips rejected/deleted, fetches each Redfin URL with a 5-concurrency pool, and writes the parsed status back into the static JSON. Eleventy's `before` hook runs this after `pull-state.js`. Client-side, a tiny `src/js/status-banner.js` helper produces banner HTML that the card, detail, and comparison renderers embed over their images.

**Tech Stack:** Node 18+ (built-in `fetch`), Eleventy 3, vanilla ES modules (no bundler), Cloudflare Workers KV (read-only here), CSS custom properties for theming.

**Source spec:** `docs/superpowers/specs/2026-05-11-property-listing-status-design.md`

---

## File Inventory

**New files:**
- `scripts/status-parser.js` — pure parser: `parseStatus(html)`, `normalizeStatus(raw)`. No I/O, importable, testable.
- `scripts/refresh-status.js` — orchestration: load JSONs, filter, fetch Redfin, call parser, write JSONs.
- `scripts/test-status-parser.js` — fixture-driven test runner (no framework, just `assert`).
- `scripts/test-fixtures/redfin-status/active.html` — fixture for Active.
- `scripts/test-fixtures/redfin-status/pending.html` — fixture for Pending.
- `scripts/test-fixtures/redfin-status/contingent.html` — fixture for Contingent.
- `scripts/test-fixtures/redfin-status/sold.html` — fixture for Sold.
- `scripts/test-fixtures/redfin-status/coming-soon.html` — fixture for Coming Soon (if findable).
- `src/js/status-banner.js` — single function `statusBannerHtml(status)` returning `""` for Active/null else the banner `<div>`.

**Modified files:**
- `eleventy.config.js` — add `refresh-status.js` to the `eleventy.before` hook, after `pull-state.js`.
- `package.json` — add `"refresh-status": "node scripts/refresh-status.js"` to `scripts`.
- `src/index.njk` — add `<div id="detailStatusBanner">` inside `#detailGallery`.
- `src/js/cards.js` — call `statusBannerHtml()` inside `renderCard`'s `.card-image-wrap`.
- `src/js/detail.js` — set `#detailStatusBanner` content/visibility in `openDetail()`.
- `src/js/comparison.js` — call `statusBannerHtml()` in the comparison image card template.
- `src/css/styles.css` — `.status-banner` and modifier classes.

---

## Task 1: Capture Redfin HTML fixtures

**Files:**
- Create: `scripts/test-fixtures/redfin-status/active.html`
- Create: `scripts/test-fixtures/redfin-status/pending.html`
- Create: `scripts/test-fixtures/redfin-status/contingent.html`
- Create: `scripts/test-fixtures/redfin-status/sold.html`
- Create: `scripts/test-fixtures/redfin-status/coming-soon.html` (best-effort)

These fixtures are the ground truth the parser is built against. They must be real Redfin HTML.

- [ ] **Step 1: Make the fixtures directory**

```bash
mkdir -p scripts/test-fixtures/redfin-status
```

- [ ] **Step 2: Capture an Active fixture from an existing property**

Pick any property from `src/_data/houses/*.json` whose listing is currently Active on Redfin (open the URL in a browser to confirm; you want a page with no status badge). Then:

```bash
REDFIN_URL="<the url>"
curl -sL -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" "$REDFIN_URL" > scripts/test-fixtures/redfin-status/active.html
```

Expected: a file > 100KB. If you got an HTML page that says "Access Denied" or similar, try a different listing.

- [ ] **Step 3: Find and capture Pending / Contingent / Sold / Coming Soon fixtures**

Browse https://www.redfin.com/city/15772/CA/Pasadena (or any nearby market) and filter to find a listing visibly in each status. For each one, copy the URL and run:

```bash
curl -sL -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" "<url>" > scripts/test-fixtures/redfin-status/pending.html
# repeat for contingent.html, sold.html, coming-soon.html
```

If you cannot find a fixture for a given status (e.g. Coming Soon may be rare), skip it — the test will simply not have that case. Note which ones you skipped.

- [ ] **Step 4: Verify each fixture contains its status signal**

For each fixture captured, grep to confirm the status keyword is somewhere in the HTML:

```bash
for f in scripts/test-fixtures/redfin-status/*.html; do
  echo "=== $f ==="
  grep -ioE "(pending|contingent|under contract|sold|coming soon|active)" "$f" | sort -u
done
```

Expected: each file shows its expected status keyword (or several keywords — that's normal; pending fixtures will also mention "active" in unrelated contexts).

- [ ] **Step 5: Inspect the Pending fixture to learn which signals are present**

```bash
grep -oE '"(mlsStatus|listingStatus|searchStatus|status|propertyStatus)"\s*:\s*"[A-Za-z _]+"' scripts/test-fixtures/redfin-status/pending.html | head -20
grep -oE '<title>[^<]+</title>' scripts/test-fixtures/redfin-status/pending.html
grep -oE 'og:title" content="[^"]+"' scripts/test-fixtures/redfin-status/pending.html
grep -oE '"availability"\s*:\s*"[^"]+"' scripts/test-fixtures/redfin-status/pending.html | head -5
```

Make a quick mental note of which sources actually surface the status string. The Task 4–7 parser implementations should be tuned against what you find here. Common patterns to expect:
- `<title>Pending: 1234 Foo St ...` or `og:title content="(Pending) 1234 Foo St ..."`
- `"mlsStatus":"Pending"` or `"propertyStatus":"PENDING"`
- `"availability":"https://schema.org/InStock"` (Active) vs `OutOfStock` (Pending/Sold) — coarse only

- [ ] **Step 6: Commit the fixtures**

```bash
git add scripts/test-fixtures/redfin-status/
git commit -m "test: add Redfin HTML fixtures for status parser"
```

---

## Task 2: Scaffold the parser module + normalizeStatus

**Files:**
- Create: `scripts/status-parser.js`
- Create: `scripts/test-status-parser.js`

- [ ] **Step 1: Create the parser module skeleton**

```javascript
// scripts/status-parser.js

// Allowed normalized status values. Anything else returned by detection is dropped.
export const STATUSES = ["Active", "Pending", "Contingent", "Under Contract", "Sold", "Coming Soon", "Off Market"];

const NORMALIZE_MAP = {
  "active": "Active",
  "for sale": "Active",
  "pending": "Pending",
  "contingent": "Contingent",
  "under contract": "Under Contract",
  "sold": "Sold",
  "coming soon": "Coming Soon",
  "off market": "Off Market",
  "off-market": "Off Market",
};

export function normalizeStatus(raw) {
  if (!raw) return null;
  const key = String(raw).trim().toLowerCase();
  return NORMALIZE_MAP[key] || null;
}

export function parseStatus(html) {
  // Implemented progressively in Tasks 4-7.
  return null;
}
```

- [ ] **Step 2: Create the test runner skeleton**

```javascript
// scripts/test-status-parser.js
import { readFileSync } from "fs";
import { join } from "path";
import assert from "node:assert/strict";
import { normalizeStatus, parseStatus } from "./status-parser.js";

const FIXTURE_DIR = join(process.cwd(), "scripts", "test-fixtures", "redfin-status");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
    failed++;
  }
}

function loadFixture(filename) {
  return readFileSync(join(FIXTURE_DIR, filename), "utf-8");
}

// --- normalizeStatus ---
console.log("normalizeStatus:");
test("returns canonical for known values", () => {
  assert.equal(normalizeStatus("pending"), "Pending");
  assert.equal(normalizeStatus("PENDING"), "Pending");
  assert.equal(normalizeStatus("  Sold  "), "Sold");
  assert.equal(normalizeStatus("under contract"), "Under Contract");
  assert.equal(normalizeStatus("off-market"), "Off Market");
});
test("returns null for unknown / empty", () => {
  assert.equal(normalizeStatus(""), null);
  assert.equal(normalizeStatus(null), null);
  assert.equal(normalizeStatus(undefined), null);
  assert.equal(normalizeStatus("withdrawn"), null);
});

// --- parseStatus tests added in later tasks ---

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 3: Run the tests; verify normalize passes and parseStatus is stubbed**

```bash
node scripts/test-status-parser.js
```

Expected:
```
normalizeStatus:
  PASS  returns canonical for known values
  PASS  returns null for unknown / empty

2 passed, 0 failed
```

- [ ] **Step 4: Commit**

```bash
git add scripts/status-parser.js scripts/test-status-parser.js
git commit -m "feat: scaffold status parser with normalizeStatus"
```

---

## Task 3: Add og:title / <title> detection

**Files:**
- Modify: `scripts/status-parser.js`
- Modify: `scripts/test-status-parser.js`

og:title is usually the most reliable single signal (Redfin prepends or parenthesizes status). Start here.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/test-status-parser.js` (just before the final `console.log` summary):

```javascript
// --- parseStatus: title-based detection ---
console.log("\nparseStatus (title):");
test("Pending fixture returns 'Pending'", () => {
  const html = loadFixture("pending.html");
  assert.equal(parseStatus(html), "Pending");
});
test("Active fixture returns 'Active' or null", () => {
  const html = loadFixture("active.html");
  const result = parseStatus(html);
  // Active may be undetectable from title alone — allow null at this stage,
  // refined in later tasks.
  assert.ok(result === "Active" || result === null, `got ${result}`);
});
```

- [ ] **Step 2: Run; verify Pending test fails (Active may pass trivially)**

```bash
node scripts/test-status-parser.js
```

Expected: FAIL on "Pending fixture returns 'Pending'" with `got null`.

- [ ] **Step 3: Implement title-based detection**

Replace the `parseStatus` body in `scripts/status-parser.js`:

```javascript
export function parseStatus(html) {
  return detectFromTitle(html);
}

function detectFromTitle(html) {
  const ogMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i)
    || html.match(/<meta\s+content="([^"]+)"\s+property="og:title"/i);
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  const candidates = [ogMatch?.[1], titleMatch?.[1]].filter(Boolean);

  for (const title of candidates) {
    // "Pending: 1234 Foo St ..." / "SOLD - 1234 ..." / "1234 Foo St (Pending) | ..."
    const m = title.match(/\b(Pending|Contingent|Under Contract|Coming Soon|Off[- ]Market|Sold)\b/i);
    if (m) {
      const norm = normalizeStatus(m[1]);
      if (norm) return norm;
    }
  }
  return null;
}
```

- [ ] **Step 4: Run tests; verify Pending passes**

```bash
node scripts/test-status-parser.js
```

Expected: both new tests PASS. If the Pending fixture's title doesn't actually contain "Pending", re-run the inspection from Task 1 Step 5 against `pending.html` to see what's actually there, and adjust the regex in `detectFromTitle`.

- [ ] **Step 5: Add tests + verify for any other fixtures you captured**

For each of `contingent.html`, `sold.html`, `coming-soon.html` that you successfully captured in Task 1, add:

```javascript
test("Contingent fixture returns 'Contingent'", () => {
  assert.equal(parseStatus(loadFixture("contingent.html")), "Contingent");
});
test("Sold fixture returns 'Sold'", () => {
  assert.equal(parseStatus(loadFixture("sold.html")), "Sold");
});
test("Coming Soon fixture returns 'Coming Soon'", () => {
  assert.equal(parseStatus(loadFixture("coming-soon.html")), "Coming Soon");
});
```

Run again. If any fail because title doesn't carry that status, leave the test failing for now — Tasks 4–6 add fallback sources that should catch them.

- [ ] **Step 6: Commit**

```bash
git add scripts/status-parser.js scripts/test-status-parser.js
git commit -m "feat: detect listing status from og:title/title"
```

---

## Task 4: Add embedded-JSON detection (fallback 1)

**Files:**
- Modify: `scripts/status-parser.js`

Hydrated page state on Redfin often includes keys like `"mlsStatus"`, `"propertyStatus"`, `"searchStatus"`, `"listingStatus"`.

- [ ] **Step 1: Confirm the keys present in your fixtures**

From your Task 1 inspection, note which JSON-style status keys actually appear in the fixtures. The regex below targets the four common names; add others if you saw them.

- [ ] **Step 2: Add the embedded-JSON detector and chain it after title**

In `scripts/status-parser.js`, replace `parseStatus` and add `detectFromEmbeddedJson`:

```javascript
export function parseStatus(html) {
  return (
    detectFromTitle(html) ||
    detectFromEmbeddedJson(html) ||
    null
  );
}

function detectFromEmbeddedJson(html) {
  // Match e.g. "mlsStatus":"Pending" or "propertyStatus":"PENDING"
  // including escaped variants from embedded JSON like \"mlsStatus\":\"Pending\"
  const re = /\\?"(?:mlsStatus|listingStatus|searchStatus|propertyStatus)\\?"\s*:\s*\\?"([A-Za-z _-]+)\\?"/g;
  let m;
  while ((m = re.exec(html))) {
    const norm = normalizeStatus(m[1]);
    if (norm) return norm;
  }
  return null;
}
```

- [ ] **Step 3: Run tests**

```bash
node scripts/test-status-parser.js
```

Expected: any fixture test that previously failed (because title alone didn't carry the status) may now pass via the JSON fallback. If a test still fails, inspect that fixture more closely:

```bash
grep -oE '"[A-Za-z]*[Ss]tatus"\s*:\s*"[^"]+"' scripts/test-fixtures/redfin-status/<file>.html | head
```

If you discover a different key name (e.g. `"saleStatus"`), add it to the regex's alternation group.

- [ ] **Step 4: Commit**

```bash
git add scripts/status-parser.js
git commit -m "feat: fall back to embedded JSON status keys"
```

---

## Task 5: Add JSON-LD availability detection (fallback 2)

**Files:**
- Modify: `scripts/status-parser.js`

JSON-LD `offers.availability` is coarse — only useful to distinguish Active (`InStock`) from "not active" (`OutOfStock`). Treat it as a tie-breaker only when title + embedded JSON returned nothing.

- [ ] **Step 1: Add the detector and chain it**

In `scripts/status-parser.js`:

```javascript
export function parseStatus(html) {
  return (
    detectFromTitle(html) ||
    detectFromEmbeddedJson(html) ||
    detectFromJsonLdAvailability(html) ||
    null
  );
}

function detectFromJsonLdAvailability(html) {
  // Coarse: InStock → Active. OutOfStock alone is ambiguous so we return null.
  const blocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
  for (const block of blocks) {
    try {
      const json = block.replace(/<script[^>]*>/, "").replace(/<\/script>/, "");
      const ld = JSON.parse(json);
      const offers = ld.offers || ld.mainEntity?.offers;
      const availability = offers?.availability || "";
      if (typeof availability === "string" && /InStock/i.test(availability)) {
        return "Active";
      }
    } catch {
      // ignore malformed JSON-LD
    }
  }
  return null;
}
```

- [ ] **Step 2: Confirm the Active test now passes by this path**

```bash
node scripts/test-status-parser.js
```

If the Active fixture's title carried no status keyword, this JSON-LD detector should now resolve it. Update the Active test to be strict:

```javascript
test("Active fixture returns 'Active' or null", () => {
  // was: allow null at title stage
});
```

Replace with:

```javascript
test("Active fixture returns 'Active'", () => {
  assert.equal(parseStatus(loadFixture("active.html")), "Active");
});
```

Run tests. Expected: PASS.

If it still fails, the Active fixture lacks both a title status and a JSON-LD availability — leave the test failing; Task 6 covers it.

- [ ] **Step 3: Commit**

```bash
git add scripts/status-parser.js scripts/test-status-parser.js
git commit -m "feat: fall back to JSON-LD availability for Active"
```

---

## Task 6: Add visible-text regex (fallback 3)

**Files:**
- Modify: `scripts/status-parser.js`

Last-resort scan over the first 50KB of HTML. Looks for the status keywords as standalone words.

- [ ] **Step 1: Add the detector and chain it**

In `scripts/status-parser.js`:

```javascript
export function parseStatus(html) {
  return (
    detectFromTitle(html) ||
    detectFromEmbeddedJson(html) ||
    detectFromJsonLdAvailability(html) ||
    detectFromVisibleText(html) ||
    null
  );
}

function detectFromVisibleText(html) {
  const window = html.slice(0, 50000);
  // Order matters: "Under Contract" must match before single "Contract".
  const patterns = [
    /\b(Coming Soon)\b/i,
    /\b(Under Contract)\b/i,
    /\b(Off[- ]Market)\b/i,
    /\b(Pending)\b/i,
    /\b(Contingent)\b/i,
    /\b(Sold)\b/i,
  ];
  for (const re of patterns) {
    const m = window.match(re);
    if (m) {
      const norm = normalizeStatus(m[1]);
      if (norm) return norm;
    }
  }
  return null;
}
```

- [ ] **Step 2: Run all tests**

```bash
node scripts/test-status-parser.js
```

Expected: all fixture tests pass.

- [ ] **Step 3: Commit**

```bash
git add scripts/status-parser.js
git commit -m "feat: add visible-text fallback for listing status"
```

---

## Task 7: Build refresh-status.js — orchestration script

**Files:**
- Create: `scripts/refresh-status.js`

Loads property JSONs, filters out rejected/deleted, fetches Redfin pages with a concurrency pool of 5, parses status, writes JSONs back. Failures preserve the prior status.

- [ ] **Step 1: Write the script**

```javascript
#!/usr/bin/env node
// scripts/refresh-status.js
import "dotenv/config";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { parseStatus } from "./status-parser.js";

const HOUSES_DIR = join(process.cwd(), "src", "_data", "houses");
const MUTABLE_STATE_PATH = join(process.cwd(), "src", "_data", "mutableState.json");
const CONCURRENCY = 5;
const FETCH_TIMEOUT_MS = 10000;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function loadMutableState() {
  if (!existsSync(MUTABLE_STATE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(MUTABLE_STATE_PATH, "utf-8"));
  } catch (err) {
    console.warn(`  Could not read mutableState.json: ${err.message}`);
    return {};
  }
}

function loadProperties() {
  if (!existsSync(HOUSES_DIR)) return [];
  return readdirSync(HOUSES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const path = join(HOUSES_DIR, f);
      const data = JSON.parse(readFileSync(path, "utf-8"));
      return { path, data };
    });
}

async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function refreshOne({ path, data }) {
  const prior = data.status ?? null;
  const label = `${data.address}`;
  try {
    const html = await fetchWithTimeout(data.redfinUrl, FETCH_TIMEOUT_MS);
    const parsed = parseStatus(html);
    if (!parsed) {
      console.log(`  ${label} → no status detected, keeping prior "${prior}"`);
      return;
    }
    if (parsed === prior) {
      console.log(`  ${label} → ${parsed} (unchanged)`);
      return;
    }
    data.status = parsed;
    writeFileSync(path, JSON.stringify(data, null, 2));
    console.log(`  ${label} → ${parsed}${prior ? ` (was ${prior})` : ""}`);
  } catch (err) {
    console.warn(`  ${label} → ERROR: ${err.message}, keeping prior "${prior}"`);
  }
}

async function runPool(items, worker, concurrency) {
  const queue = [...items];
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await worker(item);
    }
  });
  await Promise.all(workers);
}

async function main() {
  console.log("Refreshing listing statuses...");
  const mutableState = loadMutableState();
  const properties = loadProperties();

  const candidates = properties.filter(({ data }) => {
    const state = mutableState[String(data.id)] || {};
    if (state.rejected) {
      console.log(`  ${data.address} → SKIPPED (rejected)`);
      return false;
    }
    if (state.deleted) return false;
    if (!data.redfinUrl || data.redfinUrl === "#") {
      console.log(`  ${data.address} → SKIPPED (no Redfin URL)`);
      return false;
    }
    return true;
  });

  if (candidates.length === 0) {
    console.log("No candidates to refresh.");
    return;
  }

  console.log(`Refreshing ${candidates.length} propert${candidates.length === 1 ? "y" : "ies"} (concurrency ${CONCURRENCY})...`);
  await runPool(candidates, refreshOne, CONCURRENCY);
  console.log("Status refresh complete.");
}

main().catch((err) => {
  console.error("refresh-status failed:", err.message);
  process.exit(0); // non-fatal — never break the build
});
```

- [ ] **Step 2: Run it manually**

```bash
node scripts/refresh-status.js
```

Expected: one line per property — either a status update, "unchanged", "no status detected", "SKIPPED", or "ERROR". Build never throws.

- [ ] **Step 3: Verify a JSON was updated**

If any property's status changed, inspect one:

```bash
grep -l '"status"' src/_data/houses/*.json | head -1
```

Expected: at least one file now contains `"status": "..."`.

- [ ] **Step 4: Run it again — second run should mostly say "unchanged"**

```bash
node scripts/refresh-status.js
```

Expected: per-property lines now mostly say `(unchanged)`.

- [ ] **Step 5: Commit**

```bash
git add scripts/refresh-status.js src/_data/houses/
git commit -m "feat: refresh-status.js — scrape Redfin status per build"
```

---

## Task 8: Wire into the Eleventy build + npm script

**Files:**
- Modify: `eleventy.config.js:6-17`
- Modify: `package.json:6-14`

- [ ] **Step 1: Add the third execSync in the eleventy.before hook**

In `eleventy.config.js`, replace the body of the `eleventy.before` handler:

```javascript
  eleventyConfig.on("eleventy.before", async () => {
    try {
      execSync("node scripts/sync-kv.js", { stdio: "inherit" });
    } catch (err) {
      console.error("sync-kv failed:", err.message);
    }
    try {
      execSync("node scripts/pull-state.js", { stdio: "inherit" });
    } catch (err) {
      console.error("pull-state failed:", err.message);
    }
    try {
      execSync("node scripts/refresh-status.js", { stdio: "inherit" });
    } catch (err) {
      console.error("refresh-status failed:", err.message);
    }
  });
```

- [ ] **Step 2: Add the npm script for manual invocation**

In `package.json`, in the `scripts` block, add a new line after `"sync"`:

```json
    "sync": "node scripts/sync-kv.js",
    "refresh-status": "node scripts/refresh-status.js",
    "migrate": "node scripts/migrate-kv.js",
```

- [ ] **Step 3: Verify the full build runs end-to-end**

```bash
npm run build
```

Expected: Eleventy output includes "Refreshing listing statuses..." between the sync and pull lines (well, after pull-state — order is sync → pull → refresh → 11ty). Build succeeds. `_site/` is regenerated.

- [ ] **Step 4: Commit**

```bash
git add eleventy.config.js package.json
git commit -m "build: run refresh-status.js in eleventy.before hook"
```

---

## Task 9: Banner CSS

**Files:**
- Modify: `src/css/styles.css`

- [ ] **Step 1: Find the existing `.risk-low` / `.risk-medium` block as a style neighbor**

```bash
grep -n "risk-low\|risk-medium" src/css/styles.css | head -5
```

Note the location — the banner styles will go nearby for cohesion.

- [ ] **Step 2: Append the banner styles**

Add to `src/css/styles.css` (anywhere reasonable; near the risk classes is fine):

```css
.status-banner {
  position: absolute;
  bottom: 8px;
  right: 8px;
  padding: 4px 10px;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #fff;
  border-radius: 3px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
  pointer-events: none;
  z-index: 3;
}
.status-banner--in-motion {
  background: #e57373; /* light red */
}
.status-banner--sold {
  background: #9e9e9e; /* neutral gray */
}
```

- [ ] **Step 3: Verify the file parses (no syntax errors) by running the build**

```bash
npm run build
```

Expected: build succeeds; no CSS warnings about the new rules.

- [ ] **Step 4: Commit**

```bash
git add src/css/styles.css
git commit -m "style: add .status-banner classes"
```

---

## Task 10: Banner helper module

**Files:**
- Create: `src/js/status-banner.js`

DRY: card, detail, and comparison all need the same banner HTML. One helper keeps the markup and the active-suppression rule in one place.

- [ ] **Step 1: Write the helper**

```javascript
// src/js/status-banner.js

const IN_MOTION = new Set(["Pending", "Contingent", "Under Contract", "Coming Soon", "Off Market"]);

export function statusBannerHtml(status) {
  if (!status || status === "Active") return "";
  if (status === "Sold") {
    return `<div class="status-banner status-banner--sold">SOLD</div>`;
  }
  if (IN_MOTION.has(status)) {
    return `<div class="status-banner status-banner--in-motion">${status.toUpperCase()}</div>`;
  }
  return "";
}
```

- [ ] **Step 2: Commit**

```bash
git add src/js/status-banner.js
git commit -m "feat: status banner HTML helper"
```

---

## Task 11: Render banner in card grid

**Files:**
- Modify: `src/js/cards.js:1-3` (imports)
- Modify: `src/js/cards.js:36-49` (renderCard image wrap)

- [ ] **Step 1: Add the import**

At the top of `src/js/cards.js`, after the existing imports, add:

```javascript
import { statusBannerHtml } from "./status-banner.js";
```

The first three lines should now read:
```javascript
import { formatPrice, formatLotSize, getDaysOnMarket } from "./utils.js";
import { patchState } from "./api.js";
import { state, getStatusFlags } from "./app.js";
import { statusBannerHtml } from "./status-banner.js";
```

- [ ] **Step 2: Insert the banner inside `.card-image-wrap`**

In `renderCard`, immediately after the `<div class="card-price-tag">${formatPrice(h.price)}</div>` line (currently line 48), add:

```javascript
        ${statusBannerHtml(h.status)}
```

The `.card-image-wrap` block should look like:

```javascript
      <div class="card-image-wrap">
        <img src="${h.images[0]}" alt="${h.address}" loading="lazy">
        <div class="card-image-overlay"></div>
        <div class="card-top-actions">
          ...buttons...
        </div>
        <div class="card-price-tag">${formatPrice(h.price)}</div>
        ${statusBannerHtml(h.status)}
      </div>
```

- [ ] **Step 3: Confirm `.card-image-wrap` has `position: relative` (banner uses absolute positioning)**

```bash
grep -n "\.card-image-wrap" src/css/styles.css
```

If you don't see `position: relative` on the rule, add it. (It's likely already there since `.card-image-overlay` and `.card-price-tag` are absolutely positioned within it — but verify.)

- [ ] **Step 4: Build and smoke-test**

```bash
npm run dev
```

Open the dev URL, log in, and look at the card grid. On any property where `houses/{id}.json` has `"status"` set to a non-Active value, you should see the colored banner in the lower-right of the image. For Active or missing status, no banner.

If no property has a non-Active status yet, you can manually edit one JSON to `"status": "Pending"` temporarily, refresh, confirm the banner appears, then `git checkout` that file before committing.

- [ ] **Step 5: Commit**

```bash
git add src/js/cards.js
git commit -m "feat: render status banner on property cards"
```

---

## Task 12: Render banner in detail gallery

**Files:**
- Modify: `src/index.njk:108-118` (gallery markup)
- Modify: `src/js/detail.js:1-15` (imports)
- Modify: `src/js/detail.js:62-66` (openDetail body)

The detail gallery's main image lives in `index.njk` (not built by JS). Add an empty banner element to the template and let `detail.js` populate it.

- [ ] **Step 1: Add the banner element to the template**

In `src/index.njk`, inside `<div class="detail-gallery" id="detailGallery">` (line 108), after `<img id="galleryMainImg">` (line 109), insert:

```html
      <div id="detailStatusBanner"></div>
```

The block should look like:

```html
    <div class="detail-gallery" id="detailGallery">
      <img id="galleryMainImg" src="" alt="">
      <div id="detailStatusBanner"></div>
      <button class="gallery-nav prev" onclick="galleryPrev()" style="display:none" id="galleryPrev">
      ...
```

- [ ] **Step 2: Ensure `#detailGallery` is a positioning context**

```bash
grep -n "\.detail-gallery\|#detailGallery" src/css/styles.css
```

If the rule doesn't include `position: relative`, add it. The status banner uses `position: absolute` and needs an anchor.

- [ ] **Step 3: Import the helper in detail.js**

At the top of `src/js/detail.js`, add the import (alongside existing imports):

```javascript
import { statusBannerHtml } from "./status-banner.js";
```

- [ ] **Step 4: Populate the banner in openDetail**

In `src/js/detail.js`, in `openDetail` (or wherever `document.getElementById("galleryMainImg").src = h.images[0];` is set, around line 65), add immediately after that line:

```javascript
  document.getElementById("detailStatusBanner").innerHTML = statusBannerHtml(h.status);
```

- [ ] **Step 5: Build and verify**

```bash
npm run dev
```

Click into a property with a non-Active status. The banner appears in the lower-right of the gallery image. Navigate photos via prev/next — banner remains.

- [ ] **Step 6: Commit**

```bash
git add src/index.njk src/js/detail.js
git commit -m "feat: render status banner over detail gallery image"
```

---

## Task 13: Render banner in comparison view

**Files:**
- Modify: `src/js/comparison.js:1-10` (imports — check the actual import block)
- Modify: `src/js/comparison.js:35-44` (comparison-images template)

- [ ] **Step 1: Add the import**

At the top of `src/js/comparison.js`, add:

```javascript
import { statusBannerHtml } from "./status-banner.js";
```

- [ ] **Step 2: Insert the banner inside each comparison image card**

In the `comparison-images` template (around line 36-44), modify the per-item block:

Replace:

```javascript
      ${items.map((h) => `
        <div class="comparison-img-card">
          <img src="${h.images[0]}" alt="${h.address}">
          <div class="comparison-img-info">
            <div class="comparison-img-price">${formatPrice(h.price)}</div>
            <div class="comparison-img-addr">${h.address}, ${h.city}</div>
          </div>
        </div>
      `).join("")}
```

With:

```javascript
      ${items.map((h) => `
        <div class="comparison-img-card">
          <img src="${h.images[0]}" alt="${h.address}">
          ${statusBannerHtml(h.status)}
          <div class="comparison-img-info">
            <div class="comparison-img-price">${formatPrice(h.price)}</div>
            <div class="comparison-img-addr">${h.address}, ${h.city}</div>
          </div>
        </div>
      `).join("")}
```

- [ ] **Step 3: Confirm `.comparison-img-card` is a positioning context**

```bash
grep -n "\.comparison-img-card" src/css/styles.css
```

If the rule doesn't have `position: relative`, add it.

- [ ] **Step 4: Build and verify**

```bash
npm run dev
```

Open the comparison view with 2–3 properties where at least one has a non-Active status. The banner appears on that property's image.

- [ ] **Step 5: Commit**

```bash
git add src/js/comparison.js
git commit -m "feat: render status banner in comparison view"
```

---

## Task 14: End-to-end smoke test + final commit

**Files:** none modified

- [ ] **Step 1: Clean build from scratch**

```bash
rm -rf _site
npm run build
```

Expected output sequence:
1. `Cleaning up deleted properties...` (from sync-kv)
2. `Checking for new address stubs...`
3. `Pulling mutable state...`
4. `Refreshing listing statuses...` ← new
5. Per-property status lines
6. `Status refresh complete.`
7. Eleventy build output (page generation)
8. Build succeeds.

- [ ] **Step 2: Run dev server and click through the app**

```bash
npm run dev
```

Verify in the browser:
- Card grid: banner appears only on non-Active / non-null status cards
- Click a non-Active property → banner appears on the detail gallery image
- Add 2–3 properties to comparison → banner appears on those with a status
- Properties without a `status` field show no banner anywhere
- Marking a property `Rejected` moves it to the Rejected section (existing behavior); next `npm run build` skips it in refresh-status logs

- [ ] **Step 3: Run parser tests one more time**

```bash
node scripts/test-status-parser.js
```

Expected: all tests pass.

- [ ] **Step 4: Final commit (only if anything outstanding)**

```bash
git status
```

If clean, you're done. If not, review and commit:

```bash
git add -A
git commit -m "chore: tidy up after status banner implementation"
```

---

## Notes on rolling out

- First build after merge will populate `status` on every non-rejected property. JSON files will all be touched. The diff will be noisy; that's fine.
- If a Redfin URL 404s (delisted), `refresh-status.js` logs an error and leaves the prior status. To clean up these properties, just `Reject` them in the UI; they'll be skipped on the next build.
- If Redfin starts blocking scraping (403s), the build still succeeds — every property keeps its prior status. Investigate UA / rate / signed cookies at that point.
