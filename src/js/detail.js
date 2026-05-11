import { formatPrice, formatLotSize, getDaysOnMarket } from "./utils.js";
import { patchState } from "./api.js";
import { state } from "./app.js";
import { renderCards } from "./cards.js";
import { statusBannerHtml } from "./status-banner.js";

let galleryIndex = 0;

// Touch swipe support
let swipeOccurred = false;
function addSwipe(el, onLeft, onRight) {
  let startX = 0;
  let startY = 0;
  el.addEventListener("touchstart", (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    swipeOccurred = false;
  }, { passive: true });
  el.addEventListener("touchend", (e) => {
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      swipeOccurred = true;
      if (dx < 0) onLeft();
      else onRight();
    }
  }, { passive: true });
}

addSwipe(
  document.getElementById("detailGallery"),
  () => galleryNext(),
  () => galleryPrev()
);

addSwipe(
  document.getElementById("lightbox"),
  () => { lightboxNext(); },
  () => { lightboxPrev(); }
);

export function openDetail(id, preserveGallery = false) {
  state.currentDetailId = id;
  if (!preserveGallery) galleryIndex = 0;
  const h = state.houses.find((x) => x.id === id);
  if (!h) return;

  // Show detail page, hide card grid and toolbar
  document.getElementById("detailPage").style.display = "";
  document.getElementById("cardGrid").style.display = "none";
  const rejSec = document.getElementById("rejectedSection");
  if (rejSec) rejSec.style.display = "none";
  document.querySelector(".toolbar").style.display = "none";

  // Update hash without triggering hashchange
  const expected = `#property/${id}`;
  if (location.hash !== expected) {
    history.pushState(null, "", expected);
  }

  if (!preserveGallery) window.scrollTo(0, 0);

  document.getElementById("statusVisited").checked = !!h.visited;
  document.getElementById("statusOffer").checked = !!h.offer;
  document.getElementById("statusRejected").checked = !!h.rejected;
  document.getElementById("galleryMainImg").src = h.images[0];
  document.getElementById("detailStatusBanner").innerHTML = statusBannerHtml(h.status);

  // Set up gallery controls
  const hasMultiple = h.images.length > 1;
  document.getElementById("galleryPrev").style.display = hasMultiple ? "" : "none";
  document.getElementById("galleryNext").style.display = hasMultiple ? "" : "none";
  document.getElementById("galleryCounter").style.display = hasMultiple ? "" : "none";
  if (hasMultiple) {
    updateGalleryUI(h);
  } else {
    document.getElementById("galleryDots").innerHTML = "";
  }

  const riskClass = (r) =>
    r.startsWith("Very Low") || r.startsWith("Low") ? "risk-low" : r.startsWith("Moderate") || r.startsWith("Medium") ? "risk-medium" : "risk-high";

  document.getElementById("detailContent").innerHTML = `
    <div class="detail-header">
      <div class="detail-price-row">
        <div class="detail-price">${formatPrice(h.price)}</div>
        <div class="detail-estimates-inline">
          <div class="detail-estimate-item"><span class="detail-estimate-label">Redfin Est.</span><span class="detail-estimate-val">${formatPrice(h.estimates.redfin)}</span></div>
        </div>
      </div>
      <div class="detail-address-line"><a href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(h.address + ", " + h.city)}" target="_blank" style="color:inherit;text-decoration:none;border-bottom:1px dashed var(--text-tertiary);transition:border-color 0.2s ease" onmouseover="this.style.borderBottomColor='var(--accent)'" onmouseout="this.style.borderBottomColor='var(--text-tertiary)'">${h.address}</a></div>
      <div class="detail-city-line">${h.city}</div>
      ${h.peepRating ? `<div class="detail-peep-rating">Peep Rating: ${h.peepRating.avgMiles} / ${h.peepRating.avgTime} avg</div>
      <details class="peep-dropdown">
        <summary>Show distances to peeps</summary>
        <div class="peep-list">
          ${[...h.peepRating.distances].sort((a, b) => parseFloat(a.driving?.miles || a.miles || "999") - parseFloat(b.driving?.miles || b.miles || "999")).map((p) => {
            const origin = encodeURIComponent(h.address + ", " + h.city);
            const dest = `${p.lat},${p.lon}`;
            const driving = p.driving || { miles: p.miles || "—", time: p.time || "—" };
            const walking = p.walking || { miles: "—", time: "—" };
            return `<div class="peep-row">
              <span class="peep-name">${p.name}</span>
              <span class="peep-distances">
                <a href="https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&travelmode=driving" target="_blank" class="peep-link" title="Driving directions">\u{1F697} ${driving.miles} / ${driving.time}</a>
                <a href="https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&travelmode=walking" target="_blank" class="peep-link" title="Walking directions">\u{1F6B6} ${walking.miles} / ${walking.time}</a>
              </span>
            </div>`;
          }).join("")}
        </div>
      </details>` : ""}
      <div class="detail-listing-links">
        ${(h.listingUrl && h.listingUrl !== "#") || (h.redfinUrl && h.redfinUrl !== "#") ? `<a href="${h.listingUrl && h.listingUrl !== "#" ? h.listingUrl : h.redfinUrl}" class="detail-redfin-link" target="_blank">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
          View Listing${h.listingSource ? ` on ${h.listingSource.charAt(0).toUpperCase() + h.listingSource.slice(1)}` : ""}
        </a>` : ""}
      </div>
    </div>

    <div class="detail-key-stats">
      <div class="detail-key-stat"><div class="detail-key-stat-value">${h.beds}</div><div class="detail-key-stat-label">Bedrooms</div></div>
      <div class="detail-key-stat"><div class="detail-key-stat-value">${h.baths}</div><div class="detail-key-stat-label">Bathrooms</div></div>
      <div class="detail-key-stat"><div class="detail-key-stat-value">${h.sqft.toLocaleString()}</div><div class="detail-key-stat-label">Square Feet</div></div>
      <div class="detail-key-stat"><div class="detail-key-stat-value">${formatLotSize(h.lotSize)}</div><div class="detail-key-stat-label">Lot Size</div></div>
      <div class="detail-key-stat"><div class="detail-key-stat-value">${h.yearBuilt}</div><div class="detail-key-stat-label">Year Built</div></div>
      <div class="detail-key-stat"><div class="detail-key-stat-value">${getDaysOnMarket(h.dateListed)}</div><div class="detail-key-stat-label">Days on Market</div></div>
    </div>

    <div class="detail-section">
      <h3 class="detail-section-title">Neighborhood</h3>
      <p style="font-size:0.92rem;color:var(--text-secondary);line-height:1.7;padding:0 2px">${h.neighborhood}</p>
    </div>

    <div class="detail-section">
      <h3 class="detail-section-title">Property Details</h3>
      <div class="info-grid">
        <div class="info-item"><span class="info-item-label">Character Home</span><span class="info-item-value">${renderCharacterHome(h)}</span></div>
        <div class="info-item"><span class="info-item-label">Sidewalks</span><span class="info-item-value">${renderSidewalks(h)}</span></div>
        <div class="info-item"><span class="info-item-label">Street Trees</span><span class="info-item-value">${renderStreetTrees(h)}</span></div>
        <div class="info-item"><span class="info-item-label">Corner Lot</span><span class="info-item-value">${renderCorner(h)}</span></div>
        <div class="info-item"><span class="info-item-label">Road Noise</span><span class="info-item-value">${renderRoadNoise(h)}</span></div>
        <div class="info-item"><span class="info-item-label">Stories</span><span class="info-item-value">${renderStories(h)}</span></div>
        <div class="info-item"><span class="info-item-label">Condition</span><span class="info-item-value">${renderCondition(h)}</span></div>
        <div class="info-item"><span class="info-item-label">Suitable Backyard</span><span class="info-item-value">${renderBackyard(h)}</span></div>
        <div class="info-item"><span class="info-item-label">Studio Space</span><span class="info-item-value">${renderStudio(h)}</span></div>
        <div class="info-item"><span class="info-item-label">2 Sinks</span><span class="info-item-value">${renderTwoSinks(h)}</span></div>
        <div class="info-item"><span class="info-item-label">Master Walk-in Shower</span><span class="info-item-value">${renderWalkInShower(h)}</span></div>
        <div class="info-item"><span class="info-item-label">Wall Ovens</span><span class="info-item-value">${renderWallOvens(h)}</span></div>
        <div class="info-item"><span class="info-item-label">Pool</span><span class="info-item-value">${renderPool(h)}</span></div>
        <div class="info-item"><span class="info-item-label">Garage</span><span class="info-item-value">${renderGarage(h)}</span></div>
        ${h.peepRating ? `<div class="info-item"><span class="info-item-label">Peep Rating</span><span class="info-item-value">${h.peepRating.avgMiles} / ${h.peepRating.avgTime} avg driving</span></div>` : ""}
        <div class="info-item"><span class="info-item-label">Parks Nearby</span><span class="info-item-value">${h.parkProximity}</span></div>
        <div class="info-item"><span class="info-item-label">Flood Risk</span><span class="info-item-value ${riskClass(h.floodRisk)}">${h.floodRisk}</span></div>
        <div class="info-item"><span class="info-item-label">Fire Risk</span><span class="info-item-value ${riskClass(h.fireRisk)}">${h.fireRisk} <a href="https://egis.fire.ca.gov/FHSZ/" target="_blank" style="color:var(--accent);text-decoration:underline;font-size:0.82rem;margin-left:4px">CAL FIRE Map</a></span></div>
        <div class="info-item" style="grid-column:1/-1"><span class="info-item-label">Crime Rating</span><span class="info-item-value ${riskClass(h.crimeRating)}">${h.crimeRating.replace("CrimeGrade.org", '<a href="https://crimegrade.org" target="_blank" style="color:var(--accent);text-decoration:underline">CrimeGrade.org</a>')}</span></div>
      </div>
    </div>

    <div class="detail-section">
      <h3 class="detail-section-title">Driving Distances</h3>
      <div class="distance-list">
        ${h.distances.map((d) => `
          <div class="distance-item">
            <a class="distance-name" href="#" onclick="event.preventDefault(); openMapOverlay('${h.address}, ${h.city}', '${(d.address || d.name).replace(/'/g, "\\'")}')">${d.name}</a>
            <div class="distance-values">
              <span class="distance-miles">${d.miles}</span>
              <span class="distance-time">${d.time}</span>
            </div>
          </div>
        `).join("")}
      </div>
    </div>

    <div class="detail-section">
      <h3 class="detail-section-title">Price History</h3>
      <div class="price-history">
        ${h.priceHistory.map((e) => `
          <div class="price-event">
            <div class="price-event-dot ${e.type}"></div>
            <div class="price-event-info"><div class="price-event-label">${e.label}</div><div class="price-event-date">${e.date}</div></div>
            <div class="price-event-amount">${formatPrice(e.amount)}</div>
          </div>
        `).join("")}
      </div>
    </div>

    <div class="detail-section">
      <h3 class="detail-section-title">Listing Agent</h3>
      <div class="agent-card">
        <div class="agent-avatar">${h.agent.name.split(" ").map((n) => n[0]).join("")}</div>
        <div class="agent-details">
          <div class="agent-name">${h.agent.name}</div>
          <div class="agent-contact">${h.agent.phone} &middot; ${h.agent.email}</div>
        </div>
      </div>
    </div>

    <div class="detail-section">
      <h3 class="detail-section-title">Notes</h3>
      <textarea class="notes-area" id="notesArea" placeholder="Add your notes about this property...">${h.notes}</textarea>
      <button class="notes-save" onclick="saveNotes()">Save Notes</button>
    </div>

    <div class="detail-section" style="border-top:1px solid var(--border);padding-top:24px;margin-top:8px">
      <button class="detail-delete-btn" onclick="deleteProperty(${h.id})">Delete Property</button>
    </div>
  `;

}

