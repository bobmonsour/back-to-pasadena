#!/usr/bin/env node
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@googlemaps/google-maps-services-js";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const address = process.argv[2];
const city = process.argv[3];
const id = process.argv[4];
const redfinUrl = process.argv[5] || "";

if (!address || !city || !id) {
  console.error("Usage: node scripts/research.js <address> <city> <id> [redfinUrl]");
  console.error('Example: node scripts/research.js "1247 Meridian Ave" "South Pasadena, CA 91030" 1 "https://www.redfin.com/CA/..."');
  process.exit(1);
}

const DESTINATIONS = [
  { name: "Whole Foods Market", address: "465 S Arroyo Pkwy, Pasadena, CA 91105" },
  { name: "Whole Foods Market", address: "3751 E Foothill Blvd, Pasadena, CA 91107" },
  { name: "Whole Foods Market", address: "331 N Glendale Ave, Glendale, CA 91206" },
  { name: "Trader Joe's", address: "345 S Lake Ave, Pasadena, CA 91101" },
  { name: "Trader Joe's", address: "467 N Rosemead Blvd, Pasadena, CA 91107" },
  { name: "Trader Joe's", address: "613 Mission St, South Pasadena, CA 91030" },
  { name: "Trader Joe's", address: "103 E Glenoaks Blvd, Glendale, CA 91207" },
  { name: "Trader Joe's", address: "2462 Honolulu Ave, Montrose, CA 91020" },
  { name: "Costco", address: "3972 Costco Dr, Arcadia, CA 91006" },
  { name: "Target", address: "777 E Colorado Blvd, Pasadena, CA 91101" },
  { name: "Target", address: "3121 E Colorado Blvd, Pasadena, CA 91107" },
  { name: "Target", address: "2195 Glendale Galleria, Glendale, CA 91210" },
  { name: "Home Depot", address: "2881 E Walnut St, Pasadena, CA 91107" },
  { name: "Home Depot", address: "5040 San Fernando Rd, Glendale, CA 91204" },
  { name: "Republik Coffee", address: "48 W Green St, Pasadena, CA 91105" },
];

const fullAddress = `${address}, ${city}`;

// --- Timeout wrapper ---
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)),
  ]);
}

// --- Geocode address to lat/lon ---
async function geocodeAddress() {
  // Try Google Maps first if API key is available
  if (process.env.GOOGLE_MAPS_API_KEY && process.env.GOOGLE_MAPS_API_KEY !== "your-key-here") {
    try {
      const maps = new Client({});
      const result = await maps.geocode({
        params: { address: fullAddress, key: process.env.GOOGLE_MAPS_API_KEY },
      });
      const loc = result.data.results[0]?.geometry?.location;
      if (loc) return { lat: loc.lat, lon: loc.lng };
    } catch (err) {
      console.warn(`  Google geocode failed: ${err.message}, trying Census...`);
    }
  }

  // Fallback: US Census geocoder (free, no key needed)
  const encoded = encodeURIComponent(fullAddress);
  const res = await fetch(
    `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encoded}&benchmark=Public_AR_Current&format=json`
  );
  if (!res.ok) throw new Error(`Census geocoder HTTP ${res.status}`);
  const data = await res.json();
  const match = data.result?.addressMatches?.[0];
  if (!match) throw new Error("Address not found by Census geocoder");
  return { lat: match.coordinates.y, lon: match.coordinates.x };
}

// --- CAL FIRE Hazard Severity Zone lookup ---
async function getFireRisk(lat, lon) {
  // Query both SRA (layer 0) and LRA (layer 1) — address could be in either
  const base = "https://services.gis.ca.gov/arcgis/rest/services/Environment/Fire_Severity_Zones/MapServer";
  const params = `where=1%3D1&geometry=${lon},${lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=HAZ_CLASS&returnGeometry=false&f=json`;

  for (const layer of [0, 1]) {
    try {
      const res = await fetch(`${base}/${layer}/query?${params}`);
      if (!res.ok) continue;
      const data = await res.json();
      const feature = data.features?.[0];
      if (feature) {
        const hazClass = feature.attributes.HAZ_CLASS;
        // HAZ_CLASS values: "Moderate", "High", "Very High"
        if (hazClass.includes("Very High")) return "Very High — very high fire hazard severity zone (CAL FIRE FHSZ)";
        if (hazClass.includes("High")) return "High — high fire hazard severity zone (CAL FIRE FHSZ)";
        if (hazClass.includes("Moderate")) return "Moderate — moderate fire hazard severity zone (CAL FIRE FHSZ)";
        return hazClass;
      }
    } catch {
      continue;
    }
  }

  // No fire hazard zone polygon at this point = not in any FHSZ
  return "Low — not in a fire hazard severity zone (CAL FIRE FHSZ)";
}

