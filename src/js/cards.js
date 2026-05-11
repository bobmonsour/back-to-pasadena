import { formatPrice, formatLotSize, getDaysOnMarket } from "./utils.js";
import { patchState } from "./api.js";
import { state, getStatusFlags } from "./app.js";
import { statusBannerHtml } from "./status-banner.js";

export function getFilteredSortedHouses() {
  let h = [...state.houses];
  const q = document.getElementById("searchInput").value.toLowerCase();
  if (q) h = h.filter((x) => (x.address + " " + x.city).toLowerCase().includes(q));
  if (state.showFavsOnly) h = h.filter((x) => x.favorite);
  if (state.statusFilter.size > 0) h = h.filter((x) => {
    const flags = getStatusFlags(x);
    return [...state.statusFilter].every((f) => flags.includes(f));
  });

  h.sort((a, b) => {
    let va, vb;
    switch (state.currentSort) {
      case "price": va = a.price; vb = b.price; break;
      case "sqft": va = a.sqft; vb = b.sqft; break;
      case "beds": va = a.beds; vb = b.beds; break;
      case "baths": va = a.baths; vb = b.baths; break;
      case "age": va = a.yearBuilt; vb = b.yearBuilt; break;
      case "added": va = new Date(a.dateAdded); vb = new Date(b.dateAdded); break;
      case "listed": va = new Date(a.dateListed); vb = new Date(b.dateListed); break;
      case "dom": va = getDaysOnMarket(a.dateListed); vb = getDaysOnMarket(b.dateListed); break;
      case "peep": va = parseFloat(a.peepRating?.avgMiles) || 999; vb = parseFloat(b.peepRating?.avgMiles) || 999; break;
      default: va = new Date(a.dateAdded); vb = new Date(b.dateAdded);
    }
    return state.currentSortDir === "asc" ? va - vb : vb - va;
  });
  return h;
}

function renderCard(h) {
  return `
    <div class="house-card" onclick="openDetail(${h.id})" data-id="${h.id}">
      <div class="card-image-wrap">
        <img src="${h.images[0]}" alt="${h.address}" loading="lazy">
        <div class="card-image-overlay"></div>
        <div class="card-top-actions">
          <button class="card-fav-btn ${h.favorite ? "favorited" : ""}" onclick="event.stopPropagation(); toggleFav(${h.id})" title="Favorite">
            <svg viewBox="0 0 24 24" fill="${h.favorite ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          </button>
          <button class="card-compare-btn ${state.compareSet.has(h.id) ? "selected" : ""}" onclick="event.stopPropagation(); toggleCompare(${h.id})" title="Add to comparison">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
          </button>
        </div>
        <div class="card-price-tag">${formatPrice(h.price)}</div>
        ${statusBannerHtml(h.status)}
      </div>
      <div class="card-body">
        <div class="card-address"><a href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(h.address + ", " + h.city)}" target="_blank" onclick="event.stopPropagation()" style="color:inherit;text-decoration:none;border-bottom:1px dashed var(--text-tertiary)">${h.address}</a></div>
        ${h.peepRating?.avgMiles ? `<div class="card-peep-rating">Peep Rating: ${h.peepRating.avgMiles} avg</div>` : ""}
        <div class="card-city">${h.city}</div>
        <div class="card-stats">
          <div class="card-stat"><span class="card-stat-value">${h.beds}</span><span class="card-stat-label">Beds</span></div>
          <div class="card-stat"><span class="card-stat-value">${h.baths}</span><span class="card-stat-label">Baths</span></div>
          <div class="card-stat"><span class="card-stat-value">${h.sqft.toLocaleString()}</span><span class="card-stat-label">Sq Ft</span></div>
          <div class="card-stat"><span class="card-stat-value">${formatLotSize(h.lotSize)}</span><span class="card-stat-label">Lot</span></div>
          <div class="card-stat"><span class="card-stat-value">${h.yearBuilt}</span><span class="card-stat-label">Built</span></div>
          <div class="card-stat"><span class="card-stat-value">${getDaysOnMarket(h.dateListed)}</span><span class="card-stat-label">DOM</span></div>
        </div>
      </div>
      <div class="card-footer">
        <div class="card-footer-left">
          ${getStatusFlags(h).map((f) => `<span class="status-badge" data-status="${f}">${f === "offer" ? "Offer Made" : f.charAt(0).toUpperCase() + f.slice(1)}</span>`).join("")}
        </div>
        ${(h.listingUrl && h.listingUrl !== "#") || (h.redfinUrl && h.redfinUrl !== "#") ? `<a href="${h.listingUrl && h.listingUrl !== "#" ? h.listingUrl : h.redfinUrl}" class="card-redfin-link" onclick="event.stopPropagation()">
          View Listing <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
        </a>` : ""}

      </div>
    </div>
  `;
}

