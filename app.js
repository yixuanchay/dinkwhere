const courts = [
  {
    name: "ActiveSG Courts @ Farrer Park",
    area: "Central",
    address: "Farrer Park, Little India",
    provider: "ActiveSG",
    features: ["8 dedicated courts", "Sheltered", "Balloting"],
    rating: 4.8,
    reviews: 34,
    price: 5,
    availability: ["9:00", "10:00", "12:00", "18:00", "19:00"],
    booked: ["18:00"],
    bookingUrl: "https://www.activesg.gov.sg/",
    source: "Official venue",
    x: 48,
    y: 56,
  },
  {
    name: "PickleliZe",
    area: "East",
    address: "125 Pasir Ris Road",
    provider: "Private",
    providerName: "PICKLELIZE",
    features: ["2 dedicated courts", "Sheltered", "Equipment rental"],
    rating: 4.9,
    reviews: 61,
    price: 20,
    availability: ["14:00", "15:00", "17:00", "20:00"],
    booked: ["17:00"],
    bookingUrl: "https://www.picklelize.com/how-to-register",
    source: "CourtReserve",
    x: 82,
    y: 47,
  },
  {
    name: "Play! Pickle @ Tebing Lane",
    area: "North-East",
    address: "10 Tebing Lane, Punggol",
    provider: "Private",
    providerName: "PLAY! PICKLE",
    features: ["6 dedicated courts", "Sheltered", "Coaching"],
    rating: 4.7,
    reviews: 48,
    price: 18,
    availability: ["8:00", "11:00", "13:00", "16:00", "21:00"],
    booked: ["11:00", "16:00"],
    bookingUrl: "https://www.playpickle.sg/",
    source: "Official venue",
    x: 67,
    y: 21,
  },
  {
    name: "Sports Hub Pickleball Courts",
    area: "Central",
    address: "Kallang Tennis Hub & National Stadium",
    provider: "Private",
    providerName: "SPORTS HUB",
    features: ["8 courts", "From $5", "Dual-use"],
    rating: 4.6,
    reviews: 22,
    price: 5,
    availability: ["9:00", "12:00", "15:00", "18:00"],
    booked: ["12:00"],
    bookingUrl: "https://www.sportshub.com.sg/",
    source: "Official venue",
    x: 56,
    y: 62,
  },
  {
    name: "Performance Pickleball @ Expo",
    area: "East",
    address: "Singapore Expo Hall 7, 9 Somapah Road",
    provider: "Private",
    providerName: "PERFORMANCE",
    features: ["Dedicated courts", "Indoor", "Air-conditioned"],
    rating: 4.8,
    reviews: 79,
    price: 24,
    availability: ["10:00", "14:00", "16:00", "22:00"],
    booked: ["14:00"],
    bookingUrl: "https://www.playtomic.com/",
    source: "Playtomic",
    x: 76,
    y: 64,
  },
  {
    name: "MBP Sports @ Marina Square",
    area: "Central",
    address: "6 Raffles Boulevard, #04-105",
    provider: "Private",
    providerName: "MBP SPORTS",
    features: ["Rooftop", "Dedicated", "City centre"],
    rating: 4.5,
    reviews: 43,
    price: 20,
    availability: ["11:00", "13:00", "17:00", "19:00"],
    booked: ["17:00", "19:00"],
    bookingUrl: "https://mbpsports.com/",
    source: "Official venue",
    x: 48,
    y: 68,
  },
  {
    name: "Balmoral Pickleball Club",
    area: "Central",
    address: "32 Stevens Road, Mercure Hotel",
    provider: "Private",
    providerName: "BALMORAL",
    features: ["4 dedicated courts", "Outdoor", "Hotel amenities"],
    rating: 4.7,
    reviews: 36,
    price: 28,
    availability: ["8:00", "10:00", "14:00", "18:00"],
    booked: ["18:00"],
    bookingUrl: "https://playtomic.io/",
    source: "Playtomic",
    x: 42,
    y: 50,
  },
  {
    name: "Straits Pickle Club",
    area: "West",
    address: "2 Jurong Gateway Road",
    provider: "Private",
    providerName: "STRAITS",
    features: ["3 dedicated courts", "Shaded", "Near MRT"],
    rating: 4.6,
    reviews: 27,
    price: 18,
    availability: ["9:00", "13:00", "15:00", "20:00"],
    booked: ["13:00"],
    bookingUrl: "https://straitspickleclub.com/",
    source: "Official venue",
    x: 23,
    y: 55,
  },
  {
    name: "Civil Service Club @ Changi",
    area: "East",
    address: "2 Netheravon Road, Level 5",
    provider: "Private",
    providerName: "CSC CHANGI",
    features: ["Outdoor", "Public same-day", "Member priority"],
    rating: 4.3,
    reviews: 18,
    price: 15,
    availability: ["8:00", "10:00", "13:00", "16:00"],
    booked: ["10:00"],
    bookingUrl: "https://www.cscchangi.sg/",
    source: "Phone / walk-in",
    x: 89,
    y: 55,
  },
  {
    name: "Ubi Pickleball Club",
    area: "East",
    address: "Blk 306 Ubi Avenue 1, Level 3",
    provider: "Community",
    providerName: "RECLUB",
    features: ["Indoor", "Organised play", "All levels"],
    rating: 4.7,
    reviews: 95,
    price: 8,
    availability: ["8:00", "19:00", "20:00"],
    booked: [],
    bookingUrl: "https://reclub.co/clubs/%40ubi-pickleball-club",
    source: "Reclub activity",
    x: 63,
    y: 55,
  },
  {
    name: "Tampines West Street 81 Court",
    area: "East",
    address: "Neighbourhood hard court",
    provider: "Community",
    providerName: "COMMUNITY",
    features: ["Free", "Outdoor", "Community check-in"],
    rating: 4.1,
    reviews: 12,
    price: 0,
    availability: ["Now", "Later today"],
    booked: [],
    bookingUrl: "#community",
    source: "Player reported",
    x: 77,
    y: 51,
  },
  {
    name: "Jurong East Sports Hall",
    area: "West",
    address: "21 Jurong East Street 31",
    provider: "ActiveSG",
    features: ["Multi-use", "Indoor", "Public booking"],
    rating: 4.2,
    reviews: 31,
    price: 7,
    availability: ["7:00", "10:00", "14:00", "21:00"],
    booked: ["10:00", "14:00"],
    bookingUrl: "https://www.activesg.gov.sg/",
    source: "ActiveSG listing",
    x: 18,
    y: 47,
  },
];