// --- FEMA Flood Hazard Zone lookup ---
async function getFloodRisk(lat, lon) {
  const url = `https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query?where=1%3D1&geometry=${lon},${lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=FLD_ZONE,ZONE_SUBTY&returnGeometry=false&f=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FEMA NFHL HTTP ${res.status}`);
  const data = await res.json();
  const feature = data.features?.[0];
  if (!feature) return "Unknown — no FEMA flood data available";

  const zone = feature.attributes.FLD_ZONE;
  const subtype = feature.attributes.ZONE_SUBTY || "";

  // FEMA zone interpretation
  // X = minimal risk, A/AE/AH/AO = high risk (100-yr floodplain), V/VE = coastal high risk
  if (zone === "X" && subtype.includes("MINIMAL")) return "Low — Zone X, minimal flood hazard (FEMA NFHL)";
  if (zone === "X" && subtype.includes("0.2 PCT")) return "Moderate — Zone X, 0.2% annual chance flood (FEMA NFHL)";
  if (zone === "X") return "Low — Zone X (FEMA NFHL)";
  if (zone?.startsWith("A")) return `High — Zone ${zone}, 1% annual chance flood (FEMA NFHL)`;
  if (zone?.startsWith("V")) return `High — Zone ${zone}, coastal flood with wave action (FEMA NFHL)`;
  if (zone === "D") return "Moderate — Zone D, undetermined flood hazard (FEMA NFHL)";
  return `${zone} — ${subtype} (FEMA NFHL)`;
}