export function closeDetail() {
  if (state.cardsDirty) {
    renderCards();
    state.cardsDirty = false;
  }
  document.getElementById("detailPage").style.display = "none";
  document.getElementById("cardGrid").style.display = "";
  const rejSec = document.getElementById("rejectedSection");
  if (rejSec) rejSec.style.display = "";
  document.querySelector(".toolbar").style.display = "";
  if (location.hash.startsWith("#property/")) {
    history.pushState(null, "", location.pathname + location.search);
  }
  state.currentDetailId = null;
  window.scrollTo(0, 0);
}

export async function toggleStatusFlag(flag) {
  if (!state.currentDetailId) return;
  const h = state.houses.find((x) => x.id === state.currentDetailId);
  h[flag] = !h[flag];
  state.cardsDirty = true;
  document.getElementById(`status${flag.charAt(0).toUpperCase() + flag.slice(1)}`).checked = h[flag];
  patchState(state.currentDetailId, { [flag]: h[flag] }).catch(console.error);
}

export async function saveNotes() {
  if (!state.currentDetailId) return;
  const notes = document.getElementById("notesArea").value;
  state.houses.find((x) => x.id === state.currentDetailId).notes = notes;
  patchState(state.currentDetailId, { notes }).catch(console.error);
}

// Gallery
function updateGalleryUI(h) {
  document.getElementById("galleryMainImg").src = h.images[galleryIndex];
  document.getElementById("galleryCounter").textContent = `${galleryIndex + 1} / ${h.images.length}`;
  const dotsEl = document.getElementById("galleryDots");
  // Only show dots if 10 or fewer images, otherwise counter is enough
  if (h.images.length <= 10) {
    dotsEl.innerHTML = h.images.map((_, i) =>
      `<button class="gallery-dot ${i === galleryIndex ? "active" : ""}" onclick="galleryGo(${i})"></button>`
    ).join("");
  } else {
    dotsEl.innerHTML = "";
  }
}