export function renderCards() {
  const grid = document.getElementById("cardGrid");
  const filtered = getFilteredSortedHouses();
  const active = filtered.filter((h) => !h.rejected);
  const rejected = filtered.filter((h) => h.rejected);
  document.getElementById("houseCount").textContent = filtered.length;
  const countEl = document.getElementById("statusFilterCount");
  if (state.statusFilter.size > 0) {
    countEl.textContent = `${active.length} match${active.length !== 1 ? "es" : ""}`;
    countEl.style.display = "";
  } else {
    countEl.textContent = "";
    countEl.style.display = "none";
  }

  grid.innerHTML = active.map(renderCard).join("");

  let rejectedEl = document.getElementById("rejectedSection");
  if (rejected.length) {
    if (!rejectedEl) {
      rejectedEl = document.createElement("div");
      rejectedEl.id = "rejectedSection";
      rejectedEl.className = "rejected-section";
      grid.after(rejectedEl);
    }
    rejectedEl.innerHTML = `<div class="rejected-section-inner"><div class="rejected-section-label">Rejected</div><div class="rejected-section-grid">${rejected.map(renderCard).join("")}</div></div>`;
    rejectedEl.style.display = "";
  } else if (rejectedEl) {
    rejectedEl.style.display = "none";
  }
}

export async function toggleFav(id) {
  const h = state.houses.find((x) => x.id === id);
  h.favorite = !h.favorite;
  renderCards();
  patchState(id, { favorite: h.favorite }).catch(console.error);
}

export function toggleCompare(id) {
  if (state.compareSet.has(id)) {
    state.compareSet.delete(id);
  } else if (state.compareSet.size < 3) {
    state.compareSet.add(id);
  }
  updateCompareCount();
  renderCards();
}

export function updateCompareCount() {
  const el = document.getElementById("compareCount");
  el.textContent = state.compareSet.size;
  el.classList.toggle("visible", state.compareSet.size > 0);
}

export function toggleFavFilter() {
  state.showFavsOnly = !state.showFavsOnly;
  document.getElementById("favFilterBtn").classList.toggle("active", state.showFavsOnly);
  renderCards();
}

export function toggleStatusFilter(val) {
  if (state.statusFilter.has(val)) {
    state.statusFilter.delete(val);
  } else {
    state.statusFilter.add(val);
  }
  document.querySelectorAll(".status-filter-checkbox input").forEach((cb) => {
    cb.checked = state.statusFilter.has(cb.dataset.status);
  });
  renderCards();
}

export function filterCards() {
  renderCards();
}

export function toggleSortDropdown() {
  document.getElementById("sortDropdown").classList.toggle("open");
}

export function sortBy(field) {
  if (state.currentSort === field) {
    state.currentSortDir = state.currentSortDir === "asc" ? "desc" : "asc";
  } else {
    state.currentSort = field;
    state.currentSortDir = (field === "price" || field === "peep") ? "asc" : "desc";
  }
  const labels = { added: "Date Added", price: "Price", sqft: "Sq Ft", beds: "Beds", baths: "Baths", age: "Year Built", listed: "Date Listed", dom: "DOM", peep: "Peep Rating" };
  document.getElementById("sortLabel").textContent = `Sort: ${labels[field]}`;
  document.querySelectorAll(".sort-option").forEach((el) => el.classList.remove("active"));
  // Mark the clicked option as active
  const options = document.querySelectorAll(".sort-option");
  const fieldOrder = ["peep", "added", "price", "sqft", "beds", "baths", "age", "listed", "dom"];
  const idx = fieldOrder.indexOf(field);
  if (idx >= 0 && options[idx]) options[idx].classList.add("active");
  document.getElementById("sortDropdown").classList.remove("open");
  renderCards();
}