// --- LA County Assessor lot size (GIS parcel data) ---
async function getLotSizeFromAssessor(streetAddress) {
  // Build LIKE query: keep house number + directional prefix + street name, drop suffix
  // e.g. "698 E Elizabeth St" → "698 E%ELIZABETH%"
  // e.g. "577 N Chester Ave" → "577 N%CHESTER%"
  // e.g. "1500 Oxley St" → "1500%OXLEY%"
  const parts = streetAddress.trim().split(/\s+/);
  const houseNum = parts[0];
  // Keep directional prefix (N/S/E/W) with the house number, drop street type suffixes
  const suffixRe = /^(St|Ave|Dr|Blvd|Ln|Pl|Way|Rd|Ct|Cir)$/i;
  const dirRe = /^[NSEW]$/i;
  let prefix = houseNum;
  let startIdx = 1;
  if (parts[1] && dirRe.test(parts[1])) {
    prefix = `${houseNum} ${parts[1].toUpperCase()}`;
    startIdx = 2;
  }
  const streetWords = parts.slice(startIdx)
    .filter(w => !suffixRe.test(w))
    .map(w => w.toUpperCase());
  const query = `${prefix}%${streetWords.join("%")}%`;
  const url = `https://public.gis.lacounty.gov/public/rest/services/LACounty_Cache/LACounty_Parcel/MapServer/0/query?where=${encodeURIComponent(`SitusAddress LIKE '${query}'`)}&outFields=AIN,SitusAddress,Shape.STArea()&returnGeometry=false&f=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`LA County GIS HTTP ${res.status}`);
  const data = await res.json();
  const feature = data.features?.[0];
  if (!feature) return null;
  const area = feature.attributes["Shape.STArea()"];
  if (!area || area <= 0) return null;
  const ain = feature.attributes.AIN || "";
  console.log(`  Assessor parcel: AIN ${ain}, ${Math.round(area)} sqft (${feature.attributes.SitusAddress})`);
  return Math.round(area);
}

// --- Fetch HTML from a URL ---
async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// --- Scrape Redfin listing page ---
function scrapeRedfinListing(html) {
  const data = {};

  // --- JSON-LD structured data (primary source) ---
  const jsonLdBlocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
  for (const block of jsonLdBlocks) {
    try {
      const jsonStr = block.replace(/<script type="application\/ld\+json">/, "").replace(/<\/script>/, "");
      const ld = JSON.parse(jsonStr);
      const types = Array.isArray(ld["@type"]) ? ld["@type"] : [ld["@type"]];

      if (types.includes("RealEstateListing") || types.includes("Product")) {
        if (ld.offers?.price) data.price = Number(ld.offers.price);
        if (ld.datePosted) data.dateListed = ld.datePosted.split("T")[0];

        // mainEntity has the property details
        const prop = ld.mainEntity || ld;
        if (prop.numberOfBedrooms) data.beds = Number(prop.numberOfBedrooms);
        if (prop.numberOfBathroomsTotal) data.baths = Number(prop.numberOfBathroomsTotal);
        if (prop.floorSize?.value) data.sqft = Number(prop.floorSize.value);
        if (prop.yearBuilt) data.yearBuilt = Number(prop.yearBuilt);
        if (prop.lotSize?.value) {
          const lotVal = Number(prop.lotSize.value);
          const unit = (prop.lotSize.unitCode || prop.lotSize.unitText || "").toUpperCase();
          if (unit.includes("SQM") || unit === "MTK") {
            data.lotSize = Math.round(lotVal * 10.7639); // sqm to sqft
          } else {
            data.lotSize = lotVal;
          }
        }

        // All listing images
        if (prop.image && Array.isArray(prop.image)) {
          data.imageUrls = prop.image.map((img) => img.url || img).filter(Boolean);
        }

        // Geo coordinates (useful for geocode fallback)
        if (prop.geo) {
          data.lat = prop.geo.latitude;
          data.lon = prop.geo.longitude;
        }
      }
    } catch {
      // skip malformed JSON-LD
    }
  }

  // --- Regex fallbacks for fields not found in JSON-LD ---
  if (!data.price) {
    const priceMatch = html.match(/\$[\d,]+(?:\.\d+)?/);
    if (priceMatch) {
      const num = Number(priceMatch[0].replace(/[$,]/g, ""));
      if (num > 50000) data.price = num;
    }
  }
  if (!data.beds) {
    const m = html.match(/(\d+)\s*(?:Beds?|beds?|BR|Bedroom)/);
    if (m) data.beds = Number(m[1]);
  }
  if (!data.baths) {
    const m = html.match(/(\d+(?:\.\d+)?)\s*(?:Bath|bath|BA\b|Bathroom)/);
    if (m) data.baths = Number(m[1]);
  }
  if (!data.sqft) {
    const m = html.match(/([\d,]+)\s*(?:Sq\.?\s*Ft|sq\.?\s*ft|SF|sqft)/);
    if (m) data.sqft = Number(m[1].replace(/,/g, ""));
  }
  if (!data.yearBuilt) {
    const m = html.match(/(?:Year Built|Built in)[:\s]*(\d{4})/i);
    if (m) data.yearBuilt = Number(m[1]);
  }
  // Prefer "lotSqFt" from embedded JSON (reliably in sqft) over JSON-LD lotSize
  const lotSqFtMatch = html.match(/"lotSqFt"\s*:\s*(\d+)/);
  if (lotSqFtMatch) {
    data.lotSize = Number(lotSqFtMatch[1]);
  }
  if (!data.lotSize) {
    // Try embedded JSON lotSize
    const lotJsonMatch = html.match(/"lotSize"\s*:\s*(\d+)/);
    if (lotJsonMatch) {
      data.lotSize = Number(lotJsonMatch[1]);
    } else {
      // Fallback: match "X,XXX Sq. Ft. Lot" or "X.XX Acres"
      const m = html.match(/([\d,]+)\s*(?:Sq\.?\s*Ft\.?\s*Lot)/i)
        || html.match(/([\d.]+)\s*Acres?/i);
      if (m) {
        if (/acres?/i.test(m[0])) {
          data.lotSize = Math.round(Number(m[1]) * 43560); // convert acres to sqft
        } else {
          data.lotSize = Number(m[1].replace(/,/g, ""));
        }
      }
    }
  }

  // --- Agent info ---
  const agentNameMatch = html.match(/Listed by <span>([^<]+)<\/span>/i);
  const agentPhoneMatch = html.match(/href="tel:([^"]+)"/);
  data.agent = {
    name: agentNameMatch ? agentNameMatch[1].trim() : "Unknown",
    phone: agentPhoneMatch ? agentPhoneMatch[1].trim() : "—",
    email: "—",
  };

  // --- Redfin estimate ---
  const estimateMatch = html.match(/Redfin Estimate[^$]*\$([\d,]+)/i);
  if (estimateMatch) {
    data.estimates = { redfin: Number(estimateMatch[1].replace(/,/g, "")) };
  }

  // --- og:image (used if JSON-LD images not found) ---
  if (!data.imageUrls || data.imageUrls.length === 0) {
    const ogMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i)
      || html.match(/<meta\s+content="([^"]+)"\s+property="og:image"/i);
    if (ogMatch) data.ogImage = ogMatch[1];
  }

  // --- Price history from embedded escaped JSON ---
  data.priceHistory = [];
  data.lastSold = null;
  const eventsMarker = '\\"events\\":[{';
  const eventsIdx = html.indexOf(eventsMarker);
  if (eventsIdx !== -1) {
    const arrStart = eventsIdx + '\\"events\\":'.length;
    const chunk = html.substring(arrStart, arrStart + 50000).replace(/\\"/g, '"');
    let depth = 0;
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] === "[") depth++;
      else if (chunk[i] === "]") depth--;
      if (depth === 0) {
        try {
          const events = JSON.parse(chunk.substring(0, i + 1));
          for (const e of events) {
            const desc = (e.eventDescription || "").toLowerCase();
            const eventType = e.historyEventType;
            // historyEventType: 1 = sale listing, 2 = sold, 3 = rental
            if (eventType === 3) continue; // skip rentals

            const price = e.price || 0;
            if (price === 0 && !desc.includes("sold")) continue; // skip zero-price non-sold events

            // Format date from timestamp or string
            let dateStr = e.eventDateString || "";
            if (!dateStr && e.eventDate) {
              const d = new Date(e.eventDate);
              dateStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
            }

            let type = "listed";
            if (desc.includes("sold")) type = "sold";
            else if (desc.includes("price changed") || desc.includes("reduced")) type = "reduced";
            else if (desc.includes("increased")) type = "increased";
            else if (desc.includes("relisted")) type = "listed";

            data.priceHistory.push({
              type,
              label: e.eventDescription || "Listed",
              date: dateStr,
              amount: price,
              _ts: e.eventDate || 0,
            });

            // Track most recent sale for lastSold
            if (type === "sold" && price > 0 && !data.lastSold) {
              data.lastSold = { date: dateStr, price };
            }
          }
        } catch { /* skip */ }
        break;
      }
    }
  }
  // Sort price history by date descending and remove temp timestamp
  data.priceHistory.sort((a, b) => b._ts - a._ts);
  data.priceHistory.forEach((e) => delete e._ts);

  return data;
}

// --- Claude API Research (neighborhood only) ---
async function researchWithClaude() {
  const client = new Anthropic();

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    tools: [
      {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: 5,
      },
    ],
    messages: [
      {
        role: "user",
        content: `Research the neighborhood around this property: ${fullAddress}

I already have the listing details (price, beds, baths, etc.) from Redfin. I just need neighborhood and area information.

Search for:
1. A description of the neighborhood character and feel (walkability, vibe, types of homes)
2. The nearest park and approximate distance
3. Crime rating for this area (check CrimeGrade.org or similar)

Return a JSON object with ONLY these fields:
- neighborhood (string, 1-2 sentence description of the neighborhood character)
- parkProximity (string, e.g. "0.3 miles to Garfield Park")
- crimeRating (string, e.g. "Very Low — Grade A (CrimeGrade.org)")

After searching, respond with ONLY a JSON code block. No other text.
\`\`\`json
{"neighborhood": "...", "parkProximity": "...", "crimeRating": "..."}
\`\`\``,
      },
    ],
  });

  const textBlocks = [];
  for (const block of response.content) {
    if (block.type === "text") {
      textBlocks.push(block.text);
    }
  }

  for (let i = textBlocks.length - 1; i >= 0; i--) {
    let text = textBlocks[i];
    text = text.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim();

    const start = text.indexOf("{");
    if (start === -1) continue;

    let depth = 0;
    for (let j = start; j < text.length; j++) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.substring(start, j + 1));
        } catch {
          break;
        }
      }
    }
  }

  throw new Error("No valid JSON object found in Claude response");
}