const state = {
  type: "all",
  area: "all",
  feature: "all",
  availableOnly: false,
  query: "",
  time: "all",
  sort: "recommended",
  limit: 6,
};

const cards = document.querySelector("#court-cards");
const resultCount = document.querySelector("#result-count");
const mapPins = document.querySelector("#map-pins");
const toast = document.querySelector("#toast");
const courtLayout = document.querySelector(".court-layout");

function timeMatches(court) {
  if (state.time === "all") return true;
  const hours = court.availability
    .map((slot) => Number.parseInt(slot, 10))
    .filter(Number.isFinite);
  if (state.time === "morning") return hours.some((hour) => hour < 12);
  if (state.time === "afternoon") return hours.some((hour) => hour >= 12 && hour < 18);
  return hours.some((hour) => hour >= 18);
}

function filteredCourts() {
  const query = state.query.toLowerCase();
  const list = courts.filter((court) => {
    const typeMatch = state.type === "all" || court.provider === state.type;
    const areaMatch = state.area === "all" || court.area === state.area;
    const featureMatch =
      state.feature === "all" ||
      court.features.some((feature) => feature.toLowerCase().includes(state.feature.toLowerCase()));
    const queryMatch =
      !query ||
      `${court.name} ${court.address} ${court.area}`.toLowerCase().includes(query);
    const availableMatch = !state.availableOnly || court.availability.length > court.booked.length;
    return typeMatch && areaMatch && featureMatch && queryMatch && availableMatch && timeMatches(court);
  });

  return list.sort((a, b) => {
    if (state.sort === "price") return a.price - b.price;
    if (state.sort === "rating") return b.rating - a.rating;
    if (state.sort === "available") {
      return (b.availability.length - b.booked.length) - (a.availability.length - a.booked.length);
    }
    return (b.rating + b.availability.length / 10) - (a.rating + a.availability.length / 10);
  });
}

