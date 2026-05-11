import { formatPrice, formatLotSize, getDaysOnMarket } from "./utils.js";
import { state } from "./app.js";
import { statusBannerHtml } from "./status-banner.js";

export function openComparison() {
  if (state.compareSet.size < 2) return alert("Select 2-3 properties to compare by clicking the grid icon on each card.");
  const items = [...state.compareSet].map((id) => state.houses.find((x) => x.id === id));
  const cols = items.length === 2 ? "cols-2" : "cols-3";

  const rows = [
    ["Price", (h) => formatPrice(h.price), "min"],
    ["Bedrooms", (h) => h.beds, "max"],
    ["Bathrooms", (h) => h.baths, "max"],
    ["Square Feet", (h) => h.sqft.toLocaleString(), "max", (h) => h.sqft],
    ["Lot Size", (h) => formatLotSize(h.lotSize), "max", (h) => h.lotSize || 0],
    ["Year Built", (h) => h.yearBuilt, "max"],
    ["Days on Market", (h) => getDaysOnMarket(h.dateListed), "min"],
    ["Sidewalks", (h) => h.sidewalks === true ? "Present" : h.sidewalks === false ? "Not Present" : "Unknown"],
    ["Street Trees", (h) => h.streetTrees === true ? "Present" : h.streetTrees === false ? "Not Present" : "Unknown"],
    ["Corner Lot", (h) => h.corner === true ? "Yes" : h.corner === false ? "No" : "Unknown"],
    ["Road Noise", (h) => h.roadNoise === true ? "Yes" : h.roadNoise === false ? "No" : "Unknown"],
    ["Stories", (h) => h.stories === 1 ? "1-Story" : h.stories === 2 ? "2-Story" : "Unknown"],
    ["Peep Rating", (h) => h.peepRating ? `${h.peepRating.avgMiles} / ${h.peepRating.avgTime} avg` : "—"],
    ["Park Proximity", (h) => h.parkProximity],
    ["Flood Risk", (h) => h.floodRisk],
    ["Fire Risk", (h) => h.fireRisk],
    ["Crime Rating", (h) => h.crimeRating],
    ["Redfin Estimate", (h) => formatPrice(h.estimates.redfin)],
    ...items[0].distances.map((d) => [d.name, (h) => {
      const dist = h.distances.find((x) => x.name === d.name);
      return dist ? `${dist.miles} (${dist.time})` : "\u2014";
    }]),
  ];

  document.getElementById("comparisonBody").innerHTML = `
    <div class="comparison-images ${cols}">
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
    </div>
    <table class="comparison-table">
      ${rows.map(([label, fn]) => `
        <tr>
          <th>${label}</th>
          ${items.map((h) => `<td>${fn(h)}</td>`).join("")}
        </tr>
      `).join("")}
    </table>
  `;

  document.getElementById("comparisonOverlay").classList.add("open");
  document.body.style.overflow = "hidden";
}

export function closeComparison() {
  document.getElementById("comparisonOverlay").classList.remove("open");
  document.body.style.overflow = "";
}