// --- Google Maps Distance Matrix ---
async function getDistances() {
  if (!process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY === "your-key-here") {
    console.log("  Skipping Google Maps (no API key). Using placeholder distances.");
    const seen = new Set();
    return DESTINATIONS.filter((d) => !seen.has(d.name) && seen.add(d.name)).map((d) => ({ name: d.name, address: d.address, miles: "—", time: "—" }));
  }

  const maps = new Client({});
  const result = await maps.distancematrix({
    params: {
      origins: [fullAddress],
      destinations: DESTINATIONS.map((d) => d.address),
      mode: "driving",
      key: process.env.GOOGLE_MAPS_API_KEY,
    },
  });

  const elements = result.data.rows[0]?.elements || [];
  const allResults = DESTINATIONS.map((dest, i) => {
    const el = elements[i];
    if (el?.status === "OK") {
      const miles = (el.distance.value / 1609.34).toFixed(1) + " mi";
      const time = el.duration.text.replace("mins", "min");
      return { name: dest.name, address: dest.address, miles, time, meters: el.distance.value };
    }
    return { name: dest.name, address: dest.address, miles: "—", time: "—", meters: Infinity };
  });

  // Keep only the closest location per store name
  const closest = new Map();
  for (const r of allResults) {
    const existing = closest.get(r.name);
    if (!existing || r.meters < existing.meters) {
      closest.set(r.name, r);
    }
  }
  return [...closest.values()].map(({ name, address, miles, time }) => ({ name, address, miles, time }));
}