function courtCard(court) {
  const provider = court.providerName || court.provider.toUpperCase();
  const price = court.price === 0 ? "<b>Free</b>" : `from <b>$${court.price}</b>/hr`;
  const slots = court.availability
    .map((slot) => {
      const booked = court.booked.includes(slot);
      return `<button class="slot ${booked ? "booked" : ""}" ${booked ? "disabled" : ""} data-slot="${court.name}|${slot}">${slot}</button>`;
    })
    .join("");

  return `
    <article class="court-card">
      <div class="court-visual ${court.area.toLowerCase()}">
        <span class="provider-badge">${provider}</span>
      </div>
      <div class="court-content">
        <div class="court-top">
          <div>
            <h3>${court.name}</h3>
            <span class="court-location">
              <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 21s7-6.1 7-12A7 7 0 1 0 5 9c0 5.9 7 12 7 12Zm0-9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5Z"/></svg>
              ${court.address} · ${court.area}
            </span>
          </div>
          <div class="rating"><span>★</span> ${court.rating} <small>(${court.reviews})</small></div>
        </div>
        <div class="tags">${court.features.map((tag) => `<span class="tag">${tag}</span>`).join("")}</div>
        <div class="availability-row">
          <div class="availability-title">
            <span>Illustrative slots today</span>
            <b>${court.availability.length - court.booked.length} available</b>
          </div>
          <div class="slots">${slots}</div>
        </div>
        <div class="card-foot">
          <div>
            <div class="price">${price}</div>
            <span class="source-status"><i></i>${court.source}</span>
          </div>
          <a class="book-link" href="${court.bookingUrl}" target="${court.bookingUrl.startsWith("http") ? "_blank" : "_self"}" rel="noreferrer">View source →</a>
        </div>
      </div>
    </article>
  `;
}

function render() {
  const all = filteredCourts();
  const visible = all.slice(0, state.limit);
  resultCount.textContent = `${all.length} court${all.length === 1 ? "" : "s"}`;
  cards.innerHTML = visible.length
    ? visible.map(courtCard).join("")
    : `<div class="empty-state"><b>No courts match these filters.</b><br />Try another area or court type.</div>`;
  document.querySelector("#load-more").hidden = visible.length >= all.length;

  mapPins.innerHTML = all.map((court) => `
    <button class="map-pin ${court.provider === "Community" ? "community" : ""}" style="left:${court.x}%;top:${court.y}%" aria-label="${court.name}">
      <span class="pin-name">${court.name}</span>
    </button>
  `).join("");
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2600);
}

document.querySelector("#type-filters").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  document.querySelectorAll("#type-filters button").forEach((item) => item.classList.remove("selected"));
  button.classList.add("selected");
  state.type = button.dataset.type;
  state.limit = 6;
  render();
});

document.querySelector("#area-filter").addEventListener("change", (event) => {
  state.area = event.target.value;
  render();
});
document.querySelector("#feature-filter").addEventListener("change", (event) => {
  state.feature = event.target.value;
  render();
});
document.querySelector("#available-only").addEventListener("change", (event) => {
  state.availableOnly = event.target.checked;
  render();
});
document.querySelector("#sort-filter").addEventListener("change", (event) => {
  state.sort = event.target.value;
  render();
});
document.querySelector("#load-more").addEventListener("click", () => {
  state.limit += 6;
  render();
});

document.querySelector("#hero-search").addEventListener("submit", (event) => {
  event.preventDefault();
  state.query = document.querySelector("#hero-location").value.trim();
  state.time = document.querySelector("#hero-time").value;
  state.limit = 12;
  render();
  document.querySelector("#courts").scrollIntoView({ behavior: "smooth" });
});

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-view]").forEach((item) => item.classList.remove("selected"));
    button.classList.add("selected");
    courtLayout.classList.toggle("map-view", button.dataset.view === "map");
  });
});

cards.addEventListener("click", (event) => {
  const button = event.target.closest("[data-slot]");
  if (!button) return;
  const [court, slot] = button.dataset.slot.split("|");
  showToast(`${slot} selected at ${court}. Continue via “View source” to book.`);
});

const dialog = document.querySelector("#checkin-dialog");
document.querySelectorAll("[data-open-checkin]").forEach((button) => {
  button.addEventListener("click", () => dialog.showModal());
});
document.querySelector(".dialog-close").addEventListener("click", () => dialog.close());
document.querySelector("#checkin-form").addEventListener("submit", (event) => {
  event.preventDefault();
  dialog.close();
  showToast("Check-in submitted. Thanks for helping nearby players.");
});

document.querySelectorAll("[data-report]").forEach((button) => {
  button.addEventListener("click", () => showToast("Community report recorded."));
});

const today = new Date();
const localDate = new Date(today.getTime() - today.getTimezoneOffset() * 60000)
  .toISOString()
  .split("T")[0];
document.querySelector("#hero-date").value = localDate;

render();
