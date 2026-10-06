(() => {
  const state = {
    courts: [],
    filtered: [],
    selectedCourt: null,
    map: null,
    mapLoaded: false,
    community: { reviews: {}, reports: {} },
    user: null,
    pendingCourtLocation: null,
    firebase: { enabled: false, config: null, auth: null },
  };

  const list = document.querySelector("#community-court-list");
  const resultCount = document.querySelector("#community-result-count");
  const totalCount = document.querySelector("#community-count");
  const townFilter = document.querySelector("#community-town");
  const typeFilter = document.querySelector("#community-type");
  const statusFilter = document.querySelector("#community-status");
  const searchInput = document.querySelector("#community-search");
  const courtDialog = document.querySelector("#community-court-dialog");
  const courtDialogContent = document.querySelector("#community-dialog-content");
  const accountButton = document.querySelector("#account-button");
  const accountDialog = document.querySelector("#account-dialog");
  const accountContent = document.querySelector("#account-dialog-content");
  const profileDialog = document.querySelector("#profile-dialog");
  const profileContent = document.querySelector("#profile-dialog-content");
  const addCourtButton = document.querySelector("#add-court-button");
  const addCourtDialog = document.querySelector("#add-court-dialog");
  const addCourtContent = document.querySelector("#add-court-content");
  const courtNavLinks = [...document.querySelectorAll("[data-court-nav]")];

  function escapeHtml(value = "") {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
  }

  function notify(message) {
    if (typeof showToast === "function") {
      showToast(message);
      return;
    }
    const toast = document.querySelector("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    window.setTimeout(() => toast.classList.remove("show"), 2600);
  }

  function initializeCourtNavigation() {
    const paidLink = courtNavLinks.find((link) => link.dataset.courtNav === "paid");
    const freeLink = courtNavLinks.find((link) => link.dataset.courtNav === "free");
    const freeSection = document.querySelector("#community-map");

    function setActiveCourtTab(tab) {
      courtNavLinks.forEach((link) => {
        const active = link.dataset.courtNav === tab;
        link.classList.toggle("active", active);
        if (active) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
      });
    }

    function updateCourtTabFromScroll() {
      const threshold = window.scrollY + Math.min(window.innerHeight * 0.45, 360);
      setActiveCourtTab(threshold >= freeSection.offsetTop ? "free" : "paid");
    }

    paidLink.addEventListener("click", () => setActiveCourtTab("paid"));
    freeLink.addEventListener("click", () => setActiveCourtTab("free"));
    window.addEventListener("scroll", updateCourtTabFromScroll, { passive: true });
    window.addEventListener("resize", updateCourtTabFromScroll);
    updateCourtTabFromScroll();
  }

  function groupByCourt(items) {
    return items.reduce((groups, item) => {
      (groups[item.courtId] ||= []).push(item);
      return groups;
    }, {});
  }

  async function refreshCommunityState() {
    const payload = await api("/api/community-state");
    state.community = {
      reviews: groupByCourt(payload.reviews),
      reports: groupByCourt(payload.reports),
    };
  }

  function recentReports(courtId) {
    return state.community.reports[courtId] || [];
  }

  function statusLabel(status) {
    return {
      available: "Court is available",
      in_use: "Court is in use",
      busy: "Likely busy",
      unavailable: "Court is unavailable",
    }[status] || "No recent report";
  }

  function liveStatus(courtId) {
    const reports = recentReports(courtId);
    if (!reports.length) return { value: "unknown", label: "No recent report", reports };
    return {
      value: reports[0].status,
      label: {
        available: "Available now",
        in_use: "In use",
        busy: "Likely busy",
        unavailable: "Unavailable",
      }[reports[0].status] || "No recent report",
      reports,
    };
  }

  function relativeTime(timestamp) {
    const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
    if (minutes < 1) return "just now";
    if (minutes === 1) return "1 min ago";
    if (minutes < 60) return `${minutes} mins ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    const days = Math.round(hours / 24);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }

  function courtReviews(courtId) {
    return state.community.reviews[courtId] || [];
  }

  function averageRating(courtId) {
    const reviews = courtReviews(courtId);
    if (!reviews.length) return null;
    return reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length;
  }

  function markerColor(courtId) {
    const status = liveStatus(courtId).value;
    if (status === "available") return "#55b96b";
    if (status === "in_use" || status === "busy") return "#ef6d45";
    if (status === "unavailable") return "#8c9690";
    return "#243f35";
  }

  async function initializeMap() {
    if (!window.DinkMap) throw new Error("The map could not load.");
    state.map = await DinkMap.create(document.querySelector("#community-map-canvas"), {
      scrollWheelZoom: true,
    });
    state.mapLoaded = true;
  }

  function populateTowns() {
    const selectedTown = townFilter.value;
    const towns = [...new Set(state.courts.map((court) => court.town))].sort();
    townFilter.innerHTML = [
      '<option value="all">All towns</option>',
      ...towns.map((town) => `<option value="${escapeHtml(town)}">${escapeHtml(town)}</option>`),
    ].join("");
    townFilter.value = towns.includes(selectedTown) ? selectedTown : "all";
  }

  function renderMarkers() {
    if (!state.mapLoaded) return;
    state.map.setMarkers(state.filtered.map((court) => ({
      id: court.id,
      lat: court.lat,
      lon: court.lon,
      shape: "dot",
      size: court.source === "Community" ? 7 : 5,
      strokeWeight: court.source === "Community" ? 2.5 : 1.5,
      color: markerColor(court.id),
      title: court.name,
      onClick: () => openCourt(court.id),
    })));
  }

  function focusCourtOnMap(court) {
    courtDialog.close();
    searchInput.value = "";
    townFilter.value = "all";
    typeFilter.value = "all";
    statusFilter.value = "all";
    applyFilters();

    document.querySelector("#community-map").scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    window.setTimeout(() => {
      state.map.resize();
      state.map.setView(court.lat, court.lon, 18);
      state.map.highlight(court.lat, court.lon, {
        color: markerColor(court.id),
        label: escapeHtml(court.name),
      });
    }, 450);
  }

  function renderList() {
    resultCount.textContent = `${state.filtered.length} courts match`;
    const visible = state.filtered.slice(0, 80);
    list.innerHTML = visible.map((court) => {
      const status = liveStatus(court.id);
      const rating = averageRating(court.id);
      return `
        <button class="community-court-row" data-court-id="${escapeHtml(court.id)}">
          <span class="community-row-status ${status.value}"></span>
          <span class="community-row-main">
            <b>${escapeHtml(court.name)}</b>
            <small>${court.source === "Community"
              ? `${escapeHtml(court.address || court.town)} · added by @${escapeHtml(court.submittedBy.username)}`
              : court.nearestHdb
              ? `${escapeHtml(court.nearestHdb)} · ${court.nearestHdbDistanceM} m away`
              : `${escapeHtml(court.town)} · ${escapeHtml(court.nearestMrt)} ${court.mrtDistanceKm} km`}</small>
            <span>${escapeHtml(court.courtType)} · ${escapeHtml(court.sheltered)}</span>
          </span>
          <span class="community-row-meta">
            <b>${rating ? `★ ${rating.toFixed(1)}` : "New"}</b>
            <small>${escapeHtml(status.label)}</small>
          </span>
        </button>
      `;
    }).join("");
    if (state.filtered.length > visible.length) {
      list.insertAdjacentHTML(
        "beforeend",
        `<p class="list-limit">Showing the first ${visible.length}. Narrow the map using town, type or search.</p>`,
      );
    }
  }

  function applyFilters({ fitMap = false } = {}) {
    const query = searchInput.value.trim().toLowerCase();
    const town = townFilter.value;
    const type = typeFilter.value;
    const status = statusFilter.value;
    state.filtered = state.courts.filter((court) => {
      const haystack = `${court.name} ${court.address || ""} ${court.nearestHdb || ""} ${court.nearestHdbPostcode || ""} ${court.town} ${court.nearestMrt || ""} ${court.courtType}`.toLowerCase();
      const courtStatus = liveStatus(court.id).value;
      return (
        (!query || haystack.includes(query)) &&
        (town === "all" || court.town === town) &&
        (type === "all" || court.courtType === type) &&
        (status === "all" || courtStatus === status)
      );
    });
    renderMarkers();
    renderList();
    if (fitMap && state.mapLoaded && state.filtered.length) {
      state.map.fit(
        state.filtered.map((court) => [court.lat, court.lon]),
        { padding: 45, maxZoom: 15 },
      );
    }
  }

  function infoValue(value) {
    return value && value !== "Unknown"
      ? escapeHtml(value)
      : '<span class="needs-confirmation">Needs confirmation</span>';
  }

  function latestReviewField(court, field, fallback) {
    const review = courtReviews(court.id).find((item) => item[field] && item[field] !== "Unknown");
    return review?.[field] || fallback;
  }

  function renderCourtDialog(court, activeTab = "reviews") {
    const reviews = courtReviews(court.id);
    const rating = averageRating(court.id);
    const status = liveStatus(court.id);
    const photo = court.photoUrl || reviews.find((review) => review.photoUrl)?.photoUrl;
    const markings = latestReviewField(court, "markings", court.markings);
    const net = latestReviewField(court, "net", court.net);
    const surface = latestReviewField(court, "surface", court.surface);
    const lighting = latestReviewField(court, "lighting", court.lighting);
    const shelter = latestReviewField(court, "shelter", court.sheltered);
    const noise = latestReviewField(court, "noise", court.noise);

    courtDialogContent.innerHTML = `
      <div class="court-dialog-hero">
        ${photo
          ? `<img src="${escapeHtml(photo)}" alt="Community photo of ${escapeHtml(court.name)}" />`
          : `<div class="court-photo-placeholder"><span>PHOTO NEEDED</span><b>Be the first to show players this court</b></div>`}
        <div class="court-dialog-title">
          <span class="kicker">${court.source === "Community" ? "PLAYER-ADDED COURT" : "COMMUNITY HARD COURT"}</span>
          <button class="court-map-title" type="button" data-focus-court>
            <span>${escapeHtml(court.name)}</span>
            <small>View exact location on map →</small>
          </button>
          <p>${court.source === "Community"
            ? `${escapeHtml(court.address || court.town)} · submitted by @${escapeHtml(court.submittedBy.username)}`
            : court.nearestHdb
            ? `Nearest HDB: ${escapeHtml(court.nearestHdb)} (${court.nearestHdbDistanceM} m) · ${escapeHtml(court.nearestMrt)} approximately ${court.mrtDistanceKm} km away`
            : `${escapeHtml(court.town)} · ${escapeHtml(court.nearestMrt)} approximately ${court.mrtDistanceKm} km away`}</p>
          <div class="court-dialog-summary">
            <span><b>${rating ? rating.toFixed(1) : "—"}</b> rating</span>
            <span><b>${reviews.length}</b> reviews</span>
            <span class="live-pill ${status.value}"><i></i>${escapeHtml(status.label)}</span>
          </div>
        </div>
      </div>
      <div class="court-facts">
        <div><span>Court type</span><b>${infoValue(court.courtType)}</b></div>
        <div><span>Pickleball markings</span><b>${infoValue(markings)}</b></div>
        <div><span>Net available</span><b>${infoValue(net)}</b></div>
        <div><span>Surface quality</span><b>${infoValue(surface)}</b></div>
        <div><span>Lighting</span><b>${infoValue(lighting)}</b></div>
        <div><span>Shelter</span><b>${infoValue(shelter)}</b></div>
        <div><span>Noise sensitivity</span><b>${infoValue(noise)}</b></div>
        <div><span>${court.source === "Community" ? "Address / nearby block" : "Nearest HDB block"}</span><b>${court.source === "Community"
          ? infoValue(court.address)
          : court.nearestHdb
          ? `${escapeHtml(court.nearestHdb)} · ${court.nearestHdbDistanceM} m`
          : '<span class="needs-confirmation">No nearby HDB match</span>'}</b></div>
      </div>
      <div class="court-tabs" role="tablist">
        <button class="${activeTab === "reviews" ? "selected" : ""}" data-community-tab="reviews">Reviews & photos</button>
        <button class="${activeTab === "live" ? "selected" : ""}" data-community-tab="live">Live court status</button>
      </div>
      <div id="court-tab-panel">${activeTab === "reviews" ? reviewPanel(court) : livePanel(court)}</div>
      <div class="court-data-source">
        ${court.source === "Community"
          ? `Community submission by <button type="button" data-profile="${escapeHtml(court.submittedBy.username)}">@${escapeHtml(court.submittedBy.username)}</button>. Location and court details have not been independently verified.`
          : `Location source: OpenStreetMap ${court.osmType} ${court.osmId}. Nearby block references are approximate; court suitability fields are community supplied.`}
      </div>
    `;
  }

  function reviewPanel(court) {
    const reviews = courtReviews(court.id);
    return `
      <div class="tab-panel-grid">
        <div>
          <h3>Player reviews</h3>
          <div class="review-list">
            ${reviews.length
              ? reviews.map((review) => `
                <article class="review-card">
                  <div><b>${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}</b><span>${relativeTime(review.createdAt)}</span></div>
                  <button class="review-author" type="button" data-profile="${escapeHtml(review.author.username)}">${escapeHtml(review.author.displayName)} · @${escapeHtml(review.author.username)}</button>
                  <p>${escapeHtml(review.comment)}</p>
                  ${review.photoUrl ? `<img class="review-photo" src="${escapeHtml(review.photoUrl)}" alt="Court photo uploaded by ${escapeHtml(review.author.displayName)}" />` : ""}
                  ${reviewDetails(review)}
                </article>
              `).join("")
              : `<div class="empty-community-state">No reviews yet. Confirm the court conditions for the next player.</div>`}
          </div>
        </div>
        ${state.user ? reviewForm() : signInPrompt("Sign in to add a review or upload a court photo.")}
      </div>
    `;
  }

  function reviewDetails(review) {
    const fields = [
      ["Pickleball markings", review.markings],
      ["Net", review.net],
      ["Surface", review.surface],
      ["Lighting", review.lighting],
      ["Shelter", review.shelter],
      ["Noise sensitivity", review.noise],
    ].filter(([, value]) => value && value !== "Unknown");

    if (!fields.length) {
      return '<p class="review-details-empty">Court details were not provided.</p>';
    }

    return `
      <dl class="review-details">
        ${fields.map(([label, value]) => `
          <div>
            <dt>${escapeHtml(label)}</dt>
            <dd>${escapeHtml(value)}</dd>
          </div>
        `).join("")}
      </dl>
    `;
  }

  function reviewForm() {
    return `
      <form id="community-review-form" class="community-form">
        <h3>Add your review</h3>
        <p class="signed-in-as">Posting as <b>${escapeHtml(state.user.displayName)}</b></p>
        <label>Rating
          <select name="rating" required>
            <option value="5">5 — Excellent</option><option value="4">4 — Good</option>
            <option value="3">3 — Okay</option><option value="2">2 — Poor</option><option value="1">1 — Unusable</option>
          </select>
        </label>
        <label>Short review
          <textarea name="comment" maxlength="300" required placeholder="Surface, space, crowds, noise or anything players should know"></textarea>
        </label>
        <div class="form-two-col">
          <label>Pickleball markings<select name="markings"><option>Unknown</option><option>Yes</option><option>No</option><option>Temporary tape</option></select></label>
          <label>Net<select name="net"><option>Unknown</option><option>Permanent</option><option>Bring your own</option></select></label>
          <label>Surface<select name="surface"><option>Unknown</option><option>Good</option><option>Okay</option><option>Slippery</option><option>Uneven</option></select></label>
          <label>Lighting<select name="lighting"><option>Unknown</option><option>Good</option><option>Limited</option><option>No night lighting</option></select></label>
          <label>Shelter<select name="shelter"><option>Unknown</option><option>Sheltered</option><option>Unsheltered</option></select></label>
          <label>Noise sensitivity<select name="noise"><option>Unknown</option><option>Near blocks</option><option>Open area</option><option>Restricted hours</option></select></label>
        </div>
        <label>Photo
          <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" />
          <small>JPEG, PNG or WebP, up to 900 KB. Stored with your review.</small>
        </label>
        <button class="button button-dark" type="submit">Publish review</button>
      </form>
    `;
  }

  function livePanel(court) {
    const status = liveStatus(court.id);
    return `
      <div class="live-tab-layout">
        <div class="live-current">
          <span class="kicker">CURRENT COMMUNITY SIGNAL</span>
          <div class="live-current-status ${status.value}">
            <i></i>
            <div>
              <b>${escapeHtml(status.label)}</b>
              <span>${status.reports.length
                ? `Updated ${relativeTime(status.reports[0].createdAt)} by ${status.reports.length} recent reporter${status.reports.length === 1 ? "" : "s"}`
                : "No reports in the last 90 minutes"}</span>
            </div>
          </div>
          <p>Reports expire after 90 minutes. Check the timestamp before travelling.</p>
          <div class="recent-report-list">
            ${status.reports.slice(0, 5).map((report) => `
              <div>
                <b>${escapeHtml(statusLabel(report.status))}</b>
                <span>${report.players} player${report.players === 1 ? "" : "s"} · ${relativeTime(report.createdAt)} · <button type="button" data-profile="${escapeHtml(report.author.username)}">@${escapeHtml(report.author.username)}</button></span>
              </div>
            `).join("") || "<small>No recent reports.</small>"}
          </div>
        </div>
        ${state.user ? liveReportForm() : signInPrompt("Sign in to submit a live court report.")}
      </div>
    `;
  }

  function liveReportForm() {
    return `
      <form id="community-live-form" class="community-form">
        <h3>Report what you see</h3>
        <p class="signed-in-as">Reporting as <b>${escapeHtml(state.user.displayName)}</b></p>
        <label>Status
          <select name="status" required>
            <option value="available">Court is available</option><option value="in_use">Court is in use</option>
            <option value="busy">Likely busy / people waiting</option><option value="unavailable">Court is unavailable</option>
          </select>
        </label>
        <label>Players currently there<input name="players" type="number" min="0" max="40" value="0" required /></label>
        <label>Optional note<textarea name="note" maxlength="160" placeholder="For example: one group waiting, lights are off"></textarea></label>
        <button class="button button-lime" type="submit">Submit live report</button>
        <small>Reports are linked to your account and expire after 90 minutes.</small>
      </form>
    `;
  }

  function signInPrompt(message) {
    return `
      <div class="auth-required">
        <h3>Account required</h3>
        <p>${escapeHtml(message)}</p>
        <button class="button button-dark" type="button" data-open-account>Sign in or create account</button>
      </div>
    `;
  }

  function openCourt(courtId, tab = "reviews") {
    const court = state.courts.find((item) => item.id === courtId);
    if (!court) return;
    state.selectedCourt = court;
    renderCourtDialog(court, tab);
    courtDialog.showModal();
  }

  async function photoData(input) {
    const file = input.files?.[0];
    if (!file) return "";
    if (file.size > 900000) throw new Error("Please choose a photo smaller than 900 KB.");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      throw new Error("Please choose a JPEG, PNG, or WebP photo.");
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function renderAccountButton() {
    accountButton.textContent = state.user ? state.user.displayName : "Sign in";
    accountButton.classList.toggle("signed-in", Boolean(state.user));
  }

  function renderAuth(mode = "login") {
    accountContent.innerHTML = `
      <span class="kicker">DINKWHERE ACCOUNT</span>
      <h2>${mode === "login" ? "Welcome back" : "Join the community"}</h2>
      <p>${mode === "login" ? "Sign in to manage your reviews and reports." : "Create a public player profile and start contributing."}</p>
      ${state.firebase.enabled ? `
        <button class="google-sign-in" type="button" data-google-sign-in>
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.6h3.2c1.9-1.8 3-4.4 3-7.5Z"/>
            <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.3l-3.2-2.6c-.9.6-2 1-3.4 1a5.8 5.8 0 0 1-5.5-4H3.2v2.6A10 10 0 0 0 12 22Z"/>
            <path fill="#FBBC05" d="M6.5 14a6 6 0 0 1 0-3.9V7.5H3.2a10 10 0 0 0 0 9.2L6.5 14Z"/>
            <path fill="#EA4335" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.8A9.7 9.7 0 0 0 3.2 7.5l3.3 2.6A5.8 5.8 0 0 1 12 6Z"/>
          </svg>
          Continue with Google
        </button>
        <div class="auth-divider"><span>or use a DinkWhere account</span></div>
      ` : `
        <div class="firebase-setup-note">
          Google sign-in will appear after the Firebase web configuration is added to <code>.env</code>.
        </div>
      `}
      <div class="auth-tabs">
        <button class="${mode === "login" ? "selected" : ""}" type="button" data-auth-mode="login">Sign in</button>
        <button class="${mode === "register" ? "selected" : ""}" type="button" data-auth-mode="register">Create account</button>
      </div>
      <form id="${mode === "login" ? "login-form" : "register-form"}" class="account-form">
        ${mode === "register" ? `<label>Display name<input name="displayName" minlength="2" maxlength="40" required autocomplete="name" /></label>` : ""}
        <label>Username<input name="username" minlength="3" maxlength="24" pattern="[a-zA-Z0-9_]+" required autocomplete="username" /></label>
        <label>Password<input name="password" type="password" minlength="8" maxlength="128" required autocomplete="${mode === "login" ? "current-password" : "new-password"}" /></label>
        <button class="button button-dark" type="submit">${mode === "login" ? "Sign in" : "Create account"}</button>
        <small>Usernames are public. Passwords are securely hashed and never displayed.</small>
      </form>
    `;
  }

  function renderOwnAccount() {
    const myReviews = courtReviewsForUser(state.user.username);
    accountContent.innerHTML = `
      <div class="account-profile-heading">
        ${state.user.avatarUrl
          ? `<img src="${escapeHtml(state.user.avatarUrl)}" alt="" referrerpolicy="no-referrer" />`
          : `<span>${escapeHtml(state.user.displayName.slice(0, 1).toUpperCase())}</span>`}
        <div>
          <span class="kicker">YOUR ACCOUNT</span>
          <h2>${escapeHtml(state.user.displayName)}</h2>
          <p>@${escapeHtml(state.user.username)} · ${state.user.authProvider === "google" ? "Google account" : "DinkWhere account"}</p>
        </div>
      </div>
      <form id="profile-form" class="account-form">
        <label>Display name<input name="displayName" minlength="2" maxlength="40" required value="${escapeHtml(state.user.displayName)}" /></label>
        <label>Short bio<textarea name="bio" maxlength="240" placeholder="Tell other players about yourself">${escapeHtml(state.user.bio)}</textarea></label>
        <button class="button button-dark" type="submit">Save profile</button>
      </form>
      <section class="my-reviews">
        <div><h3>My reviews</h3><b>${myReviews.length}</b></div>
        ${myReviews.length ? myReviews.slice(0, 4).map((review) => `
          <button type="button" data-account-court="${escapeHtml(review.courtId)}">
            <span>${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}</span>
            <b>${escapeHtml(courtName(review.courtId))}</b>
            <small>${escapeHtml(review.comment)}</small>
          </button>
        `).join("") : `<p>You have not reviewed a court yet.</p>`}
      </section>
      <div class="account-secondary-actions">
        <button type="button" data-profile="${escapeHtml(state.user.username)}">Open full review history</button>
        <button type="button" data-logout>Sign out</button>
      </div>
    `;
  }

  function courtReviewsForUser(username) {
    return Object.values(state.community.reviews)
      .flat()
      .filter((review) => review.author.username === username)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  function courtName(courtId) {
    return state.courts.find((court) => court.id === courtId)?.name || "Community court";
  }

  async function signInWithGoogle() {
    if (!state.firebase.enabled) throw new Error("Google sign-in is not configured yet.");
    const [{ initializeApp, getApps }, authModule] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js"),
    ]);
    const app = getApps().length ? getApps()[0] : initializeApp(state.firebase.config);
    const auth = authModule.getAuth(app);
    state.firebase.auth = auth;
    const provider = new authModule.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    const credential = await authModule.signInWithPopup(auth, provider);
    const idToken = await credential.user.getIdToken();
    const result = await api("/api/auth/google", {
      method: "POST",
      body: JSON.stringify({ idToken }),
    });
    state.user = result.user;
    renderAccountButton();
    accountDialog.close();
    if (state.selectedCourt && courtDialog.open) renderCourtDialog(state.selectedCourt);
    notify("Signed in with Google.");
  }

  function openAccount() {
    if (state.user) renderOwnAccount();
    else renderAuth("login");
    accountDialog.showModal();
  }

  function renderAddCourtForm({ lat, lon }) {
    addCourtContent.innerHTML = `
      <span class="kicker">COMMUNITY CONTRIBUTION</span>
      <h2>Add a missing court</h2>
      <p>The pin location and details will be public. Add only courts that players can legally access.</p>
      <form id="add-court-form" class="community-form">
        <label>Court name
          <input name="name" minlength="3" maxlength="80" required placeholder="Example: Blk 123 Tampines Hard Court" />
        </label>
        <div class="form-two-col">
          <label>Town or neighbourhood<input name="town" minlength="2" maxlength="40" required placeholder="Tampines" /></label>
          <label>Court type
            <select name="courtType" required>
              <option>Multipurpose court</option>
              <option>Badminton court</option>
              <option>Basketball court</option>
              <option>Dedicated pickleball court</option>
            </select>
          </label>
        </div>
        <label>Address or nearest HDB block
          <input name="address" maxlength="120" placeholder="Blk 123 Tampines Street 11" />
        </label>
        <div class="form-two-col coordinate-fields">
          <label>Latitude<input name="lat" type="number" min="1.12" max="1.52" step="0.000001" required value="${lat.toFixed(6)}" /></label>
          <label>Longitude<input name="lon" type="number" min="103.52" max="104.15" step="0.000001" required value="${lon.toFixed(6)}" /></label>
        </div>
        <small class="location-note">Pin selected from the community map. Close this form and choose “Add a court” again to change it.</small>
        <div class="form-two-col">
          <label>Pickleball markings<select name="markings"><option>Unknown</option><option>Yes</option><option>No</option><option>Temporary tape</option></select></label>
          <label>Net<select name="net"><option>Unknown</option><option>Permanent</option><option>Bring your own</option></select></label>
          <label>Surface<select name="surface"><option>Unknown</option><option>Good</option><option>Okay</option><option>Slippery</option><option>Uneven</option></select></label>
          <label>Lighting<select name="lighting"><option>Unknown</option><option>Good</option><option>Limited</option><option>No night lighting</option></select></label>
          <label>Shelter<select name="shelter"><option>Unknown</option><option>Sheltered</option><option>Unsheltered</option></select></label>
          <label>Noise sensitivity<select name="noise"><option>Unknown</option><option>Near blocks</option><option>Open area</option><option>Restricted hours</option></select></label>
        </div>
        <label>Court photo
          <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" />
          <small>Optional JPEG, PNG or WebP, up to 900 KB.</small>
        </label>
        <label class="submission-confirmation">
          <input name="confirmation" type="checkbox" required />
          <span>I confirm this court exists and is publicly accessible or available with permission.</span>
        </label>
        <button class="button button-dark" type="submit">Add court to the map</button>
      </form>
    `;
  }

  function beginCourtPlacement() {
    if (addCourtButton.classList.contains("placing")) {
      notify("Click the exact court location on the map.");
      return;
    }
    if (!state.user) {
      openAccount();
      notify("Sign in before adding a court.");
      return;
    }
    addCourtButton.textContent = "Click the court on the map";
    addCourtButton.classList.add("placing");
    document.querySelector("#community-map-canvas").classList.add("placing-court");
    notify("Click the exact court location on the map.");
    state.map.onceClick((latlng) => {
      state.pendingCourtLocation = latlng;
      addCourtButton.textContent = "+ Add a court";
      addCourtButton.classList.remove("placing");
      document.querySelector("#community-map-canvas").classList.remove("placing-court");
      renderAddCourtForm(latlng);
      addCourtDialog.showModal();
    });
  }

  async function openProfile(username) {
    try {
      const profile = await api(`/api/profiles/${encodeURIComponent(username)}`);
      const courtNames = Object.fromEntries(state.courts.map((court) => [court.id, court.name]));
      profileContent.innerHTML = `
        <div class="profile-head">
          <div class="profile-avatar">${escapeHtml(profile.user.displayName.slice(0, 1).toUpperCase())}</div>
          <div>
            <span class="kicker">PLAYER PROFILE</span>
            <h2>${escapeHtml(profile.user.displayName)}</h2>
            <p>@${escapeHtml(profile.user.username)} · joined ${new Date(profile.user.createdAt).toLocaleDateString("en-SG", { month: "short", year: "numeric" })}</p>
          </div>
        </div>
        <p class="profile-bio">${escapeHtml(profile.user.bio || "This player has not added a bio yet.")}</p>
        <div class="profile-stats">
          <span><b>${profile.stats.reviews}</b> reviews</span>
          <span><b>${profile.stats.reports}</b> court reports</span>
          <span><b>${profile.stats.courtsAdded || 0}</b> courts added</span>
        </div>
        <h3>Recent reviews</h3>
        <div class="profile-review-list">
          ${profile.reviews.length ? profile.reviews.map((review) => `
            <article>
              <div><b>${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}</b><span>${relativeTime(review.createdAt)}</span></div>
              <strong>${escapeHtml(courtNames[review.courtId] || "Community court")}</strong>
              <p>${escapeHtml(review.comment)}</p>
              ${review.photoUrl ? `<img src="${escapeHtml(review.photoUrl)}" alt="Court uploaded by ${escapeHtml(profile.user.displayName)}" />` : ""}
            </article>
          `).join("") : `<div class="empty-community-state">No reviews yet.</div>`}
        </div>
      `;
      profileDialog.showModal();
    } catch (error) {
      notify(error.message);
    }
  }

  list.addEventListener("click", (event) => {
    const row = event.target.closest("[data-court-id]");
    if (row) openCourt(row.dataset.courtId);
  });

  document.querySelector("[data-close-community]").addEventListener("click", () => courtDialog.close());
  document.querySelector("[data-close-account]").addEventListener("click", () => accountDialog.close());
  document.querySelector("[data-close-profile]").addEventListener("click", () => profileDialog.close());
  document.querySelector("[data-close-add-court]").addEventListener("click", () => addCourtDialog.close());
  accountButton.addEventListener("click", openAccount);
  addCourtButton.addEventListener("click", beginCourtPlacement);

  courtDialogContent.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-community-tab]");
    if (tab && state.selectedCourt) renderCourtDialog(state.selectedCourt, tab.dataset.communityTab);
    const accountTrigger = event.target.closest("[data-open-account]");
    if (accountTrigger) openAccount();
    const profileTrigger = event.target.closest("[data-profile]");
    if (profileTrigger) openProfile(profileTrigger.dataset.profile);
    const mapTrigger = event.target.closest("[data-focus-court]");
    if (mapTrigger && state.selectedCourt) focusCourtOnMap(state.selectedCourt);
  });

  courtDialogContent.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.selectedCourt) return;
    const form = event.target;
    try {
      if (form.id === "community-review-form") {
        const photo = await photoData(form.elements.photo);
        await api(`/api/courts/${encodeURIComponent(state.selectedCourt.id)}/reviews`, {
          method: "POST",
          body: JSON.stringify({
            rating: Number(form.elements.rating.value),
            comment: form.elements.comment.value.trim(),
            markings: form.elements.markings.value,
            net: form.elements.net.value,
            surface: form.elements.surface.value,
            lighting: form.elements.lighting.value,
            shelter: form.elements.shelter.value,
            noise: form.elements.noise.value,
            photo,
          }),
        });
        await refreshCommunityState();
        renderCourtDialog(state.selectedCourt, "reviews");
        applyFilters();
        notify("Your review and photo were saved.");
      }
      if (form.id === "community-live-form") {
        await api(`/api/courts/${encodeURIComponent(state.selectedCourt.id)}/reports`, {
          method: "POST",
          body: JSON.stringify({
            status: form.elements.status.value,
            players: Number(form.elements.players.value),
            note: form.elements.note.value.trim(),
          }),
        });
        await refreshCommunityState();
        renderCourtDialog(state.selectedCourt, "live");
        applyFilters();
        notify("Live court report submitted.");
      }
    } catch (error) {
      notify(error.message);
    }
  });

  accountContent.addEventListener("click", async (event) => {
    const mode = event.target.closest("[data-auth-mode]");
    if (mode) renderAuth(mode.dataset.authMode);
    const profile = event.target.closest("[data-profile]");
    if (profile) {
      accountDialog.close();
      openProfile(profile.dataset.profile);
    }
    const accountCourt = event.target.closest("[data-account-court]");
    if (accountCourt) {
      accountDialog.close();
      openCourt(accountCourt.dataset.accountCourt);
    }
    if (event.target.closest("[data-google-sign-in]")) {
      const button = event.target.closest("[data-google-sign-in]");
      button.disabled = true;
      button.textContent = "Opening Google…";
      try {
        await signInWithGoogle();
      } catch (error) {
        renderAuth("login");
        const message = error.code === "auth/popup-blocked"
          ? "Your browser blocked the Google sign-in popup."
          : error.code === "auth/unauthorized-domain"
            ? "Add this website domain to Firebase Authentication authorized domains."
            : error.code === "auth/popup-closed-by-user"
              ? "Google sign-in was cancelled."
              : error.message;
        notify(message);
      }
    }
    if (event.target.closest("[data-logout]")) {
      try {
        await api("/api/auth/logout", { method: "POST" });
        if (state.firebase.auth) {
          const { signOut } = await import("https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js");
          await signOut(state.firebase.auth);
        }
        state.user = null;
        renderAccountButton();
        accountDialog.close();
        if (state.selectedCourt && courtDialog.open) renderCourtDialog(state.selectedCourt);
        notify("You are signed out.");
      } catch (error) {
        notify(error.message);
      }
    }
  });

  accountContent.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    try {
      if (form.id === "login-form" || form.id === "register-form") {
        const isRegister = form.id === "register-form";
        const payload = {
          username: form.elements.username.value,
          password: form.elements.password.value,
          ...(isRegister ? { displayName: form.elements.displayName.value } : {}),
        };
        const result = await api(`/api/auth/${isRegister ? "register" : "login"}`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        state.user = result.user;
        renderAccountButton();
        accountDialog.close();
        if (state.selectedCourt && courtDialog.open) renderCourtDialog(state.selectedCourt);
        notify(isRegister ? "Your account is ready." : "You are signed in.");
      }
      if (form.id === "profile-form") {
        const result = await api("/api/profile", {
          method: "PATCH",
          body: JSON.stringify({
            displayName: form.elements.displayName.value,
            bio: form.elements.bio.value,
          }),
        });
        state.user = result.user;
        renderAccountButton();
        renderOwnAccount();
        notify("Your profile was updated.");
      }
    } catch (error) {
      notify(error.message);
    }
  });

  profileContent.addEventListener("click", (event) => {
    const courtTrigger = event.target.closest("[data-profile-court]");
    if (courtTrigger) {
      profileDialog.close();
      openCourt(courtTrigger.dataset.profileCourt);
    }
  });

  addCourtContent.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    if (form.id !== "add-court-form") return;
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = "Adding court…";
    try {
      const photo = await photoData(form.elements.photo);
      const result = await api("/api/community-courts", {
        method: "POST",
        body: JSON.stringify({
          name: form.elements.name.value.trim(),
          town: form.elements.town.value.trim(),
          address: form.elements.address.value.trim(),
          courtType: form.elements.courtType.value,
          lat: Number(form.elements.lat.value),
          lon: Number(form.elements.lon.value),
          markings: form.elements.markings.value,
          net: form.elements.net.value,
          surface: form.elements.surface.value,
          lighting: form.elements.lighting.value,
          shelter: form.elements.shelter.value,
          noise: form.elements.noise.value,
          photo,
        }),
      });
      state.courts = [result.court, ...state.courts];
      totalCount.textContent = state.courts.length;
      populateTowns();
      applyFilters();
      state.map.setView(result.court.lat, result.court.lon, 17);
      addCourtDialog.close();
      notify("Court added to the community map.");
      openCourt(result.court.id);
    } catch (error) {
      submitButton.disabled = false;
      submitButton.textContent = "Add court to the map";
      notify(error.message);
    }
  });

  [townFilter, typeFilter, statusFilter].forEach((filter) => {
    filter.addEventListener("change", () => applyFilters({ fitMap: true }));
  });
  searchInput.addEventListener("input", () => applyFilters({ fitMap: true }));

  async function start() {
    try {
      initializeCourtNavigation();
      const [courtPayload, communityPayload, authPayload, firebasePayload] = await Promise.all([
        api("/api/community-courts"),
        api("/api/community-state"),
        api("/api/auth/me"),
        api("/api/auth/firebase-config"),
      ]);
      state.courts = courtPayload.courts;
      state.filtered = courtPayload.courts;
      state.community = {
        reviews: groupByCourt(communityPayload.reviews),
        reports: groupByCourt(communityPayload.reports),
      };
      state.user = authPayload.user;
      state.firebase = {
        enabled: firebasePayload.enabled,
        config: firebasePayload.config,
        auth: null,
      };
      totalCount.textContent = state.courts.length;
      renderAccountButton();
      await initializeMap();
      populateTowns();
      applyFilters();
    } catch (error) {
      resultCount.textContent = "Court map unavailable";
      list.innerHTML = `<div class="empty-community-state">${escapeHtml(error.message)}</div>`;
    }
  }

  start();
})();
