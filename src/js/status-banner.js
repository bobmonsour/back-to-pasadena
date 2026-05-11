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
