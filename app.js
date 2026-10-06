const SINGAPORE_CENTRE = [1.3521, 103.8198];
const TIMELINE_HOURS = Array.from({ length: 17 }, (_, index) => `${String(index + 7).padStart(2, "0")}:00`);
const TIME_WINDOWS = {
  morning: (hour) => hour < 12,
  afternoon: (hour) => hour >= 12 && hour < 18,
  evening: (hour) => hour >= 18,
};

const state = {
  type: "all",
  area: "all",
  platform: "all",
  feature: "all",
  publicOnly: false,
  query: "",
  time: "all",
  sort: "recommended",
  limit: 8,
  selectedDate: "",
  view: "list",
};

let venues = [];
let platforms = {};
let socialPlay = [];
let availability = new Map();
let providerStatuses = [];
let venueMap = null;
let venueLayer = null;
let mapFitted = false;

const cards = document.querySelector("#court-cards");
const resultCount = document.querySelector("#result-count");
const toast = document.querySelector("#toast");
const courtLayout = document.querySelector("#court-layout");
const timelinePanel = document.querySelector("#timeline-panel");
const dataNotice = document.querySelector("#data-notice");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function formatCapturedAt(value) {
  if (!value) return "Update time unavailable";
  return new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Singapore",
  }).format(new Date(value));
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en-SG", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Singapore",
  }).format(new Date(`${value}T12:00:00+08:00`));
}

function statusLabel(status) {
  return {
    live: "Live",
    cached: "Recently updated",
    snapshot: "Snapshot",
  }[status] || "Unverified";
}

function platformOf(venue) {
  return platforms[venue.platform] || { name: venue.platform, integration: "deep_link" };
}

function bookingLink(venue) {
  return availability.get(venue.id)?.sourceUrl || venue.bookingUrl;
}

function isMembersOnly(venue) {
  return venue.access === "members";
}

function priceLabel(venue) {
  if (venue.priceFrom === undefined) return `<span class="price-unknown">Price on booking page</span>`;
  const from = Number.isInteger(venue.priceFrom) ? venue.priceFrom : venue.priceFrom.toFixed(2);
  const peak = venue.pricePeak ? ` <small>· peak $${venue.pricePeak}</small>` : "";
  return `from <b>$${from}</b>/hr${peak}`;
}

function slotHour(slot) {
  return Number.parseInt(slot.start, 10);
}

function slotsForWindow(slots) {
  if (state.time === "all") return slots;
  return slots.filter((slot) => TIME_WINDOWS[state.time](slotHour(slot)));
}

function hasOpenSlot(venue) {
  const live = availability.get(venue.id);
  return Boolean(live && slotsForWindow(live.slots).some((slot) => slot.availableCourts > 0));
}

function filteredVenues() {
  const query = state.query.toLowerCase();
  const list = venues.filter((venue) => {
    const searchable = `${venue.name} ${venue.operator} ${venue.address} ${venue.area} ${platformOf(venue).name}`;
    return (
      (state.type === "all" || venue.category === state.type) &&
      (state.area === "all" || venue.area === state.area) &&
      (state.platform === "all" || venue.platform === state.platform) &&
      (state.feature === "all" || (venue.setting || []).includes(state.feature)) &&
      (!state.publicOnly || !isMembersOnly(venue)) &&
      (!query || searchable.toLowerCase().includes(query))
    );
  });

  return list.sort((a, b) => {
    if (state.sort === "price") return (a.priceFrom ?? Infinity) - (b.priceFrom ?? Infinity);
    if (state.sort === "courts") return (b.courts || 0) - (a.courts || 0);
    if (state.sort === "name") return a.name.localeCompare(b.name);
    return recommendScore(b) - recommendScore(a) || a.name.localeCompare(b.name);
  });
}

// Live open courts first, then anything bookable online by the public, then
// member clubs and paused venues.
function recommendScore(venue) {
  let score = 0;
  if (hasOpenSlot(venue)) score += 100;
  else if (availability.has(venue.id)) score += 50;
  if (!isMembersOnly(venue)) score += 20;
  if (venue.status === "paused") score -= 40;
  score += Math.min(venue.courts || 0, 10);
  return score;
}