export function galleryPrev() {
  const h = state.houses.find((x) => x.id === state.currentDetailId);
  galleryIndex = (galleryIndex - 1 + h.images.length) % h.images.length;
  updateGalleryUI(h);
}

export function galleryNext() {
  const h = state.houses.find((x) => x.id === state.currentDetailId);
  galleryIndex = (galleryIndex + 1) % h.images.length;
  updateGalleryUI(h);
}

export function galleryGo(i) {
  galleryIndex = i;
  updateGalleryUI(state.houses.find((x) => x.id === state.currentDetailId));
}

// Lightbox
function updateLightboxCounter() {
  const h = state.houses.find((x) => x.id === state.currentDetailId);
  if (h) document.getElementById("lightboxCounter").textContent = `${galleryIndex + 1} / ${h.images.length}`;
}

export function openLightbox(src) {
  document.getElementById("lightboxImg").src = src;
  document.getElementById("lightbox").classList.add("open");
  updateLightboxCounter();
}

export function closeLightbox() {
  if (swipeOccurred) { swipeOccurred = false; return; }
  document.getElementById("lightbox").classList.remove("open");
}

export function lightboxPrev() {
  galleryPrev();
  const h = state.houses.find((x) => x.id === state.currentDetailId);
  if (h) document.getElementById("lightboxImg").src = h.images[galleryIndex];
  updateLightboxCounter();
}

