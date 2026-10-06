const DAYS_AHEAD = 7;
const TIMELINE_HOURS = Array.from({ length: 17 }, (_, index) => `${String(index + 7).padStart(2, "0")}:00`);
const TIME_WINDOWS = {
  morning: (hour) => hour < 12,
  afternoon: (hour) => hour >= 12 && hour < 18,
  evening: (hour) => hour >= 18,
};
const MARKER_COLORS = { live: "#c8ff49", public: "#2f8a72", members: "#b4bcb7" };

const state = {
  type: "all",
  area: "all",
  platform: "all",
  feature: "all",
  publicOnly: false,
  openOnly: false,
  query: "",
  time: "all",
  sort: "recommended",
  limit: 8,
  startDate: "",
  dates: [],
  day: "all",
  view: "list",
  expanded: new Set(),
};

let venues = [];
let platforms = {};
let socialPlay = [];
// courtId -> Map(date -> availability for that date)
let availability = new Map();
let providerStatuses = [];
let venueMap = null;
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

function singaporeDate(offsetDays = 0, from = new Date()) {
  const date = new Date(from.getTime() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T12:00:00+08:00`);
  return singaporeDate(days, date);
}

function dateParts(isoDate) {
  const date = new Date(`${isoDate}T12:00:00+08:00`);
  const format = (options) => new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", ...options }).format(date);
  const today = singaporeDate();
  const relative = isoDate === today ? "Today" : isoDate === addDays(today, 1) ? "Tomorrow" : "";
  return {
    weekday: format({ weekday: "short" }),
    weekdayLong: format({ weekday: "long" }),
    day: format({ day: "numeric" }),
    month: format({ month: "short" }),
    relative,
  };
}

function longDate(isoDate) {
  const parts = dateParts(isoDate);
  return `${parts.weekdayLong} ${parts.day} ${parts.month}`;
}

function formatTime(start) {
  const hour = Number.parseInt(start, 10);
  const suffix = hour >= 12 ? "pm" : "am";
  const twelve = hour % 12 || 12;
  return `${twelve}${start.slice(2) === ":00" ? "" : start.slice(2)} ${suffix}`;
}

function formatCapturedAt(value) {
  if (!value) return "update time unavailable";
  return new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Singapore",
  }).format(new Date(value));
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

function liveDays(venue) {
  return availability.get(venue.id);
}

function bookingLink(venue) {
  const days = liveDays(venue);
  return (days && [...days.values()][0]?.sourceUrl) || venue.bookingUrl;
}

function isMembersOnly(venue) {
  return venue.access === "members";
}

function visibleDates() {
  return state.day === "all" ? state.dates : [state.day];
}

function openSlots(slots) {
  return slots.filter((slot) =>
    slot.availableCourts > 0 &&
    (state.time === "all" || TIME_WINDOWS[state.time](Number.parseInt(slot.start, 10))));
}

function openSlotsOn(venue, date) {
  const day = liveDays(venue)?.get(date);
  return day ? openSlots(day.slots) : [];
}

function hasOpenSlot(venue) {
  return visibleDates().some((date) => openSlotsOn(venue, date).length > 0);
}

function priceLabel(venue) {
  if (venue.priceFrom === undefined) return `<span class="price-unknown">Price on booking page</span>`;
  const from = Number.isInteger(venue.priceFrom) ? venue.priceFrom : venue.priceFrom.toFixed(2);
  const peak = venue.pricePeak ? `<small>peak $${venue.pricePeak}</small>` : "";
  return `<b>$${from}</b><span>/hr</span>${peak}`;
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
      (!state.openOnly || hasOpenSlot(venue)) &&
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

// Venues with open times first, then anything the public can book online,
// then member clubs and paused venues.
function recommendScore(venue) {
  let score = 0;
  if (hasOpenSlot(venue)) score += 100;
  else if (availability.has(venue.id)) score += 50;
  if (!isMembersOnly(venue)) score += 20;
  if (venue.status === "paused") score -= 40;
  score += Math.min(venue.courts || 0, 10);
  return score;
}

function dayGroupMarkup(venue, date) {
  const day = liveDays(venue).get(date);
  const parts = dateParts(date);
  const slots = day ? openSlots(day.slots) : [];
  const link = escapeHtml(bookingLink(venue));
  const chips = slots.length
    ? slots.map((slot) => `
        <a class="time-chip ${slot.availableCourts / day.totalCourts >= 0.5 ? "plenty" : ""}" href="${link}" target="_blank" rel="noreferrer">
          <b>${formatTime(slot.start)}</b>
          <small>${slot.availableCourts} of ${day.totalCourts} free</small>
        </a>`).join("")
    : `<span class="day-full">${day ? "Fully booked" : "No data yet"}</span>`;
  return `
    <div class="day-group">
      <div class="day-label">
        <b>${parts.weekdayLong}</b>
        <span>${parts.day} ${parts.month}</span>
        ${parts.relative ? `<em>${parts.relative}</em>` : ""}
      </div>
      <div class="day-slots">${chips}</div>
    </div>`;
}

function availabilityMarkup(venue) {
  const platform = platformOf(venue);
  const days = liveDays(venue);

  if (days) {
    const dates = visibleDates().filter((date) => days.has(date));
    const withSlots = dates.filter((date) => openSlotsOn(venue, date).length);
    const expanded = state.expanded.has(venue.id) || state.day !== "all";
    const collapsedDays = window.matchMedia("(max-width: 650px)").matches ? 1 : 2;
    const shown = expanded ? dates : (withSlots.length ? withSlots : dates).slice(0, collapsedDays);
    const remaining = dates.length - shown.length;
    const sample = [...days.values()][0];
    return `
      <div class="day-groups">${shown.map((date) => dayGroupMarkup(venue, date)).join("")}</div>
      <div class="availability-foot">
        <span class="feed-note ${sample.status}">${statusLabel(sample.status)} from ${escapeHtml(platform.name)} · ${formatCapturedAt(sample.capturedAt)}</span>
        ${remaining > 0 ? `<button class="more-days" type="button" data-expand="${escapeHtml(venue.id)}">Show ${remaining} more day${remaining === 1 ? "" : "s"}</button>` : ""}
        ${expanded && state.day === "all" && dates.length > collapsedDays ? `<button class="more-days" type="button" data-collapse="${escapeHtml(venue.id)}">Show fewer days</button>` : ""}
      </div>`;
  }

  const message = venue.platform === "activesg"
    ? "Sign in with Singpass on MyActiveSG+ to see open slots and enter ballots."
    : {
        deep_link: `Open times are on ${escapeHtml(platform.name)}.`,
        venue_feed: `Open times are on ${escapeHtml(platform.name)}. Live times appear here once the venue shares a feed.`,
        live: `Live times from ${escapeHtml(platform.name)} appear here once this venue is connected.`,
      }[platform.integration] || "Open times are on the booking page.";
  return `
    <div class="no-feed">
      <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 3v3M16 3v3M4 9h16M5 5h14v15H5z"/></svg>
      <p>${message}</p>
    </div>`;
}

function venueCard(venue) {
  const platform = platformOf(venue);
  const tags = [
    venue.courts ? `${venue.courts} court${venue.courts === 1 ? "" : "s"}` : null,
    ...(venue.setting || []),
  ].filter(Boolean);
  const live = availability.has(venue.id);
  const flags = [
    isMembersOnly(venue) ? `<span class="flag members">Members only</span>` : "",
    venue.status === "paused" ? `<span class="flag paused">Bookings paused</span>` : "",
    live ? `<span class="flag live">Live times</span>` : "",
  ].join("");

  return `
    <article class="venue-card area-${venue.area.toLowerCase()}" data-venue="${escapeHtml(venue.id)}">
      <header class="venue-head">
        <div class="venue-meta">
          <span class="platform-chip">${escapeHtml(platform.name)}</span>
          <span>${escapeHtml(venue.area)}</span>
          ${flags}
        </div>
        <h3>${escapeHtml(venue.name)}</h3>
        <p class="venue-address">
          ${escapeHtml(venue.address)}
          <a href="${DinkMap.directionsUrl(venue.lat, venue.lon)}" target="_blank" rel="noreferrer">Directions</a>
          <button type="button" data-locate="${escapeHtml(venue.id)}">Show on map</button>
        </p>
        <div class="tags">${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
      </header>
      <section class="venue-availability">${availabilityMarkup(venue)}</section>
      ${venue.notes ? `<p class="venue-note">${escapeHtml(venue.notes)}</p>` : ""}
      <footer class="venue-foot">
        <div class="venue-price">${priceLabel(venue)}</div>
        <span class="venue-hours">${escapeHtml(venue.hours || "")}</span>
        <a class="book-button" href="${escapeHtml(bookingLink(venue))}" target="_blank" rel="noreferrer">
          ${live ? "Book" : "Check times"} on ${escapeHtml(platform.name)}
        </a>
      </footer>
    </article>
  `;
}

function markerColor(venue) {
  if (availability.has(venue.id)) return MARKER_COLORS.live;
  if (isMembersOnly(venue)) return MARKER_COLORS.members;
  return MARKER_COLORS.public;
}

function popupMarkup(venue) {
  const platform = platformOf(venue);
  const nextDay = visibleDates().find((date) => openSlotsOn(venue, date).length);
  const open = nextDay ? openSlotsOn(venue, nextDay) : [];
  return `
    <div class="venue-popup">
      <span class="popup-platform">${escapeHtml(platform.name)} · ${escapeHtml(venue.area)}</span>
      <b>${escapeHtml(venue.name)}</b>
      <span>${escapeHtml(venue.address)}</span>
      <span>${venue.priceFrom !== undefined ? `From $${venue.priceFrom}/hr` : "Price on booking page"}${venue.courts ? ` · ${venue.courts} courts` : ""}</span>
      ${open.length ? `<span class="popup-live">${escapeHtml(longDate(nextDay))}: ${open.slice(0, 5).map((slot) => formatTime(slot.start)).join(", ")}</span>` : ""}
      <span class="popup-actions">
        <a href="${escapeHtml(bookingLink(venue))}" target="_blank" rel="noreferrer">${availability.has(venue.id) ? "Book" : "Check times"}</a>
        <a href="${DinkMap.directionsUrl(venue.lat, venue.lon)}" target="_blank" rel="noreferrer">Directions</a>
      </span>
    </div>
  `;
}

function renderMap(list) {
  if (!venueMap) return;
  venueMap.setMarkers(list.map((venue) => ({
    id: venue.id,
    lat: venue.lat,
    lon: venue.lon,
    shape: "pin",
    color: markerColor(venue),
    label: venue.courts ? String(venue.courts) : "",
    title: venue.name,
    zIndex: availability.has(venue.id) ? 2 : isMembersOnly(venue) ? 0 : 1,
    popup: popupMarkup(venue),
  })));
  fitMap(list);
}

// Maps can only fit their bounds once they have a size; on phones the map
// starts hidden behind the List tab.
function fitMap(list) {
  if (mapFitted || !list.length || !document.querySelector("#venue-map").offsetWidth) return;
  venueMap.resize();
  venueMap.fit(list.map((venue) => [venue.lat, venue.lon]), { padding: 36, maxZoom: 15 });
  mapFitted = true;
}

function focusVenue(venueId) {
  const venue = venues.find((item) => item.id === venueId);
  if (!venue || !venueMap) return;
  if (window.matchMedia("(max-width: 980px)").matches) setView("map");
  venueMap.resize();
  venueMap.setView(venue.lat, venue.lon, 15);
  venueMap.openPopup(venue.id);
  document.querySelector("#map-panel").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function weekCell(venue, date) {
  const day = liveDays(venue)?.get(date);
  if (!day) return `<td class="cell closed" title="No data"></td>`;
  const open = openSlots(day.slots);
  const hours = day.slots.length || 1;
  const level = open.length === 0 ? "none" : open.length / hours >= 0.5 ? "most" : "some";
  return `
    <td class="cell ${level} ${state.day === date ? "selected" : ""}">
      <button type="button" data-day="${date}" title="${open.length} open time${open.length === 1 ? "" : "s"} on ${escapeHtml(longDate(date))}">
        ${open.length}
      </button>
    </td>`;
}

function hourCell(slot, totalCourts, link) {
  if (!slot) return `<td class="cell closed" title="Not bookable"></td>`;
  const ratio = slot.availableCourts / totalCourts;
  const level = slot.availableCourts === 0 ? "none" : ratio >= 0.5 ? "most" : "some";
  return `
    <td class="cell ${level}">
      <a href="${escapeHtml(link)}" target="_blank" rel="noreferrer" title="${slot.availableCourts} of ${totalCourts} courts free">${slot.availableCourts}</a>
    </td>`;
}

function venueRowHead(venue) {
  return `
    <th scope="row">
      <a href="${escapeHtml(bookingLink(venue))}" target="_blank" rel="noreferrer">${escapeHtml(venue.name)}</a>
      <small>${escapeHtml(platformOf(venue).name)} · ${escapeHtml(venue.area)}</small>
    </th>`;
}

function renderTimeline(list) {
  const liveVenues = list.filter((venue) => availability.has(venue.id));
  const focusDay = state.day === "all" ? state.dates[0] : state.day;

  document.querySelector("#timeline-grid").innerHTML = liveVenues.length
    ? `
      <table class="timeline-table week">
        <thead><tr><th scope="col">Venue</th>${state.dates.map((date) => {
          const parts = dateParts(date);
          return `<th scope="col" class="${date === focusDay ? "focus" : ""}"><span>${parts.weekday}</span>${parts.day} ${parts.month}</th>`;
        }).join("")}</tr></thead>
        <tbody>${liveVenues.map((venue) => `<tr>${venueRowHead(venue)}${state.dates.map((date) => weekCell(venue, date)).join("")}</tr>`).join("")}</tbody>
      </table>`
    : `<div class="empty-state"><b>No live feeds for these filters yet.</b><br />Venues on Playtomic and PlayByPoint show here once connected. The links below cover the rest.</div>`;

  const hours = TIMELINE_HOURS.filter((hour) => state.time === "all" || TIME_WINDOWS[state.time](Number.parseInt(hour, 10)));
  document.querySelector("#timeline-day-title").textContent = `Hour by hour · ${longDate(focusDay)}`;
  document.querySelector("#timeline-hours").innerHTML = liveVenues.length
    ? `
      <table class="timeline-table">
        <thead><tr><th scope="col">Venue</th>${hours.map((hour) => `<th scope="col">${formatTime(hour).replace(" ", "")}</th>`).join("")}</tr></thead>
        <tbody>${liveVenues.map((venue) => {
          const day = liveDays(venue).get(focusDay);
          const byHour = new Map((day?.slots || []).map((slot) => [slot.start, slot]));
          return `<tr>${venueRowHead(venue)}${hours.map((hour) => hourCell(byHour.get(hour), day?.totalCourts || 1, bookingLink(venue))).join("")}</tr>`;
        }).join("")}</tbody>
      </table>`
    : "";
  document.querySelector("#timeline-hours-wrap").hidden = !liveVenues.length;

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

function renderDateStrip() {
  const counts = new Map(state.dates.map((date) => [
    date,
    venues.filter((venue) => openSlotsOn(venue, date).length).length,
  ]));
  document.querySelector("#date-strip").innerHTML = `
    <button type="button" class="date-pill all ${state.day === "all" ? "selected" : ""}" data-day="all">
      <span>Next</span><b>${DAYS_AHEAD}</b><small>days</small>
    </button>
    ${state.dates.map((date) => {
      const parts = dateParts(date);
      const count = counts.get(date);
      return `
        <button type="button" class="date-pill ${state.day === date ? "selected" : ""}" data-day="${date}">
          <span>${parts.relative || parts.weekday}</span>
          <b>${parts.day}</b>
          <small>${parts.month}</small>
          ${count ? `<i title="${count} venue${count === 1 ? "" : "s"} with open times">${count}</i>` : ""}
        </button>`;
    }).join("")}`;
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
  const configured = providerStatuses.filter((provider) => provider.configured);
  const down = configured.filter((provider) => provider.status === "unavailable");
  const names = (list) => list.map((provider) => platforms[provider.platform]?.name || provider.platform).join(", ");
  const live = liveVenues
    ? `${liveVenues} venue${liveVenues === 1 ? "" : "s"} show live open times for the next ${DAYS_AHEAD} days.`
    : "No venue is sharing live open times right now.";
  dataNotice.innerHTML = `
    <span>DATA STATUS</span>
    ${venues.length} venues across ${new Set(venues.map((venue) => venue.platform)).size} booking systems. ${live}
    ${down.length ? `Couldn't reach ${escapeHtml(names(down))} just now; those venues link to their booking pages.` : ""}
    Every other venue links straight to its booking page.
  `;
}

function render() {
  const all = filteredVenues();
  const visible = all.slice(0, state.limit);
  resultCount.textContent = `${all.length} venue${all.length === 1 ? "" : "s"}`;
  cards.innerHTML = visible.length
    ? visible.map(venueCard).join("")
    : state.openOnly
      ? `<div class="empty-state"><b>No open courts found for these dates.</b><br />${availability.size ? "Every connected venue is fully booked. Try other dates, or turn off “Open courts only” to see venues you can check directly." : "No booking system is sharing live times right now. Turn off “Open courts only” to see every venue and its booking link."}</div>`
      : `<div class="empty-state"><b>No venues match these filters.</b><br />Try another area or booking system.</div>`;
  document.querySelector("#load-more").hidden = visible.length >= all.length;
  renderDateStrip();
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
  if (venueMap && view !== "timeline") {
    venueMap.resize();
    fitMap(filteredVenues());
  }
}

function setDay(day) {
  state.day = day;
  render();
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
    if (!state.dates.includes(court.date) || !Array.isArray(court.slots)) continue;
    if (!availability.has(court.courtId)) availability.set(court.courtId, new Map());
    availability.get(court.courtId).set(court.date, court);
  }
}

async function loadAvailability() {
  state.dates = Array.from({ length: DAYS_AHEAD }, (_, index) => addDays(state.startDate, index));
  if (state.day !== "all" && !state.dates.includes(state.day)) state.day = "all";
  try {
    const params = new URLSearchParams({ date: state.startDate, days: String(DAYS_AHEAD) });
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

async function loadMap() {
  try {
    venueMap = await DinkMap.create(document.querySelector("#venue-map"));
    document.querySelector("#map-panel").dataset.provider = venueMap.kind;
    render();
  } catch (error) {
    console.warn("Venue map unavailable", error);
  }
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
document.querySelector("#open-only").addEventListener("change", (event) => {
  state.openOnly = event.target.checked;
  state.limit = 8;
  render();
});
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
document.querySelector("#date-strip").addEventListener("click", (event) => {
  const button = event.target.closest("[data-day]");
  if (button) setDay(button.dataset.day);
});
document.querySelector("#timeline-grid").addEventListener("click", (event) => {
  const button = event.target.closest("[data-day]");
  if (button) setDay(button.dataset.day);
});
cards.addEventListener("click", (event) => {
  const locate = event.target.closest("[data-locate]");
  if (locate) focusVenue(locate.dataset.locate);
  const expand = event.target.closest("[data-expand]");
  if (expand) {
    state.expanded.add(expand.dataset.expand);
    render();
  }
  const collapse = event.target.closest("[data-collapse]");
  if (collapse) {
    state.expanded.delete(collapse.dataset.collapse);
    render();
  }
});
document.querySelector("#source-grid").addEventListener("click", (event) => {
  const button = event.target.closest("[data-platform]");
  if (!button) return;
  state.platform = button.dataset.platform;
  document.querySelector("#platform-filter").value = state.platform;
  state.limit = 60;
  setView("list");
  document.querySelector("#courts").scrollIntoView({ behavior: "smooth" });
  showToast(`Showing venues booked through ${platforms[state.platform].name}`);
});

document.querySelector("#hero-search").addEventListener("submit", (event) => {
  event.preventDefault();
  state.query = document.querySelector("#hero-location").value.trim();
  state.time = document.querySelector("#hero-time").value;
  state.startDate = document.querySelector("#hero-date").value || singaporeDate();
  state.day = state.startDate;
  state.limit = 12;
  loadAvailability();
  document.querySelector("#courts").scrollIntoView({ behavior: "smooth" });
});

state.startDate = singaporeDate();
document.querySelector("#hero-date").value = state.startDate;

loadVenues()
  .then(() => Promise.all([loadAvailability(), loadMap()]))
  .catch(() => {
    dataNotice.innerHTML = `<span>OFFLINE MODE</span> Venue data could not be loaded. Start the site with <b>npm start</b>.`;
  });