// --- Peep Rating (average distance to friends/family from KML) ---
function parsePeepKml() {
  const kmlPath = join(process.cwd(), "src", "_data", "peep-map.kml");
  try {
    const kml = readFileSync(kmlPath, "utf-8");
    const placemarks = [];
    const re = /<Placemark>[\s\S]*?<name>(?:<!\[CDATA\[([^\]]*)\]\]>|([^<]+))<\/name>[\s\S]*?<coordinates>\s*([\d.,-]+)\s*<\/coordinates>[\s\S]*?<\/Placemark>/g;
    let m;
    while ((m = re.exec(kml))) {
      const name = (m[1] || m[2]).trim();
      const [lon, lat] = m[3].split(",").map(Number);
      placemarks.push({ name, lat, lon });
    }
    return placemarks;
  } catch {
    return [];
  }
}

async function getPeepRating() {
  const peeps = parsePeepKml();
  if (peeps.length === 0) return null;
  if (!process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY === "your-key-here") {
    console.log("  Skipping Peep Rating (no API key).");
    return null;
  }

  const maps = new Client({});
  const destinations = peeps.map((p) => `${p.lat},${p.lon}`);

  // Fetch driving and walking distances in parallel
  const [drivingResult, walkingResult] = await Promise.all([
    maps.distancematrix({
      params: { origins: [fullAddress], destinations, mode: "driving", key: process.env.GOOGLE_MAPS_API_KEY },
    }),
    maps.distancematrix({
      params: { origins: [fullAddress], destinations, mode: "walking", key: process.env.GOOGLE_MAPS_API_KEY },
    }),
  ]);

  const drivingEls = drivingResult.data.rows[0]?.elements || [];
  const walkingEls = walkingResult.data.rows[0]?.elements || [];
  const distances = [];
  let totalMeters = 0;
  let totalSeconds = 0;
  let count = 0;

  for (let i = 0; i < peeps.length; i++) {
    const dEl = drivingEls[i];
    const wEl = walkingEls[i];
    const entry = { name: peeps[i].name, lat: peeps[i].lat, lon: peeps[i].lon };

    if (dEl?.status === "OK") {
      entry.driving = {
        miles: (dEl.distance.value / 1609.34).toFixed(1) + " mi",
        time: dEl.duration.text.replace("mins", "min"),
      };
      totalMeters += dEl.distance.value;
      totalSeconds += dEl.duration.value;
      count++;
    } else {
      entry.driving = { miles: "—", time: "—" };
    }

    if (wEl?.status === "OK") {
      entry.walking = {
        miles: (wEl.distance.value / 1609.34).toFixed(1) + " mi",
        time: wEl.duration.text.replace("mins", "min"),
      };
    } else {
      entry.walking = { miles: "—", time: "—" };
    }

    distances.push(entry);
  }

  if (count === 0) return null;

  const avgMiles = (totalMeters / count / 1609.34).toFixed(1) + " mi";
  const avgMin = Math.round(totalSeconds / count / 60) + " min";

  return { avgMiles, avgTime: avgMin, distances };
}