function availabilityMarkup(venue) {
  const platform = platformOf(venue);
  const live = availability.get(venue.id);
  const link = escapeHtml(bookingLink(venue));

  if (live) {
    const slots = slotsForWindow(live.slots);
    const best = Math.max(0, ...slots.map((slot) => slot.availableCourts));
    const chips = slots.length
      ? slots.map((slot) => `
          <a class="slot ${slot.availableCourts === 0 ? "booked" : ""}" href="${link}" target="_blank" rel="noreferrer"
             title="${slot.availableCourts} of ${live.totalCourts} courts free">
            ${slot.start} · ${slot.availableCourts}/${live.totalCourts}
          </a>`).join("")
      : `<span class="no-slots">No open times in this window.</span>`;
    return `
      <div class="availability-title">
        <span>Open courts by hour</span>
        <b>${best}/${live.totalCourts} free at best</b>
      </div>
      <div class="slots">${chips}</div>
      <div class="snapshot-note">${statusLabel(live.status)} from ${escapeHtml(platform.name)} · ${formatCapturedAt(live.capturedAt)}</div>
    `;
  }

  const reason = {
    deep_link: `Check open times on ${escapeHtml(platform.name)}.`,
    venue_feed: `${escapeHtml(platform.name)} needs a venue-approved feed for live times. Check the booking page for now.`,
    live: `Live ${escapeHtml(platform.name)} times appear here once this club is connected.`,
  }[platform.integration] || "Check open times on the booking page.";
  return `
    <div class="availability-title"><span>Availability for ${escapeHtml(state.selectedDate ? formatDate(state.selectedDate) : "today")}</span></div>
    <p class="no-slots">${venue.platform === "activesg" ? "Sign in with Singpass on MyActiveSG+ to see open slots and enter ballots." : reason}</p>
  `;
}

function venueCard(venue) {
  const platform = platformOf(venue);
  const tags = [
    venue.courts ? `${venue.courts} court${venue.courts === 1 ? "" : "s"}` : null,
    ...(venue.setting || []),
    isMembersOnly(venue) ? "Members only" : null,
    venue.status === "paused" ? "Bookings paused" : null,
  ].filter(Boolean);
  const live = availability.has(venue.id);

  return `
    <article class="court-card" data-venue="${escapeHtml(venue.id)}">
      <div class="court-visual ${venue.area.toLowerCase()}">
        <span class="provider-badge">${escapeHtml(platform.name)}</span>
      </div>
      <div class="court-content">
        <div class="court-top">
          <div>
            <h3>${escapeHtml(venue.name)}</h3>
            <span class="court-location">
              <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 21s7-6.1 7-12A7 7 0 1 0 5 9c0 5.9 7 12 7 12Zm0-9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5Z"/></svg>
              ${escapeHtml(venue.address)} · ${escapeHtml(venue.area)}
            </span>
          </div>
          <button class="locate-button" type="button" data-locate="${escapeHtml(venue.id)}" aria-label="Show ${escapeHtml(venue.name)} on map">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 21s7-6.1 7-12A7 7 0 1 0 5 9c0 5.9 7 12 7 12Z"/><circle cx="12" cy="9" r="2.5"/></svg>
          </button>
        </div>
        <div class="tags">${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
        <div class="availability-row">${availabilityMarkup(venue)}</div>
        ${venue.notes ? `<p class="venue-note">${escapeHtml(venue.notes)}</p>` : ""}
        <div class="card-foot">
          <div>
            <div class="price">${priceLabel(venue)}</div>
            <span class="source-status ${live ? "verified" : ""}"><i></i>${escapeHtml(venue.hours || "")}</span>
          </div>
          <a class="book-link" href="${escapeHtml(bookingLink(venue))}" target="_blank" rel="noreferrer">
            ${live ? "Book" : "Check availability"} on ${escapeHtml(platform.name)} →
          </a>
        </div>
      </div>
    </article>
  `;
}

function markerStyle(venue) {
  if (availability.has(venue.id)) return { fillColor: "#c8ff49", color: "#17251f" };
  if (isMembersOnly(venue)) return { fillColor: "#9aa39e", color: "#ffffff" };
  return { fillColor: "#276b5b", color: "#ffffff" };
}

