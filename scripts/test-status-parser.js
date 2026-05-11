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

console.log("normalizeStatus:");
test("canonical Redfin displayValues map correctly", () => {
  assert.equal(normalizeStatus("Active"), "Active");
  assert.equal(normalizeStatus("Pending Sale"), "Pending");
  assert.equal(normalizeStatus("Active Under Contract"), "Contingent");
  assert.equal(normalizeStatus("Under Contract"), "Under Contract");
  assert.equal(normalizeStatus("Closed Sale"), "Sold");
  assert.equal(normalizeStatus("Closed"), "Sold");
  assert.equal(normalizeStatus("Sold"), "Sold");
  assert.equal(normalizeStatus("Backup Offers Accepted"), "Pending");
  assert.equal(normalizeStatus("Coming Soon"), "Coming Soon");
});
test("case-insensitive and trims", () => {
  assert.equal(normalizeStatus("PENDING"), "Pending");
  assert.equal(normalizeStatus("  Sold  "), "Sold");
  assert.equal(normalizeStatus("active under contract"), "Contingent");
});
test("off-market variants", () => {
  assert.equal(normalizeStatus("Off Market"), "Off Market");
  assert.equal(normalizeStatus("off-market"), "Off Market");
  assert.equal(normalizeStatus("Withdrawn"), "Off Market");
});
test("returns null for unknown / empty", () => {
  assert.equal(normalizeStatus(""), null);
  assert.equal(normalizeStatus(null), null);
  assert.equal(normalizeStatus(undefined), null);
  assert.equal(normalizeStatus("Random Words"), null);
  assert.equal(normalizeStatus(123), null);
});
test("does not false-positive on inactive / deactivated", () => {
  assert.equal(normalizeStatus("inactive"), null);
  assert.equal(normalizeStatus("This listing is inactive"), null);
  assert.equal(normalizeStatus("deactivated account"), null);
});

console.log("\nparseStatus (embedded JSON):");
const fixtureExpectations = [
  ["active.html", "Active"],
  ["pending.html", "Pending"],
  ["contingent.html", "Contingent"],
  ["sold.html", "Sold"],
  ["closed-sale.html", "Sold"],
  ["backup-offers.html", "Pending"],
];
for (const [filename, expected] of fixtureExpectations) {
  test(`${filename} → ${expected}`, () => {
    assert.equal(parseStatus(loadFixture(filename)), expected);
  });
}

console.log("\nparseStatus (JSON-LD fallback):");
test("JSON-LD OutOfStock → Sold when no mlsStatusDisplay", () => {
  const html = `<html><script type="application/ld+json">${JSON.stringify({offers:{availability:"https://schema.org/OutOfStock"}})}</script></html>`;
  assert.equal(parseStatus(html), "Sold");
});
test("JSON-LD InStock → null (ambiguous; primary detector should win)", () => {
  const html = `<html><script type="application/ld+json">${JSON.stringify({offers:{availability:"https://schema.org/InStock"}})}</script></html>`;
  assert.equal(parseStatus(html), null);
});
test("JSON-LD availability inside mainEntity.offers also works", () => {
  const html = `<html><script type="application/ld+json">${JSON.stringify({mainEntity:{offers:{availability:"https://schema.org/OutOfStock"}}})}</script></html>`;
  assert.equal(parseStatus(html), "Sold");
});
test("malformed JSON-LD blocks are skipped silently", () => {
  const html = `<html><script type="application/ld+json">{not json}</script><script type="application/ld+json">${JSON.stringify({offers:{availability:"https://schema.org/OutOfStock"}})}</script></html>`;
  assert.equal(parseStatus(html), "Sold");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