export function lightboxNext() {
  galleryNext();
  const h = state.houses.find((x) => x.id === state.currentDetailId);
  if (h) document.getElementById("lightboxImg").src = h.images[galleryIndex];
  updateLightboxCounter();
}

// Map overlay
export function openMapOverlay(origin, destination) {
  const key = window.__MAPS_KEY__;
  if (!key) {
    window.open(`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`, "_blank");
    return;
  }
  const src = `https://www.google.com/maps/embed/v1/directions?key=${encodeURIComponent(key)}&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&mode=driving`;
  document.getElementById("mapIframe").src = src;
  document.getElementById("mapOverlay").classList.add("open");
}

export function closeMapOverlay() {
  document.getElementById("mapOverlay").classList.remove("open");
  document.getElementById("mapIframe").src = "";
}

// Delete property
export async function deleteProperty(id) {
  const h = state.houses.find((x) => x.id === id);
  if (!confirm(`Delete "${h.address}"? This cannot be undone.`)) return;
  state.houses = state.houses.filter((x) => x.id !== id);
  state.compareSet.delete(id);
  closeDetail();
  renderCards();
  patchState(id, { deleted: true }).catch(console.error);
}

// Character Home
function renderCharacterHome(h) {
  const editIcon = `<button class="street-trees-edit-btn" onclick="event.stopPropagation(); toggleCharacterHomeEdit(${h.id})" title="Change"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`;
  if (h.characterHome === true) {
    return `Yes ${editIcon}`;
  } else if (h.characterHome === false) {
    return `No ${editIcon}`;
  } else {
    return `<div class="street-trees-toggle">
      <label onclick="setCharacterHome(${h.id}, true)"><input type="radio" name="characterHome${h.id}"> Yes</label>
      <label onclick="setCharacterHome(${h.id}, false)"><input type="radio" name="characterHome${h.id}"> No</label>
    </div>`;
  }
}

