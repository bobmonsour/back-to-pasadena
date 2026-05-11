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

export function parseStatus(_html) {
  // Implemented progressively in subsequent tasks.
  return null;
}