function popupMarkup(venue) {
  const platform = platformOf(venue);
  const live = availability.get(venue.id);
  const open = live ? slotsForWindow(live.slots).filter((slot) => slot.availableCourts > 0) : [];
  return `
    <div class="venue-popup">
      <b>${escapeHtml(venue.name)}</b>
      <span>${escapeHtml(venue.address)}</span>
      <span>${priceLabel(venue)} · ${escapeHtml(platform.name)}</span>
      ${live ? `<span class="popup-live">${open.length ? `Open: ${open.slice(0, 6).map((slot) => slot.start).join(", ")}` : "No open times"}</span>` : ""}
      <a href="${escapeHtml(bookingLink(venue))}" target="_blank" rel="noreferrer">${live ? "Book" : "Check availability"} →</a>
    </div>
  `;
}

function ensureMap() {
  if (venueMap || typeof L === "undefined") return;
  venueMap = L.map("venue-map", { zoomControl: true, scrollWheelZoom: false }).setView(SINGAPORE_CENTRE, 11);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(venueMap);
  venueLayer = L.layerGroup().addTo(venueMap);
}

function renderMap(list) {
  ensureMap();
  if (!venueMap) return;
  venueLayer.clearLayers();
  for (const venue of list) {
    L.circleMarker([venue.lat, venue.lon], {
      radius: 8,
      weight: 2,
      fillOpacity: 0.95,
      ...markerStyle(venue),
    })
      .bindPopup(popupMarkup(venue))
      .bindTooltip(escapeHtml(venue.name), { direction: "top", offset: [0, -6] })
      .addTo(venueLayer);
  }
  fitMap(list);
}

// Leaflet can only fit bounds once the map has a size; on phones it starts hidden.
function fitMap(list) {
  if (mapFitted || !list.length || !document.querySelector("#venue-map").offsetWidth) return;
  venueMap.invalidateSize();
  venueMap.fitBounds(L.latLngBounds(list.map((venue) => [venue.lat, venue.lon])), { padding: [24, 24] });
  mapFitted = true;
}

function focusVenue(venueId) {
  const venue = venues.find((item) => item.id === venueId);
  if (!venue || !venueMap) return;
  if (window.matchMedia("(max-width: 980px)").matches) setView("map");
  venueMap.invalidateSize();
  venueMap.setView([venue.lat, venue.lon], 15);
  venueLayer.eachLayer((layer) => {
    const { lat, lng } = layer.getLatLng();
    if (lat === venue.lat && lng === venue.lon) layer.openPopup();
  });
}

function timelineCell(slot, totalCourts, link) {
  if (!slot) return `<td class="cell closed" title="Not bookable"></td>`;
  const ratio = slot.availableCourts / totalCourts;
  const level = slot.availableCourts === 0 ? "none" : ratio >= 0.5 ? "most" : "some";
  return `
    <td class="cell ${level}">
      <a href="${escapeHtml(link)}" target="_blank" rel="noreferrer" title="${slot.availableCourts} of ${totalCourts} courts free">
        ${slot.availableCourts}
      </a>
    </td>`;
}