export async function setCharacterHome(id, value) {
  state.houses.find((x) => x.id === id).characterHome = value;
  patchState(id, { characterHome: value }).catch(console.error);
  if (state.currentDetailId === id) openDetail(id, true);
}

export function toggleCharacterHomeEdit(id) {
  state.houses.find((x) => x.id === id).characterHome = null;
  if (state.currentDetailId === id) openDetail(id, true);
}

// Sidewalks / Street Trees
function renderSidewalks(h) {
  const editIcon = `<button class="street-trees-edit-btn" onclick="event.stopPropagation(); toggleSidewalksEdit(${h.id})" title="Change"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`;
  if (h.sidewalks === true) {
    return `Present ${editIcon}`;
  } else if (h.sidewalks === false) {
    return `Not Present ${editIcon}`;
  } else {
    return `<div class="street-trees-toggle">
      <label onclick="setSidewalks(${h.id}, true)"><input type="radio" name="sidewalks${h.id}"> Present</label>
      <label onclick="setSidewalks(${h.id}, false)"><input type="radio" name="sidewalks${h.id}"> Not Present</label>
    </div>`;
  }
}

export async function setSidewalks(id, value) {
  state.houses.find((x) => x.id === id).sidewalks = value;
  patchState(id, { sidewalks: value }).catch(console.error);
  if (state.currentDetailId === id) openDetail(id, true);
}

export function toggleSidewalksEdit(id) {
  state.houses.find((x) => x.id === id).sidewalks = null;
  if (state.currentDetailId === id) openDetail(id, true);
}

function renderStreetTrees(h) {
  const editIcon = `<button class="street-trees-edit-btn" onclick="event.stopPropagation(); toggleStreetTreesEdit(${h.id})" title="Change"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`;
  if (h.streetTrees === true) {
    return `Present ${editIcon}`;
  } else if (h.streetTrees === false) {
    return `Not Present ${editIcon}`;
  } else {
    return `<div class="street-trees-toggle">
      <label onclick="setStreetTrees(${h.id}, true)"><input type="radio" name="streetTrees${h.id}"> Present</label>
      <label onclick="setStreetTrees(${h.id}, false)"><input type="radio" name="streetTrees${h.id}"> Not Present</label>
    </div>`;
  }
}

export async function setStreetTrees(id, value) {
  state.houses.find((x) => x.id === id).streetTrees = value;
  patchState(id, { streetTrees: value }).catch(console.error);
  if (state.currentDetailId === id) openDetail(id, true);
}

export function toggleStreetTreesEdit(id) {
  state.houses.find((x) => x.id === id).streetTrees = null;
  if (state.currentDetailId === id) openDetail(id, true);
}

// Corner Lot
function renderCorner(h) {
  const editIcon = `<button class="street-trees-edit-btn" onclick="event.stopPropagation(); toggleCornerEdit(${h.id})" title="Change"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`;
  if (h.corner === true) {
    return `Yes ${editIcon}`;
  } else if (h.corner === false) {
    return `No ${editIcon}`;
  } else {
    return `<div class="street-trees-toggle">
      <label onclick="setCorner(${h.id}, true)"><input type="radio" name="corner${h.id}"> Yes</label>
      <label onclick="setCorner(${h.id}, false)"><input type="radio" name="corner${h.id}"> No</label>
    </div>`;
  }
}

export async function setCorner(id, value) {
  state.houses.find((x) => x.id === id).corner = value;
  patchState(id, { corner: value }).catch(console.error);
  if (state.currentDetailId === id) openDetail(id, true);
}