// --- Image Download ---
async function downloadImage(imgUrl, destPath) {
  const res = await fetch(imgUrl, {
    headers: { "User-Agent": "Mozilla/5.0" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  writeFileSync(destPath, buffer);
}

const FALLBACK_IMAGE = "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=800&q=80";

async function downloadListingImages(imageUrls) {
  const imgDir = join(process.cwd(), "src", "images", String(id));
  mkdirSync(imgDir, { recursive: true });

  if (imageUrls && imageUrls.length > 0) {
    const localPaths = [];
    const maxImages = imageUrls.length;
    console.log(`  Downloading ${maxImages} listing images...`);

    for (let i = 0; i < maxImages; i++) {
      const destPath = join(imgDir, `photo-${i + 1}.jpg`);
      const localPath = `/images/${id}/photo-${i + 1}.jpg`;
      try {
        await withTimeout(downloadImage(imageUrls[i], destPath), 15000, `Image ${i + 1}`);
        localPaths.push(localPath);
      } catch (err) {
        console.warn(`  Failed to download image ${i + 1}: ${err.message}`);
      }
    }
    if (localPaths.length > 0) {
      console.log(`  Downloaded ${localPaths.length} photos.`);
      return localPaths;
    }
  }

  // Fallback to single placeholder
  const destPath = join(imgDir, "photo-1.jpg");
  try {
    await withTimeout(downloadImage(FALLBACK_IMAGE, destPath), 15000, "Fallback download");
    console.log("  Used placeholder image.");
    return [`/images/${id}/photo-1.jpg`];
  } catch {
    console.warn("  Fallback download also failed.");
    return [FALLBACK_IMAGE];
  }
}

// --- Main ---
async function main() {
  console.log(`Researching: ${fullAddress} (id: ${id})`);
  if (redfinUrl) console.log(`  Redfin URL: ${redfinUrl}`);

  let redfinData = {};

  // Step 1: Scrape Redfin listing if URL provided
  if (redfinUrl) {
    console.log("  Fetching Redfin listing page...");
    try {
      const html = await withTimeout(fetchHtml(redfinUrl), 20000, "Redfin fetch");
      redfinData = scrapeRedfinListing(html);
      console.log(`  Scraped from Redfin: price=$${redfinData.price || "?"}, beds=${redfinData.beds || "?"}, baths=${redfinData.baths || "?"}, sqft=${redfinData.sqft || "?"}`);

    } catch (err) {
      console.warn(`  Failed to scrape Redfin: ${err.message}`);
    }
  }

  // Step 2: Geocode address and look up fire/flood risk
  let fireRisk = "Unknown";
  let floodRisk = "Unknown";
  let coords = null;
  console.log("  Geocoding address...");
  try {
    // Use Redfin JSON-LD coordinates if available, otherwise geocode
    if (redfinData.lat && redfinData.lon) {
      coords = { lat: redfinData.lat, lon: redfinData.lon };
      console.log(`  Using Redfin coordinates: ${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`);
    } else {
      coords = await withTimeout(geocodeAddress(), 10000, "Geocode");
      console.log(`  Geocoded: ${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`);
    }

    // Run fire, flood, and assessor lot size queries in parallel
    console.log("  Querying fire/flood risk + assessor lot size...");
    const [fire, flood, assessorLotSize] = await Promise.all([
      withTimeout(getFireRisk(coords.lat, coords.lon), 10000, "Fire risk").catch((e) => {
        console.warn(`  Fire risk query failed: ${e.message}`);
        return fireRisk;
      }),
      withTimeout(getFloodRisk(coords.lat, coords.lon), 10000, "Flood risk").catch((e) => {
        console.warn(`  Flood risk query failed: ${e.message}`);
        return floodRisk;
      }),
      withTimeout(getLotSizeFromAssessor(address), 10000, "Assessor lot size").catch((e) => {
        console.warn(`  Assessor lot size query failed: ${e.message}`);
        return null;
      }),
    ]);
    fireRisk = fire;
    floodRisk = flood;
    // Prefer assessor lot size (surveyed parcel data) over Redfin scrape
    if (assessorLotSize) {
      redfinData.lotSize = assessorLotSize;
    }
    console.log(`  Fire risk: ${fireRisk}`);
    console.log(`  Flood risk: ${floodRisk}`);
  } catch (err) {
    console.warn(`  Geocoding failed: ${err.message} — using Redfin data or Unknown`);
  }

  // Step 3: Claude research for neighborhood info
  console.log("  Running Claude research (neighborhood, parks, crime)...");
  let claudeData;
  try {
    claudeData = await researchWithClaude();
    console.log("  Claude research complete.");
  } catch (err) {
    console.error("  Claude research failed:", err.message);
    claudeData = {
      neighborhood: "Pending research",
      parkProximity: "Unknown",
      crimeRating: "Unknown",
    };
  }

  // Step 4: Distances
  console.log("  Getting driving distances...");
  const distances = await getDistances();
  console.log("  Distances complete.");

  // Step 5: Peep Rating
  console.log("  Calculating Peep Rating...");
  let peepRating = null;
  try {
    peepRating = await withTimeout(getPeepRating(), 15000, "Peep Rating");
    if (peepRating) console.log(`  Peep Rating: ${peepRating.avgMiles} / ${peepRating.avgTime} avg`);
    else console.log("  Peep Rating: skipped (no KML or API key).");
  } catch (err) {
    console.warn(`  Peep Rating failed: ${err.message}`);
  }

  // Step 6: Download images
  console.log("  Downloading listing images...");
  const images = await downloadListingImages(redfinData.imageUrls || (redfinData.ogImage ? [redfinData.ogImage] : null));
  console.log("  Images done.");

  // Build the immutable house data JSON
  const houseData = {
    id: Number(id),
    address,
    city,
    price: redfinData.price || 0,
    beds: redfinData.beds || 0,
    baths: redfinData.baths || 0,
    sqft: redfinData.sqft || 0,
    lotSize: redfinData.lotSize || 0,
    yearBuilt: redfinData.yearBuilt || 0,
    images,
    neighborhood: claudeData.neighborhood || "Pending research",
    parkProximity: claudeData.parkProximity || "Unknown",
    floodRisk,
    fireRisk,
    crimeRating: claudeData.crimeRating || "Unknown",
    distances,
    peepRating,
    agent: redfinData.agent || { name: "Unknown", phone: "—", email: "—" },
    dateListed: redfinData.dateListed || new Date().toISOString().split("T")[0],
    priceHistory: redfinData.priceHistory || [],
    lastSold: redfinData.lastSold || null,
    estimates: redfinData.estimates || { redfin: 0 },
    listingUrl: redfinUrl || "#",
    listingSource: redfinUrl ? "redfin" : "",
    redfinUrl: redfinUrl || "#",
    lat: coords?.lat || redfinData.lat || 0,
    lon: coords?.lon || redfinData.lon || 0,
    dateAdded: new Date().toISOString(),
  };

  // Write to src/_data/houses/{id}.json
  const dataDir = join(process.cwd(), "src", "_data", "houses");
  mkdirSync(dataDir, { recursive: true });
  const outPath = join(dataDir, `${id}.json`);
  writeFileSync(outPath, JSON.stringify(houseData, null, 2));
  console.log(`\nSaved: ${outPath}`);
}

main().catch((err) => {
  console.error("Research failed:", err);
  process.exit(1);
});