function renderTimeline(list) {
  document.querySelector("#timeline-date").textContent = state.selectedDate
    ? `${formatDate(state.selectedDate)} · numbers show free courts; tap one to book`
    : "";
  const hours = TIMELINE_HOURS.filter((hour) => state.time === "all" || TIME_WINDOWS[state.time](Number.parseInt(hour, 10)));
  const liveVenues = list.filter((venue) => availability.has(venue.id));

  document.querySelector("#timeline-grid").innerHTML = liveVenues.length
    ? `
      <table class="timeline-table">
        <thead><tr><th scope="col">Venue</th>${hours.map((hour) => `<th scope="col">${hour.slice(0, 2)}</th>`).join("")}</tr></thead>
        <tbody>
          ${liveVenues.map((venue) => {
            const live = availability.get(venue.id);
            const byHour = new Map(live.slots.map((slot) => [slot.start, slot]));
            return `
              <tr>
                <th scope="row">
                  <a href="${escapeHtml(bookingLink(venue))}" target="_blank" rel="noreferrer">${escapeHtml(venue.name)}</a>
                  <small>${escapeHtml(platformOf(venue).name)} · ${statusLabel(live.status)} ${formatCapturedAt(live.capturedAt)}</small>
                </th>
                ${hours.map((hour) => timelineCell(byHour.get(hour), live.totalCourts, bookingLink(venue))).join("")}
              </tr>`;
          }).join("")}
        </tbody>
      </table>`
    : `<div class="empty-state"><b>No live feeds for these filters yet.</b><br />Venues on Playtomic show here once connected. Use the links below for the rest.</div>`;

  const direct = list.filter((venue) => !availability.has(venue.id));
  const groups = new Map();
  for (const venue of direct) {
    if (!groups.has(venue.platform)) groups.set(venue.platform, []);
    groups.get(venue.platform).push(venue);
  }
  document.querySelector("#timeline-direct-list").innerHTML = [...groups.entries()]
    .sort(([, a], [, b]) => b.length - a.length)
    .map(([platformId, items]) => `
      <div class="direct-group">
        <b>${escapeHtml(platforms[platformId]?.name || platformId)}</b>
        <div>${items.map((venue) => `<a href="${escapeHtml(bookingLink(venue))}" target="_blank" rel="noreferrer">${escapeHtml(venue.name)} →</a>`).join("")}</div>
      </div>`)
    .join("");
}

function renderSources() {
  const counts = {};
  for (const venue of venues) counts[venue.platform] = (counts[venue.platform] || 0) + 1;
  const integrationLabel = {
    live: ["Live times", "live"],
    venue_feed: ["Needs venue feed", "feed"],
    deep_link: ["Direct link", "link"],
  };
  document.querySelector("#source-grid").innerHTML = Object.entries(platforms)
    .filter(([id]) => counts[id])
    .sort(([a], [b]) => counts[b] - counts[a])
    .map(([id, platform]) => {
      const [label, modifier] = integrationLabel[platform.integration] || integrationLabel.deep_link;
      const names = venues.filter((venue) => venue.platform === id).map((venue) => venue.name);
      return `
        <article class="source-card">
          <div class="source-card-top">
            <h3>${escapeHtml(platform.name)}</h3>
            <span class="integration ${modifier}">${label}</span>
          </div>
          <p class="source-count">${counts[id]} venue${counts[id] === 1 ? "" : "s"}</p>
          <p>${escapeHtml(platform.access)}</p>
          <p class="source-detail">${escapeHtml(platform.integrationNote)}</p>
          <details><summary>Venues</summary><ul>${names.map((name) => `<li>${escapeHtml(name)}</li>`).join("")}</ul></details>
          <div class="source-actions">
            <button type="button" class="source-filter" data-platform="${escapeHtml(id)}">Show venues</button>
            ${platform.url ? `<a href="${escapeHtml(platform.url)}" target="_blank" rel="noreferrer">Open ${escapeHtml(platform.name)} →</a>` : ""}
          </div>
        </article>`;
    })
    .join("");

  document.querySelector("#social-play").innerHTML = `
    <h3>Looking for a game rather than a court?</h3>
    <div>${socialPlay.map((item) => `
      <a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer"><b>${escapeHtml(item.name)}</b><span>${escapeHtml(item.description)}</span></a>`).join("")}
    </div>`;
}

function renderNotice() {
  const liveVenues = venues.filter((venue) => availability.has(venue.id)).length;
  const connected = providerStatuses.filter((provider) => ["live", "cached"].includes(provider.status)).length;
  dataNotice.innerHTML = `
    <span>DATA STATUS</span>
    ${venues.length} venues across ${Object.keys(platforms).length} booking systems.
    ${liveVenues ? `${liveVenues} showing live or snapshot times from ${connected || "saved"} feed${connected === 1 ? "" : "s"}.` : "No live feeds connected yet."}
    Every other venue links straight to its booking page.
  `;
}

function render() {
  const all = filteredVenues();
  const visible = all.slice(0, state.limit);
  resultCount.textContent = `${all.length} venue${all.length === 1 ? "" : "s"}`;
  cards.innerHTML = visible.length
    ? visible.map(venueCard).join("")
    : `<div class="empty-state"><b>No venues match these filters.</b><br />Try another area or booking system.</div>`;
  document.querySelector("#load-more").hidden = visible.length >= all.length;
  renderMap(all);
  if (state.view === "timeline") renderTimeline(all);
}

function setView(view) {
  state.view = view;
  document.querySelectorAll("[data-view]").forEach((item) => item.classList.toggle("selected", item.dataset.view === view));
  courtLayout.hidden = view === "timeline";
  timelinePanel.hidden = view !== "timeline";
  courtLayout.classList.toggle("map-view", view === "map");
  render();
  if (venueMap) {
    venueMap.invalidateSize();
    fitMap(filteredVenues());
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2600);
}

function applyAvailability(payload) {
  availability = new Map();
  providerStatuses = payload.providers || [];
  for (const court of payload.courts || []) {
    if (court.date !== state.selectedDate || !Array.isArray(court.slots)) continue;
    availability.set(court.courtId, court);
  }
}

async function loadAvailability() {
  try {
    const params = new URLSearchParams({ date: state.selectedDate });
    const response = await fetch(`/api/availability?${params}`, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Availability API returned ${response.status}`);
    applyAvailability(await response.json());
    renderNotice();
  } catch {
    availability = new Map();
    dataNotice.innerHTML = `
      <span>OFFLINE MODE</span>
      The availability API is not running. Start the site with <b>npm start</b> to load live feeds.
    `;
  }
  render();
}