export function toggleCornerEdit(id) {
  state.houses.find((x) => x.id === id).corner = null;
  if (state.currentDetailId === id) openDetail(id, true);
}

// Road Noise
function renderRoadNoise(h) {
  const editIcon = `<button class="street-trees-edit-btn" onclick="event.stopPropagation(); toggleRoadNoiseEdit(${h.id})" title="Change"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`;
  if (h.roadNoise === true) {
    return `Yes ${editIcon}`;
  } else if (h.roadNoise === false) {
    return `No ${editIcon}`;
  } else {
    return `<div class="street-trees-toggle">
      <label onclick="setRoadNoise(${h.id}, true)"><input type="radio" name="roadNoise${h.id}"> Yes</label>
      <label onclick="setRoadNoise(${h.id}, false)"><input type="radio" name="roadNoise${h.id}"> No</label>
    </div>`;
  }
}

export async function setRoadNoise(id, value) {
  state.houses.find((x) => x.id === id).roadNoise = value;
  patchState(id, { roadNoise: value }).catch(console.error);
  if (state.currentDetailId === id) openDetail(id, true);
}

export function toggleRoadNoiseEdit(id) {
  state.houses.find((x) => x.id === id).roadNoise = null;
  if (state.currentDetailId === id) openDetail(id, true);
}

// Stories
function renderStories(h) {
  const editIcon = `<button class="street-trees-edit-btn" onclick="event.stopPropagation(); toggleStoriesEdit(${h.id})" title="Change"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`;
  if (h.stories === 1) {
    return `1-Story ${editIcon}`;
  } else if (h.stories === 2) {
    return `2-Story ${editIcon}`;
  } else {
    return `<div class="street-trees-toggle">
      <label onclick="setStories(${h.id}, 1)"><input type="radio" name="stories${h.id}"> 1-Story</label>
      <label onclick="setStories(${h.id}, 2)"><input type="radio" name="stories${h.id}"> 2-Story</label>
    </div>`;
  }
}

export async function setStories(id, value) {
  state.houses.find((x) => x.id === id).stories = value;
  patchState(id, { stories: value }).catch(console.error);
  if (state.currentDetailId === id) openDetail(id, true);
}

export function toggleStoriesEdit(id) {
  state.houses.find((x) => x.id === id).stories = null;
  if (state.currentDetailId === id) openDetail(id, true);
}

// Condition
const WORK_ITEMS = ["Kitchen", "Bathrooms", "Carpet", "Wallpaper"];

function renderCondition(h) {
  const editIcon = `<button class="street-trees-edit-btn" onclick="event.stopPropagation(); toggleConditionEdit(${h.id})" title="Change"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`;
  if (h.condition === "ready") {
    return `Move-in Ready ${editIcon}`;
  } else if (h.condition === "work") {
    const needs = h.workNeeded || [];
    const checkboxes = WORK_ITEMS.map((item) => {
      const checked = needs.includes(item) ? "checked" : "";
      return `<label class="work-needed-label"><input type="checkbox" ${checked} onchange="toggleWorkItem(${h.id}, '${item}', this.checked)"> ${item}</label>`;
    }).join("");
    return `Needs Work ${editIcon}<div class="work-needed-checks">${checkboxes}</div>`;
  } else {
    return `<div class="street-trees-toggle">
      <label onclick="setCondition(${h.id}, 'ready')"><input type="radio" name="condition${h.id}"> Move-in Ready</label>
      <label onclick="setCondition(${h.id}, 'work')"><input type="radio" name="condition${h.id}"> Needs Work</label>
    </div>`;
  }
}

export async function setCondition(id, value) {
  const h = state.houses.find((x) => x.id === id);
  h.condition = value;
  if (value !== "work") h.workNeeded = [];
  patchState(id, { condition: value, workNeeded: value === "work" ? (h.workNeeded || []) : [] }).catch(console.error);
  if (state.currentDetailId === id) openDetail(id, true);
}

