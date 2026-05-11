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