async function loadVenues() {
  const response = await fetch("/api/venues", { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Venues API returned ${response.status}`);
  const payload = await response.json();
  venues = payload.venues;
  platforms = payload.platforms;
  socialPlay = payload.socialPlay || [];

  document.querySelector("#venue-total").textContent = venues.length;
  document.querySelector("#platform-total").textContent = new Set(venues.map((venue) => venue.platform)).size;
  const platformFilter = document.querySelector("#platform-filter");
  for (const [id, platform] of Object.entries(platforms)) {
    if (!venues.some((venue) => venue.platform === id)) continue;
    platformFilter.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(id)}">${escapeHtml(platform.name)}</option>`);
  }
  renderSources();
}

function bindSelect(selector, key) {
  document.querySelector(selector).addEventListener("change", (event) => {
    state[key] = event.target.value;
    state.limit = 8;
    render();
  });
}

document.querySelector("#type-filters").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  document.querySelectorAll("#type-filters button").forEach((item) => item.classList.toggle("selected", item === button));
  state.type = button.dataset.type;
  state.limit = 8;
  render();
});
bindSelect("#area-filter", "area");
bindSelect("#platform-filter", "platform");
bindSelect("#feature-filter", "feature");
bindSelect("#sort-filter", "sort");
document.querySelector("#public-only").addEventListener("change", (event) => {
  state.publicOnly = event.target.checked;
  render();
});
document.querySelector("#load-more").addEventListener("click", () => {
  state.limit += 8;
  render();
});
document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});
cards.addEventListener("click", (event) => {
  const locate = event.target.closest("[data-locate]");
  if (locate) focusVenue(locate.dataset.locate);
});
document.querySelector("#source-grid").addEventListener("click", (event) => {
  const button = event.target.closest("[data-platform]");
  if (!button) return;
  state.platform = button.dataset.platform;
  document.querySelector("#platform-filter").value = state.platform;
  state.limit = 50;
  setView("list");
  document.querySelector("#courts").scrollIntoView({ behavior: "smooth" });
  showToast(`Showing venues booked through ${platforms[state.platform].name}`);
});

document.querySelector("#hero-search").addEventListener("submit", (event) => {
  event.preventDefault();
  state.query = document.querySelector("#hero-location").value.trim();
  state.time = document.querySelector("#hero-time").value;
  state.selectedDate = document.querySelector("#hero-date").value;
  state.limit = 12;
  loadAvailability();
  document.querySelector("#courts").scrollIntoView({ behavior: "smooth" });
});

const localDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Singapore",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
document.querySelector("#hero-date").value = localDate;
state.selectedDate = localDate;

loadVenues()
  .then(loadAvailability)
  .catch(() => {
    dataNotice.innerHTML = `<span>OFFLINE MODE</span> Venue data could not be loaded. Start the site with <b>npm start</b>.`;
  });