export async function toggleWorkItem(id, item, checked) {
  const h = state.houses.find((x) => x.id === id);
  const needs = h.workNeeded || [];
  if (checked && !needs.includes(item)) needs.push(item);
  else if (!checked) h.workNeeded = needs.filter((x) => x !== item);
  else h.workNeeded = needs;
  if (!h.workNeeded) h.workNeeded = needs;
  patchState(id, { workNeeded: h.workNeeded }).catch(console.error);
}

export function toggleConditionEdit(id) {
  const h = state.houses.find((x) => x.id === id);
  h.condition = null;
  h.workNeeded = [];
  if (state.currentDetailId === id) openDetail(id, true);
}

// Backyard
function renderBackyard(h) {
  const editIcon = `<button class="street-trees-edit-btn" onclick="event.stopPropagation(); toggleBackyardEdit(${h.id})" title="Change"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`;
  if (h.backyard === true) {
    return `Yes ${editIcon}`;
  } else if (h.backyard === false) {
    return `No ${editIcon}`;
  } else {
    return `<div class="street-trees-toggle">
      <label onclick="setBackyard(${h.id}, true)"><input type="radio" name="backyard${h.id}"> Yes</label>
      <label onclick="setBackyard(${h.id}, false)"><input type="radio" name="backyard${h.id}"> No</label>
    </div>`;
  }
}

export async function setBackyard(id, value) {
  state.houses.find((x) => x.id === id).backyard = value;
  patchState(id, { backyard: value }).catch(console.error);
  if (state.currentDetailId === id) openDetail(id, true);
}

export function toggleBackyardEdit(id) {
  state.houses.find((x) => x.id === id).backyard = null;
  if (state.currentDetailId === id) openDetail(id, true);
}

// Studio Space
function renderStudio(h) {
  const editIcon = `<button class="street-trees-edit-btn" onclick="event.stopPropagation(); toggleStudioEdit(${h.id})" title="Change"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`;
  if (h.studio === true) {
    return `Yes ${editIcon}`;
  } else if (h.studio === false) {
    return `No ${editIcon}`;
  } else {
    return `<div class="street-trees-toggle">
      <label onclick="setStudio(${h.id}, true)"><input type="radio" name="studio${h.id}"> Yes</label>
      <label onclick="setStudio(${h.id}, false)"><input type="radio" name="studio${h.id}"> No</label>
    </div>`;
  }
}

export async function setStudio(id, value) {
  state.houses.find((x) => x.id === id).studio = value;
  patchState(id, { studio: value }).catch(console.error);
  if (state.currentDetailId === id) openDetail(id, true);
}

export function toggleStudioEdit(id) {
  state.houses.find((x) => x.id === id).studio = null;
  if (state.currentDetailId === id) openDetail(id, true);
}

// Two Sinks
function renderTwoSinks(h) {
  const editIcon = `<button class="street-trees-edit-btn" onclick="event.stopPropagation(); toggleTwoSinksEdit(${h.id})" title="Change"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`;
  if (h.twoSinks === true) {
    return `Yes ${editIcon}`;
  } else if (h.twoSinks === false) {
    return `No ${editIcon}`;
  } else {
    return `<div class="street-trees-toggle">
      <label onclick="setTwoSinks(${h.id}, true)"><input type="radio" name="twoSinks${h.id}"> Yes</label>
      <label onclick="setTwoSinks(${h.id}, false)"><input type="radio" name="twoSinks${h.id}"> No</label>
    </div>`;
  }
}

export async function setTwoSinks(id, value) {
  state.houses.find((x) => x.id === id).twoSinks = value;
  patchState(id, { twoSinks: value }).catch(console.error);
  if (state.currentDetailId === id) openDetail(id, true);
}

export function toggleTwoSinksEdit(id) {
  state.houses.find((x) => x.id === id).twoSinks = null;
  if (state.currentDetailId === id) openDetail(id, true);
}

// Wall Ovens
function renderWallOvens(h) {
  const editIcon = `<button class="street-trees-edit-btn" onclick="event.stopPropagation(); toggleWallOvensEdit(${h.id})" title="Change"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`;
  if (h.wallOvens === true) {
    return `Yes ${editIcon}`;
  } else if (h.wallOvens === false) {
    return `No ${editIcon}`;
  } else {
    return `<div class="street-trees-toggle">
      <label onclick="setWallOvens(${h.id}, true)"><input type="radio" name="wallOvens${h.id}"> Yes</label>
      <label onclick="setWallOvens(${h.id}, false)"><input type="radio" name="wallOvens${h.id}"> No</label>
    </div>`;
  }
}

