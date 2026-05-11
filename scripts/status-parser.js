// scripts/status-parser.js

export const STATUSES = ["Active", "Pending", "Contingent", "Under Contract", "Sold", "Coming Soon", "Off Market"];

// Map a free-form status string (from any detection source) to a canonical
// value, or null if unrecognized. Substring-matched with priority order —
// more specific phrases must be checked before more general ones.
export function normalizeStatus(raw) {
  if (!raw || typeof raw !== "string") return null;
  const s = raw.toLowerCase().trim();
  if (!s) return null;

  if (s.includes("coming soon")) return "Coming Soon";
  if (s.includes("active under contract")) return "Contingent";
  if (s.includes("under contract")) return "Under Contract";
  if (s.includes("backup offers")) return "Pending";
  if (s.includes("pending")) return "Pending";
  if (s.includes("contingent")) return "Contingent";
  if (s.includes("closed sale")) return "Sold";
  if (s.startsWith("closed")) return "Sold";
  if (s.includes("sold")) return "Sold";
  if (s.includes("withdrawn") || s.includes("cancelled") || s.includes("off market") || s.includes("off-market")) return "Off Market";
  if (/\bactive\b/i.test(s) || s.includes("for sale")) return "Active";
  return null;
}

// Detect status from the mlsStatusDisplay.displayValue key in Redfin's embedded JSON.
// The literal bytes look like: mlsStatusDisplay\":{\"displayValue\":\"Active\"
// (escaped quotes inside a JSON string). This is the most reliable source.
function detectFromMlsStatusDisplay(html) {
  if (!html || typeof html !== "string") return null;
  const match = html.match(/mlsStatusDisplay\\":\{\\"displayValue\\":\\"([^\\]+)/);
  if (!match) return null;
  return normalizeStatus(match[1]);
}

export function parseStatus(html) {
  return detectFromMlsStatusDisplay(html) || null;
}
