// Shared map for the venue finder and the community court map.
//
// Uses Google Maps when the server provides a browser key (GOOGLE_MAPS_API_KEY)
// and falls back to Leaflet with CARTO Voyager tiles otherwise, or when Google
// rejects the key. The Leaflet map also draws Singapore's planning regions
// underneath the tiles, so the island still reads clearly if tiles are blocked.
window.DinkMap = (() => {
  const SINGAPORE = [1.3521, 103.8198];
  const BOUNDS = [[1.15, 103.55], [1.50, 104.10]];
  const GOOGLE_TIMEOUT_MS = 8000;
  const GOOGLE_STYLE = [
    { elementType: "geometry", stylers: [{ color: "#f3f1ea" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#5c6a63" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#f6f5ef" }] },
    { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#cfd6cf" }] },
    { featureType: "poi", stylers: [{ visibility: "off" }] },
    { featureType: "poi.park", stylers: [{ visibility: "on" }] },
    { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#d9e8d2" }] },
    { featureType: "poi.park", elementType: "labels", stylers: [{ visibility: "off" }] },
    { featureType: "poi.sports_complex", stylers: [{ visibility: "on" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
    { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#fbe7b5" }] },
    { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#efd28a" }] },
    { featureType: "road", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
    { featureType: "transit.line", elementType: "geometry", stylers: [{ color: "#c9d3cd" }] },
    { featureType: "transit.station.rail", elementType: "labels.icon", stylers: [{ visibility: "on" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#bfdde0" }] },
    { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#6f9497" }] },
  ];

  let configPromise = null;
  let googlePromise = null;
  let regionsPromise = null;

  function mapConfig() {
    configPromise ||= fetch("/api/map-config", { headers: { Accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : {}))
      .catch(() => ({}));
    return configPromise;
  }

  function loadGoogle(key) {
    if (window.google?.maps?.Map) return Promise.resolve(window.google.maps);
    googlePromise ||= new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("Google Maps timed out")), GOOGLE_TIMEOUT_MS);
      window.__dinkGoogleReady = () => {
        window.clearTimeout(timer);
        resolve(window.google.maps);
      };
      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=__dinkGoogleReady`;
      script.async = true;
      script.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error("Google Maps could not load"));
      };
      document.head.append(script);
    });
    return googlePromise;
  }

  function loadRegions() {
    regionsPromise ||= fetch("assets/singapore-regions.json")
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null);
    return regionsPromise;
  }

  function pinSvg(color, label) {
    const size = String(label).length > 1 ? 10.5 : 12;
    const text = label ? `<text x="18" y="21" text-anchor="middle" font-family="DM Sans, Arial, sans-serif" font-size="${size}" font-weight="800" fill="#17251f">${label}</text>` : "";
    return `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="46" viewBox="0 0 36 46"><path d="M18 45C18 45 3 28.5 3 17.5a15 15 0 0 1 30 0C33 28.5 18 45 18 45Z" fill="${color}" stroke="#17251f" stroke-width="2"/><circle cx="18" cy="17" r="10" fill="#ffffff"/>${text}</svg>`;
  }

  function googleEngine(element, maps, options) {
    const map = new maps.Map(element, {
      center: { lat: options.center[0], lng: options.center[1] },
      zoom: options.zoom,
      minZoom: options.minZoom,
      styles: GOOGLE_STYLE,
      disableDefaultUI: true,
      zoomControl: true,
      fullscreenControl: true,
      gestureHandling: "cooperative",
      clickableIcons: false,
      restriction: { latLngBounds: { south: BOUNDS[0][0], west: BOUNDS[0][1], north: BOUNDS[1][0], east: BOUNDS[1][1] } },
    });
    const info = new maps.InfoWindow();
    let markers = new Map();
    let highlight = null;

    return {
      kind: "google",
      setMarkers(items) {
        markers.forEach((marker) => marker.setMap(null));
        markers = new Map();
        for (const item of items) {
          const icon = item.shape === "pin"
            ? {
                url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(pinSvg(item.color, item.label))}`,
                scaledSize: new maps.Size(34, 44),
                anchor: new maps.Point(17, 43),
              }
            : {
                path: maps.SymbolPath.CIRCLE,
                scale: item.size || 6,
                fillColor: item.color,
                fillOpacity: 0.95,
                strokeColor: item.stroke || "#ffffff",
                strokeWeight: item.strokeWeight || 1.5,
              };
          const marker = new maps.Marker({
            map,
            position: { lat: item.lat, lng: item.lon },
            title: item.title,
            icon,
            zIndex: item.zIndex,
            optimized: true,
          });
          marker.addListener("click", () => {
            if (item.popup) {
              info.setContent(item.popup);
              info.open({ map, anchor: marker });
            }
            item.onClick?.();
          });
          markers.set(item.id, { marker, item });
        }
      },
      openPopup(id) {
        const entry = markers.get(id);
        if (!entry?.item.popup) return;
        info.setContent(entry.item.popup);
        info.open({ map, anchor: entry.marker });
      },
      fit(points, { padding = 32, maxZoom = 16 } = {}) {
        if (!points.length) return;
        const bounds = new maps.LatLngBounds();
        points.forEach(([lat, lon]) => bounds.extend({ lat, lng: lon }));
        map.fitBounds(bounds, padding);
        maps.event.addListenerOnce(map, "idle", () => {
          if (map.getZoom() > maxZoom) map.setZoom(maxZoom);
        });
      },
      setView(lat, lon, zoom) {
        map.panTo({ lat, lng: lon });
        if (zoom) map.setZoom(zoom);
      },
      highlight(lat, lon, { color, label }) {
        highlight?.setMap(null);
        highlight = new maps.Marker({
          map,
          position: { lat, lng: lon },
          title: label,
          zIndex: 9999,
          icon: { path: maps.SymbolPath.CIRCLE, scale: 13, fillColor: color, fillOpacity: 0.9, strokeColor: "#b6ff3b", strokeWeight: 5 },
        });
        info.setContent(`<div class="venue-popup"><b>${label}</b></div>`);
        info.open({ map, anchor: highlight });
      },
      onceClick(callback) {
        maps.event.addListenerOnce(map, "click", (event) => callback({ lat: event.latLng.lat(), lng: event.latLng.lng() }));
      },
      resize() {
        maps.event.trigger(map, "resize");
      },
      destroy() {
        markers.forEach((entry) => entry.marker.setMap(null));
        element.replaceChildren();
      },
    };
  }

  function leafletEngine(element, options) {
    const map = L.map(element, {
      minZoom: options.minZoom,
      maxBounds: BOUNDS,
      maxBoundsViscosity: 0.7,
      scrollWheelZoom: options.scrollWheelZoom ?? false,
      zoomControl: true,
    }).setView(options.center, options.zoom);
    map.createPane("regions").style.zIndex = 150;
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      subdomains: "abcd",
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(map);
    element.classList.add("dink-leaflet");

    loadRegions().then((regions) => {
      if (!regions) return;
      L.geoJSON(regions, {
        pane: "regions",
        interactive: false,
        style: { color: "#c3d0c6", weight: 1, fillColor: "#eef1e8", fillOpacity: 1 },
        onEachFeature: (feature, layer) => {
          L.marker(layer.getBounds().getCenter(), {
            pane: "regions",
            interactive: false,
            icon: L.divIcon({ className: "region-label", html: feature.properties.area.toUpperCase(), iconSize: null }),
          }).addTo(map);
        },
      }).addTo(map);
    });

    const layer = L.layerGroup().addTo(map);
    let markers = new Map();
    let highlight = null;

    return {
      kind: "leaflet",
      setMarkers(items) {
        layer.clearLayers();
        markers = new Map();
        for (const item of items) {
          const marker = item.shape === "pin"
            ? L.marker([item.lat, item.lon], {
                icon: L.divIcon({
                  className: "dink-pin",
                  html: pinSvg(item.color, item.label),
                  iconSize: [34, 44],
                  iconAnchor: [17, 43],
                  popupAnchor: [0, -38],
                }),
                title: item.title,
                zIndexOffset: item.zIndex || 0,
              })
            : L.circleMarker([item.lat, item.lon], {
                radius: item.size || 6,
                color: item.stroke || "#ffffff",
                weight: item.strokeWeight || 1.5,
                fillColor: item.color,
                fillOpacity: 0.95,
              }).bindTooltip(item.title, { direction: "top" });
          if (item.popup) marker.bindPopup(item.popup, { maxWidth: 280 });
          if (item.onClick) marker.on("click", item.onClick);
          marker.addTo(layer);
          markers.set(item.id, marker);
        }
      },
      openPopup(id) {
        markers.get(id)?.openPopup();
      },
      fit(points, { padding = 32, maxZoom = 16 } = {}) {
        if (!points.length) return;
        map.fitBounds(L.latLngBounds(points), { padding: [padding, padding], maxZoom });
      },
      setView(lat, lon, zoom) {
        map.setView([lat, lon], zoom || map.getZoom(), { animate: true });
      },
      highlight(lat, lon, { color, label }) {
        if (highlight) map.removeLayer(highlight);
        highlight = L.circleMarker([lat, lon], {
          radius: 15,
          color: "#b6ff3b",
          weight: 5,
          fillColor: color,
          fillOpacity: 0.9,
          className: "court-focus-ring",
        })
          .bindTooltip(label, { direction: "top", permanent: true, offset: [0, -12] })
          .addTo(map)
          .openTooltip();
      },
      onceClick(callback) {
        map.once("click", (event) => callback({ lat: event.latlng.lat, lng: event.latlng.lng }));
      },
      resize() {
        map.invalidateSize();
      },
      destroy() {
        map.remove();
        element.classList.remove("dink-leaflet");
      },
    };
  }

  // The wrapper remembers what was drawn so it can redraw on the fallback map
  // if Google rejects the key after the map has already been shown.
  async function create(element, options = {}) {
    const settings = { center: SINGAPORE, zoom: 11, minZoom: 10, ...options };
    const { googleMapsApiKey } = await mapConfig();
    let engine = null;
    let lastMarkers = [];
    let lastView = null;

    const useLeaflet = () => {
      engine?.destroy();
      engine = leafletEngine(element, settings);
      engine.setMarkers(lastMarkers);
      if (lastView) engine.fit(...lastView);
    };

    if (googleMapsApiKey) {
      try {
        const maps = await loadGoogle(googleMapsApiKey);
        engine = googleEngine(element, maps, settings);
        window.gm_authFailure = () => {
          console.warn("Google Maps rejected the API key; using the fallback map.");
          useLeaflet();
        };
      } catch (error) {
        console.warn(`${error.message}; using the fallback map.`);
      }
    }
    if (!engine) useLeaflet();

    return {
      get kind() {
        return engine.kind;
      },
      setMarkers(items) {
        lastMarkers = items;
        engine.setMarkers(items);
      },
      fit(points, fitOptions) {
        lastView = [points, fitOptions];
        engine.fit(points, fitOptions);
      },
      openPopup: (id) => engine.openPopup(id),
      setView: (lat, lon, zoom) => engine.setView(lat, lon, zoom),
      highlight: (lat, lon, details) => engine.highlight(lat, lon, details),
      onceClick: (callback) => engine.onceClick(callback),
      resize: () => engine.resize(),
    };
  }

  function directionsUrl(lat, lon) {
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
  }

  return { create, directionsUrl };
})();