export async function setWallOvens(id, value) {
  state.houses.find((x) => x.id === id).wallOvens = value;
  patchState(id, { wallOvens: value }).catch(console.error);
  if (state.currentDetailId === id) openDetail(id, true);
}

export function toggleWallOvensEdit(id) {
  state.houses.find((x) => x.id === id).wallOvens = null;
  if (state.currentDetailId === id) openDetail(id, true);
}

// Pool
function renderPool(h) {
  const editIcon = `<button class="street-trees-edit-btn" onclick="event.stopPropagation(); togglePoolEdit(${h.id})" title="Change"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`;
  if (h.pool === true) {
    return `Yes ${editIcon}`;
  } else if (h.pool === false) {
    return `No ${editIcon}`;
  } else {
    return `<div class="street-trees-toggle">
      <label onclick="setPool(${h.id}, true)"><input type="radio" name="pool${h.id}"> Yes</label>
      <label onclick="setPool(${h.id}, false)"><input type="radio" name="pool${h.id}"> No</label>
    </div>`;
  }
}

export async function setPool(id, value) {
  state.houses.find((x) => x.id === id).pool = value;
  patchState(id, { pool: value }).catch(console.error);
  if (state.currentDetailId === id) openDetail(id, true);
}

export function togglePoolEdit(id) {
  state.houses.find((x) => x.id === id).pool = null;
  if (state.currentDetailId === id) openDetail(id, true);
}

// Master Walk-in Shower
function renderWalkInShower(h) {
  const editIcon = `<button class="street-trees-edit-btn" onclick="event.stopPropagation(); toggleWalkInShowerEdit(${h.id})" title="Change"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`;
  if (h.walkInShower === true) {
    return `Yes ${editIcon}`;
  } else if (h.walkInShower === false) {
    return `No ${editIcon}`;
  } else {
    return `<div class="street-trees-toggle">
      <label onclick="setWalkInShower(${h.id}, true)"><input type="radio" name="walkInShower${h.id}"> Yes</label>
      <label onclick="setWalkInShower(${h.id}, false)"><input type="radio" name="walkInShower${h.id}"> No</label>
    </div>`;
  }
}

export async function setWalkInShower(id, value) {
  state.houses.find((x) => x.id === id).walkInShower = value;
  patchState(id, { walkInShower: value }).catch(console.error);
  if (state.currentDetailId === id) openDetail(id, true);
}

export function toggleWalkInShowerEdit(id) {
  state.houses.find((x) => x.id === id).walkInShower = null;
  if (state.currentDetailId === id) openDetail(id, true);
}

// Garage
function renderGarage(h) {
  const editIcon = `<button class="street-trees-edit-btn" onclick="event.stopPropagation(); toggleGarageEdit(${h.id})" title="Change"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`;
  if (h.garage === "1car") {
    return `Yes — 1 car ${editIcon}`;
  } else if (h.garage === "2car") {
    return `Yes — 2 car ${editIcon}`;
  } else if (h.garage === "no") {
    return `No ${editIcon}`;
  } else {
    return `<div class="street-trees-toggle">
      <label onclick="setGarage(${h.id}, 'no')"><input type="radio" name="garage${h.id}"> No</label>
      <label onclick="setGarage(${h.id}, '1car')"><input type="radio" name="garage${h.id}"> 1 car</label>
      <label onclick="setGarage(${h.id}, '2car')"><input type="radio" name="garage${h.id}"> 2 car</label>
    </div>`;
  }
}

export async function setGarage(id, value) {
  state.houses.find((x) => x.id === id).garage = value;
  patchState(id, { garage: value }).catch(console.error);
  if (state.currentDetailId === id) openDetail(id, true);
}

export function toggleGarageEdit(id) {
  state.houses.find((x) => x.id === id).garage = null;
  if (state.currentDetailId === id) openDetail(id, true);
}
