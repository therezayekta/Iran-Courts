// ═══════════════════════════════════════════════════════════════════════════
// MAP INIT
// ═══════════════════════════════════════════════════════════════════════════

const map = L.map("map", {
  minZoom: 5,
  maxZoom: 17,
  zoomControl: true,
  attributionControl: true,
  zoomSnap: 0.5,
  tap: true,
  tapTolerance: 15,
  preferCanvas: true,
});

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  updateWhenIdle: true,
  keepBuffer: 3,
}).addTo(map);

// Iran bounds — tighter mobile fit so the country is always fully visible
const iranBounds = L.latLngBounds([24.5, 44.0], [40.0, 64.0]);
map.setMaxBounds(iranBounds.pad(0.2));
// Use tighter padding on mobile so Iran fills the viewport
const isMobile = window.innerWidth <= 600;
map.fitBounds(iranBounds, { padding: isMobile ? [10, 10] : [48, 48] });

// Zoom thresholds
const SHAHRESTAN_ZOOM = 7.0; // show shahrestan borders + labels
const CITY_ZOOM = 10.0; // show city district layers

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function toPersianNum(n) {
  return String(n)
    .split("")
    .map((d) => "۰۱۲۳۴۵۶۷۸۹"[d] ?? d)
    .join("");
}

// Robust lookup for courtData that handles spelling variations
function getCourtData(key) {
  if (!key) return [];
  if (typeof courtData === "undefined") return [];
  if (courtData[key]) return courtData[key];

  const targetPersian =
    persianProvinceNames[key] || persianShahrestanNames[key] || key;
  const cleanTarget = targetPersian.replace(/\s+/g, "").replace("و", "");

  for (const k of Object.keys(courtData)) {
    const kPersian = persianProvinceNames[k] || persianShahrestanNames[k] || k;
    const cleanK = kPersian.replace(/\s+/g, "").replace("و", "");
    if (cleanK === cleanTarget) return courtData[k];
  }
  return [];
}

// ═══════════════════════════════════════════════════════════════════════════
// CITY DISTRICT REGISTRY
// Each entry defines one city's district layer.
// ── Schema ──────────────────────────────────────────────────────────────
// id          : unique key (matches filename under data/)
// filePath    : GeoJSON path
// persianName : Persian display name of the city
// provinceName: GADM NAME_1 of the parent province (used to auto-activate)
// viewBounds  : L.latLngBounds([sw], [ne]) — viewport where layer is shown
// districtCount: total districts (for color palette cycling)
// getDistrict : fn(feature.properties) → integer district number (1-based)
// getLabel    : fn(feature.properties) → Persian label string
// getCourtKey : fn(districtNum) → key for cityDistrictCourts lookup
// filter      : optional fn(feature) → bool — skip unwanted features
// ════════════════════════════════════════════════════════════════════════

const CITY_DISTRICT_REGISTRY = [
  {
    id: "tehran",
    filePath: "data/tehran-districts.json",
    persianName: "تهران",
    provinceName: "Tehran",
    viewBounds: L.latLngBounds([35.534, 51.05], [35.87, 51.66]),
    districtCount: 22,
    getDistrict: (props) => props.district,
    getLabel: (props) => toPersianNum(props.district),
    getCourtKey: (num) => num,
    filter: null, // accept all features
    courtsLookup: () =>
      typeof tehranDistrictCourts !== "undefined" ? tehranDistrictCourts : {},
  },
  {
    id: "isfahan",
    filePath: "data/isfahan.geojson",
    persianName: "اصفهان",
    provinceName: "Isfahan",
    viewBounds: L.latLngBounds([32.52, 51.48], [32.82, 51.82]),
    districtCount: 15,
    getDistrict: (props) => {
      // "District 15" → 15
      const en = props["name:en"] || "";
      const m = en.match(/District\s+(\d+)/i);
      return m ? parseInt(m[1], 10) : null;
    },
    getLabel: (props) => {
      // Use Persian name directly: "منطقه ۱۵"
      return props["name"] || props["name:fa"] || "";
    },
    getCourtKey: (num) => num,
    filter: (feature) => {
      // Only keep the 15 municipal districts (admin_level 9)
      return feature.properties.admin_level === "9";
    },
    courtsLookup: () =>
      typeof isfahanDistrictCourts !== "undefined" ? isfahanDistrictCourts : {},
  },
  // ── Add future cities here ───────────────────────────────────────────
  // {
  //   id: "mashhad",
  //   filePath: "data/mashhad-districts.json",
  //   persianName: "مشهد",
  //   provinceName: "Razavi Khorasan",
  //   viewBounds: L.latLngBounds([36.2, 59.4], [36.5, 59.8]),
  //   districtCount: 13,
  //   getDistrict: (props) => props.district_no,
  //   getLabel: (props) => toPersianNum(props.district_no),
  //   getCourtKey: (num) => num,
  //   filter: null,
  //   courtsLookup: () => typeof mashhadDistrictCourts !== "undefined" ? mashhadDistrictCourts : {},
  // },
];

// ═══════════════════════════════════════════════════════════════════════════
// DISTRICT COLOUR PALETTE — 22 distinct colours (shared across all cities)
// ═══════════════════════════════════════════════════════════════════════════

const DISTRICT_COLORS = [
  "#2b6cb0",
  "#319795",
  "#4a5568",
  "#dd6b20",
  "#d69e2e",
  "#38a169",
  "#4c51bf",
  "#805ad5",
  "#e53e3e",
  "#3182ce",
  "#2c7a7b",
  "#718096",
  "#c53030",
  "#b7791f",
  "#b7791f",
  "#276749",
  "#4a5568",
  "#2b6cb0",
  "#dd6b20",
  "#2c7a7b",
  "#4c51bf",
  "#805ad5",
];

function districtColor(num) {
  return DISTRICT_COLORS[(num - 1) % DISTRICT_COLORS.length];
}

// ═══════════════════════════════════════════════════════════════════════════
// MAP STYLES
// ═══════════════════════════════════════════════════════════════════════════

const provinceDefault = {
  color: "#475569",
  weight: 1.8,
  fillColor: "#64748b",
  fillOpacity: 0.04, // very light — map detail shows through
};
const provinceHover = { fillColor: "#b45309", fillOpacity: 0.1, weight: 2.2 };
const provinceSelected = {
  fillColor: "#1e293b",
  fillOpacity: 0.14,
  weight: 2.8,
  color: "#0f172a",
};

const shahrestanDefault = {
  color: "#94a3b8",
  weight: 0.6,
  fillColor: "#cbd5e1",
  fillOpacity: 0.02, // near-transparent — border lines only
  dashArray: "3,3",
};
const shahrestanHover = {
  fillColor: "#b45309",
  fillOpacity: 0.12,
  weight: 1.2,
};
const shahrestanSelected = {
  fillColor: "#1e293b",
  fillOpacity: 0.14,
  weight: 1.6,
  color: "#334155",
};

// ═══════════════════════════════════════════════════════════════════════════
// STATE VARIABLES
// ═══════════════════════════════════════════════════════════════════════════

let provinceLayers = [];
let searchActiveMarker = null;
let selectedProvinceLayer = null;
let selectedProvinceName = null;
let selectedProvinceBounds = null;
let districtLayerGroup = null;
let selectedDistrictLayer = null;
let cityLabelLayer = null;
let provinceLabelGroup = null;
let shahrestanLabelGroup = null;

// City district runtime state — keyed by registry id
// cityDistrictState[id] = { layerGroup, labelGroup, selectedLayer, loaded }
const cityDistrictState = {};

// ═══════════════════════════════════════════════════════════════════════════
// POPUP SYSTEM
// ═══════════════════════════════════════════════════════════════════════════

function findProvinceData(displayName) {
  if (!displayName) return null;
  const normalized = displayName.replace(/\s+/g, "");
  return iranProvincesAndCities.find((p) => {
    const pNorm = p.province.replace(/\s+/g, "");
    return (
      pNorm === normalized ||
      pNorm.includes(normalized) ||
      normalized.includes(pNorm) ||
      pNorm.replace("و", "") === normalized.replace("و", "")
    );
  });
}

function showPopup(title, courts) {
  const popup = document.getElementById("info-popup");
  document.getElementById("popup-title").textContent = title;

  const provinceInfo = findProvinceData(title);
  if (!provinceInfo) {
    renderStandardPopupBody(courts);
  } else {
    renderProvincePopupBody(title, provinceInfo, courts);
  }

  popup.classList.add("visible");
}

function renderStandardPopupBody(courts) {
  const body = document.getElementById("popup-body");
  if (!courts || courts.length === 0) {
    body.innerHTML =
      '<p class="popup-empty">اطلاعاتی برای این منطقه یا شهرستان در سامانه ثبت نشده است.</p>';
  } else {
    const cards = courts
      .map((c) => {
        const specs = (c.specialization || [])
          .map((s) => `<span class="spec-tag">${s}</span>`)
          .join("");
        const mapsUrl = `https://www.google.com/maps?q=${c.lat},${c.lng}`;
        return `
        <div class="court-card">
          <h3>${c.name}</h3>
          <p class="district-label">🏙️ ${c.district}</p>
          <p>📍 ${c.address}</p>
          ${specs ? `<div class="spec-list">${specs}</div>` : ""}
          <a class="maps-link" href="${mapsUrl}" target="_blank" rel="noopener">📌 مشاهده مکان روی نقشه گوگل</a>
        </div>`;
      })
      .join("");
    body.innerHTML =
      `<div class="court-count">${toPersianNum(courts.length)} مرکز قضایی فعال</div>` +
      cards;
  }
}

function renderProvincePopupBody(title, provinceInfo, courts) {
  const body = document.getElementById("popup-body");

  let courtsHTML = "";
  if (!courts || courts.length === 0) {
    courtsHTML =
      '<p class="popup-empty">مراکز قضایی این استان در سامانه ثبت نشده است.</p>';
  } else {
    const cards = courts
      .map((c) => {
        const specs = (c.specialization || [])
          .map((s) => `<span class="spec-tag">${s}</span>`)
          .join("");
        const mapsUrl = `https://www.google.com/maps?q=${c.lat},${c.lng}`;
        return `
        <div class="court-card">
          <h3>${c.name}</h3>
          <p class="district-label">🏙️ ${c.district}</p>
          <p>📍 ${c.address}</p>
          ${specs ? `<div class="spec-list">${specs}</div>` : ""}
          <a class="maps-link" href="${mapsUrl}" target="_blank" rel="noopener">📌 مشاهده مکان روی نقشه گوگل</a>
        </div>`;
      })
      .join("");
    courtsHTML =
      `<div class="court-count">${toPersianNum(courts.length)} مرکز قضایی فعال</div>` +
      cards;
  }

  body.innerHTML = `
    <div id="tab-courts-content" class="active">
      ${courtsHTML}
    </div>
  `;
}

function switchPopupTab(tabName) {
  const courtsBtn = document.getElementById("tab-courts-btn");
  const citiesBtn = document.getElementById("tab-cities-btn");
  const courtsContent = document.getElementById("tab-courts-content");
  const citiesContent = document.getElementById("tab-cities-content");

  if (tabName === "courts") {
    if (courtsBtn) courtsBtn.classList.add("active");
    if (citiesBtn) citiesBtn.classList.remove("active");
    if (courtsContent) courtsContent.classList.add("active");
    if (citiesContent) citiesContent.classList.remove("active");
  } else {
    if (courtsBtn) courtsBtn.classList.remove("active");
    if (citiesBtn) citiesBtn.classList.add("active");
    if (courtsContent) courtsContent.classList.remove("active");
    if (citiesContent) citiesContent.classList.add("active");
  }
}

function zoomToCity(cityName, provinceName) {
  const foundCity = majorCities.find(
    (c) =>
      c.name === cityName ||
      cityName.includes(c.name) ||
      c.name.includes(cityName),
  );

  if (foundCity) {
    map.flyTo([foundCity.lat, foundCity.lng], 11, { duration: 1.0 });

    if (searchActiveMarker) map.removeLayer(searchActiveMarker);

    searchActiveMarker = L.circleMarker([foundCity.lat, foundCity.lng], {
      radius: 12,
      fillColor: "#b45309",
      fillOpacity: 0.6,
      color: "#ffffff",
      weight: 3,
    }).addTo(map);

    searchActiveMarker
      .bindPopup(`<b>شهر ${cityName}</b><br>استان ${provinceName}`)
      .openPopup();
  } else {
    showToastNotification(
      `بزرگنمایی محدوده شهرستان انجام شد. شهر: ${cityName}`,
    );
    if (selectedProvinceBounds)
      map.fitBounds(selectedProvinceBounds, { padding: [100, 100] });
  }
}

function showToastNotification(message) {
  let toast = document.getElementById("toast-notification");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast-notification";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = "visible";
  setTimeout(() => {
    toast.className = "";
  }, 3500);
}

// ── NEW API AUTOCOMPLETE & SEARCH LOGIC ───────────────────────────────────
let searchTimeout = null;

function handleSearch(query) {
  const resultsContainer = document.getElementById("search-results");
  if (!query || query.trim() === "") {
    resultsContainer.classList.add("hidden");
    return;
  }

  if (searchTimeout) clearTimeout(searchTimeout);

  searchTimeout = setTimeout(() => {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=ir&limit=6&accept-language=fa`;

    fetch(url, { headers: { "User-Agent": "IranCourtsMap/1.0" } })
      .then((res) => res.json())
      .then((data) => {
        if (!data || data.length === 0) {
          resultsContainer.innerHTML = `<div class="search-item" style="cursor:default; justify-content:center; color:#64748b;">موردی یافت نشد</div>`;
        } else {
          resultsContainer.innerHTML = data
            .map((item) => {
              const parts = item.display_name.split(",");
              const title = parts[0];
              const subtitle = parts.slice(1, 3).join(",") || "ایران";
              return `
                <div class="search-item" onclick="selectAddressResult(${item.lat}, ${item.lon}, '${item.display_name.replace(/'/g, "\\'")}')">
                  <div style="display:flex; flex-direction:column; gap:2px; min-width:0; text-align:right;">
                    <span class="search-item-title" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${title}</span>
                    <span style="font-size:10px; color:#64748b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${subtitle}</span>
                  </div>
                  <span class="search-item-badge">مکان</span>
                </div>`;
            })
            .join("");
        }
        resultsContainer.classList.remove("hidden");
      })
      .catch(() => {});
  }, 400);
}

function showResultsIfNotEmpty() {
  const query = document.getElementById("search-input").value;
  handleSearch(query);
}

function hideResultsWithDelay() {
  setTimeout(() => {
    const rc = document.getElementById("search-results");
    if (rc) rc.classList.add("hidden");
  }, 300);
}

function selectAddressResult(lat, lon, displayName) {
  document.getElementById("search-input").value = displayName.split(",")[0];
  document.getElementById("search-results").classList.add("hidden");

  const latlng = L.latLng(lat, lon);
  if (searchActiveMarker) map.removeLayer(searchActiveMarker);

  // Pin location marker icon onto the map
  searchActiveMarker = L.marker(latlng).addTo(map);
  searchActiveMarker
    .bindPopup(`<b>${displayName.split(",")[0]}</b>`)
    .openPopup();

  // Instant street-level focus zoom
  map.flyTo(latlng, 16, { duration: 1.2 });

  // Extract boundary intersection data once the movement concludes
  setTimeout(() => {
    findLayerAndShowInfo(latlng);
  }, 1200);
}

document.addEventListener("DOMContentLoaded", () => {
  const inputEl = document.getElementById("search-input");
  if (inputEl) {
    inputEl.addEventListener("input", (e) => handleSearch(e.target.value));
    inputEl.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        const firstOption = document.querySelector(
          "#search-results .search-item",
        );
        if (firstOption) firstOption.click();
      }
    });
  }
});

function hidePopup() {
  document.getElementById("info-popup").classList.remove("visible");
  if (searchActiveMarker) {
    map.removeLayer(searchActiveMarker);
    searchActiveMarker = null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// BACK NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════

function showBackButton() {
  document.getElementById("back-btn").classList.add("visible");
}
function hideBackButton() {
  document.getElementById("back-btn").classList.remove("visible");
}

function goBack() {
  if (selectedProvinceLayer) {
    selectedProvinceLayer.setStyle(provinceDefault);
    selectedProvinceLayer = null;
    selectedProvinceName = null;
    selectedProvinceBounds = null;
  }
  if (selectedDistrictLayer) {
    selectedDistrictLayer.setStyle(shahrestanDefault);
    selectedDistrictLayer = null;
  }

  // Deselect any active city district layer
  CITY_DISTRICT_REGISTRY.forEach((cfg) => {
    const state = cityDistrictState[cfg.id];
    if (state && state.selectedLayer) {
      const num = cfg.getDistrict(
        state.selectedLayer.feature?.properties || {},
      );
      const color = districtColor(num || 1);
      state.selectedLayer.setStyle({
        fillColor: color,
        fillOpacity: 0.22,
        weight: 1.5,
        color: "#ffffffcc",
      });
      state.selectedLayer = null;
    }
  });

  map.flyToBounds(iranBounds, { padding: [48, 48], duration: 0.8 });
  hideBackButton();
  hidePopup();
  updateCityLabelVisibility();
  updateProvinceLabelsVisibility();
}

// ═══════════════════════════════════════════════════════════════════════════
// PROVINCE LAYERS
// ═══════════════════════════════════════════════════════════════════════════

function onEachProvince(feature, layer) {
  layer.setStyle(provinceDefault);
  provinceLayers.push({ layer, feature });

  layer.on("mouseover", () => {
    if (layer !== selectedProvinceLayer) layer.setStyle(provinceHover);
  });
  layer.on("mouseout", () => {
    if (layer !== selectedProvinceLayer) layer.setStyle(provinceDefault);
  });

  layer.on("click", (e) => {
    L.DomEvent.stopPropagation(e);
    if (selectedProvinceLayer && selectedProvinceLayer !== layer)
      selectedProvinceLayer.setStyle(provinceDefault);

    layer.setStyle(provinceSelected);
    selectedProvinceLayer = layer;
    selectedProvinceName = feature.properties.NAME_1 || "ناشناس";
    selectedProvinceBounds = layer.getBounds();

    map.flyToBounds(selectedProvinceBounds, {
      padding: [40, 40],
      maxZoom: 9,
      duration: 0.9,
    });

    const displayName =
      persianProvinceNames[selectedProvinceName] || selectedProvinceName;
    showPopup(displayName, getCourtData(selectedProvinceName));
    showBackButton();
    updateCityLabelVisibility();
    updateProvinceLabelsVisibility();
  });
}

const PROVINCE_LABEL_CENTERS = {
  Tehran: [35.75, 51.45],
  Alborz: [35.92, 50.82],
  Qom: [34.65, 50.95],
  Isfahan: [32.8, 52.0],
  Fars: [29.85, 53.0],
  "Razavi Khorasan": [35.3, 59.2],
  "North Khorasan": [37.5, 57.1],
  "South Khorasan": [32.75, 59.0],
  Kerman: [29.9, 56.9],
  "Sistan and Baluchestan": [27.8, 60.5],
  Hormozgan: [27.7, 56.1],
  Bushehr: [28.9, 51.2],
  Khuzestan: [31.4, 48.95],
  Ilam: [33.15, 46.65],
  Lorestan: [33.6, 48.3],
  Kermanshah: [34.45, 46.75],
  Kurdistan: [35.7, 47.0],
  "West Azerbaijan": [37.7, 45.1],
  "East Azerbaijan": [38.15, 46.75],
  Ardabil: [38.45, 48.25],
  Zanjan: [36.5, 48.3],
  Gilan: [37.2, 49.55],
  Mazandaran: [36.25, 52.5],
  Golestan: [37.2, 54.8],
  Semnan: [35.45, 54.3],
  Yazd: [31.85, 54.6],
  Markazi: [34.4, 49.95],
  Hamadan: [34.8, 48.55],
  Qazvin: [36.25, 49.95],
  "Chaharmahal and Bakhtiari": [32.1, 50.75],
  "Kohgiluyeh and Boyer-Ahmad": [30.85, 51.05],
};

function buildProvinceLabels(geojsonData) {
  if (provinceLabelGroup) map.removeLayer(provinceLabelGroup);
  provinceLabelGroup = L.layerGroup();

  geojsonData.features.forEach((feature) => {
    const name1 = feature.properties.NAME_1 || "";
    const label = persianProvinceNames[name1] || name1;
    const center =
      PROVINCE_LABEL_CENTERS[name1] ||
      L.geoJSON(feature).getBounds().getCenter();

    L.marker(center, {
      icon: L.divIcon({
        className: "province-label",
        html: `<span>${label}</span>`,
        iconSize: null,
      }),
      interactive: false,
    }).addTo(provinceLabelGroup);
  });
}

function updateProvinceLabelsVisibility() {
  if (!provinceLabelGroup) return;
  const zoom = map.getZoom();
  if (zoom < SHAHRESTAN_ZOOM && !selectedProvinceName) {
    if (!map.hasLayer(provinceLabelGroup)) provinceLabelGroup.addTo(map);
  } else {
    if (map.hasLayer(provinceLabelGroup)) map.removeLayer(provinceLabelGroup);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// COUNTY (SHAHRESTAN) LAYERS
// ═══════════════════════════════════════════════════════════════════════════

function onEachShahrestan(feature, layer) {
  layer.setStyle(shahrestanDefault);

  layer.on("mouseover", () => {
    if (layer !== selectedDistrictLayer) layer.setStyle(shahrestanHover);
  });
  layer.on("mouseout", () => {
    if (layer !== selectedDistrictLayer) layer.setStyle(shahrestanDefault);
  });

  layer.on("click", (e) => {
    L.DomEvent.stopPropagation(e);
    if (selectedDistrictLayer && selectedDistrictLayer !== layer)
      selectedDistrictLayer.setStyle(shahrestanDefault);

    layer.setStyle(shahrestanSelected);
    selectedDistrictLayer = layer;

    const name2 = feature.properties.NAME_2 || "ناشناس";
    const name1 = feature.properties.NAME_1 || "";

    map.flyToBounds(layer.getBounds(), {
      padding: [50, 50],
      maxZoom: 12,
      duration: 0.8,
    });

    const persianName = persianShahrestanNames[name2] || name2;
    const provinceFa = persianProvinceNames[name1] || name1;
    const courtsToShow = getCourtData(name2);

    showPopup(`${provinceFa} — ${persianName}`, courtsToShow);
    showBackButton();
  });
}

function buildShahrestanLabels(geojsonData) {
  if (shahrestanLabelGroup) map.removeLayer(shahrestanLabelGroup);
  shahrestanLabelGroup = L.layerGroup();

  geojsonData.features.forEach((feature) => {
    const name2 = feature.properties.NAME_2 || "";
    const label = persianShahrestanNames[name2];
    if (!label) return;

    const center = L.geoJSON(feature).getBounds().getCenter();
    L.marker(center, {
      icon: L.divIcon({
        className: "shahrestan-label",
        html: `<span>${label}</span>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      }),
      interactive: false,
    }).addTo(shahrestanLabelGroup);
  });
}

function updateShahrestanVisibility() {
  if (!districtLayerGroup) return;
  const zoom = map.getZoom();
  if (zoom >= SHAHRESTAN_ZOOM) {
    if (!map.hasLayer(districtLayerGroup)) map.addLayer(districtLayerGroup);
    if (shahrestanLabelGroup && !map.hasLayer(shahrestanLabelGroup))
      shahrestanLabelGroup.addTo(map);
  } else {
    if (map.hasLayer(districtLayerGroup)) map.removeLayer(districtLayerGroup);
    if (shahrestanLabelGroup && map.hasLayer(shahrestanLabelGroup))
      map.removeLayer(shahrestanLabelGroup);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CITY LABELS
// ═══════════════════════════════════════════════════════════════════════════

function buildCityLabels() {
  if (cityLabelLayer) return;
  cityLabelLayer = L.layerGroup();
  (typeof majorCities !== "undefined" ? majorCities : []).forEach((city) => {
    L.marker([city.lat, city.lng], {
      icon: L.divIcon({
        className: "city-label",
        html: `<span>${city.name}</span>`,
        iconSize: null,
      }),
      interactive: false,
    }).addTo(cityLabelLayer);
  });
}

function updateCityLabelVisibility() {
  buildCityLabels();
  const zoom = map.getZoom();
  if (zoom >= SHAHRESTAN_ZOOM && zoom < CITY_ZOOM) {
    if (!map.hasLayer(cityLabelLayer)) cityLabelLayer.addTo(map);
  } else {
    if (cityLabelLayer && map.hasLayer(cityLabelLayer))
      map.removeLayer(cityLabelLayer);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// GENERIC CITY DISTRICT SYSTEM
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build Leaflet layer + label group for one city config from the registry.
 * Results are stored in cityDistrictState[cfg.id].
 */
function buildCityDistrictLayer(cfg, geojsonData) {
  const state = {
    layerGroup: L.layerGroup(),
    labelGroup: L.layerGroup(),
    selectedLayer: null,
    loaded: true,
  };
  cityDistrictState[cfg.id] = state;

  geojsonData.features.forEach((feature) => {
    // Apply optional filter
    if (cfg.filter && !cfg.filter(feature)) return;

    const num = cfg.getDistrict(feature.properties);
    if (num === null || num === undefined) return;

    const color = districtColor(num);
    const defaultStyle = {
      color: "#ffffffcc",
      weight: 1.5,
      fillColor: color,
      fillOpacity: 0.22, // lighter so streets/map show through
    };
    const hoverStyle = { fillOpacity: 0.45, weight: 2.2, color: "#fff" };
    const selectedStyle = { fillOpacity: 0.58, weight: 2.5, color: "#fff" };

    const layer = L.geoJSON(feature, { style: defaultStyle });
    layer.feature = feature; // keep reference for goBack()

    layer.on("mouseover", () => {
      if (layer !== state.selectedLayer) layer.setStyle(hoverStyle);
    });
    layer.on("mouseout", () => {
      if (layer !== state.selectedLayer) layer.setStyle(defaultStyle);
    });
    layer.on("click", (e) => {
      L.DomEvent.stopPropagation(e);

      // Deselect previous
      if (state.selectedLayer && state.selectedLayer !== layer) {
        const prevNum = cfg.getDistrict(
          state.selectedLayer.feature?.properties || {},
        );
        const prevColor = districtColor(prevNum || 1);
        state.selectedLayer.setStyle({
          fillColor: prevColor,
          fillOpacity: 0.22,
          weight: 1.5,
          color: "#ffffffcc",
        });
      }

      layer.setStyle(selectedStyle);
      state.selectedLayer = layer;

      map.flyToBounds(layer.getBounds(), {
        padding: [60, 60],
        maxZoom: 14,
        duration: 0.7,
      });

      const courts = cfg.courtsLookup()[cfg.getCourtKey(num)] || [];
      const labelText = cfg.getLabel(feature.properties);
      showPopup(`${labelText} شهرداری ${cfg.persianName}`, courts);
      showBackButton();
    });

    layer.addTo(state.layerGroup);

    // Number / name label
    const center = L.geoJSON(feature).getBounds().getCenter();
    L.marker(center, {
      icon: L.divIcon({
        className: "city-district-label",
        html: cfg.getLabel(feature.properties),
        iconAnchor: [12, 8],
      }),
      interactive: false,
    }).addTo(state.labelGroup);
  });
}

/**
 * Load a city's GeoJSON if not yet loaded, then build its layers.
 */
function ensureCityDistrictLoaded(cfg) {
  if (cityDistrictState[cfg.id]?.loaded) return;
  fetch(cfg.filePath)
    .then((r) => r.json())
    .then((data) => buildCityDistrictLayer(cfg, data))
    .catch(() =>
      console.warn(`فایل مناطق ${cfg.persianName} پیدا نشد: ${cfg.filePath}`),
    );
}

/**
 * Show/hide every city's district layer based on current zoom + map center.
 */
function updateAllCityDistrictVisibility() {
  const zoom = map.getZoom();
  const center = map.getCenter();

  CITY_DISTRICT_REGISTRY.forEach((cfg) => {
    const inView = cfg.viewBounds.contains(center);
    const show = zoom >= CITY_ZOOM && inView;

    if (show) {
      // Lazy-load if needed
      ensureCityDistrictLoaded(cfg);
    }

    const state = cityDistrictState[cfg.id];
    if (!state) return; // not loaded yet

    if (show) {
      if (!map.hasLayer(state.layerGroup)) {
        state.layerGroup.addTo(map);
        state.labelGroup.addTo(map);
      }
    } else {
      if (map.hasLayer(state.layerGroup)) {
        map.removeLayer(state.layerGroup);
        map.removeLayer(state.labelGroup);
      }
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// WORLD OUTLINE OVERLAY
// ═══════════════════════════════════════════════════════════════════════════

function addWorldOverlay(iranGeoJSON) {
  const iranRings = [];
  iranGeoJSON.features.forEach((f) => {
    const geom = f.geometry;
    const coords =
      geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
    coords.forEach((polygon) =>
      polygon.forEach((ring) => iranRings.push(ring)),
    );
  });
  const worldBox = [
    [-180, -90],
    [180, -90],
    [180, 90],
    [-180, 90],
    [-180, -90],
  ];
  L.geoJSON(
    {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [worldBox, ...iranRings] },
    },
    {
      style: {
        color: "transparent",
        weight: 0,
        fillColor: "#dde8f0", // Matches your map background exactly
        fillOpacity: 1.0,
        noClip: true,
      },
      interactive: false,
    },
  ).addTo(map);
}

// ═══════════════════════════════════════════════════════════════════════════
// MAP EVENTS
// ═══════════════════════════════════════════════════════════════════════════

map.on("zoomend moveend", () => {
  updateShahrestanVisibility();
  updateAllCityDistrictVisibility(); // replaces old Tehran-only call
  updateCityLabelVisibility();
  updateProvinceLabelsVisibility();

  const hint = document.getElementById("zoom-hint");
  if (map.getZoom() >= SHAHRESTAN_ZOOM) hint.classList.add("hidden");
  else hint.classList.remove("hidden");
});

map.on("click", () => {
  hidePopup();
});

// ═══════════════════════════════════════════════════════════════════════════
// RUN & LOAD DATASETS
// ═══════════════════════════════════════════════════════════════════════════

// Province layer (IRN level 1)
fetch("data/gadm41_IRN_1.json")
  .then((r) => r.json())
  .then((data) => {
    L.geoJSON(data, { onEachFeature: onEachProvince }).addTo(map);
    addWorldOverlay(data);
    buildProvinceLabels(data);
    updateProvinceLabelsVisibility();
  })
  .catch(() => console.error("خطا در بارگذاری فایل GeoJSON استان‌ها"));

// Shahrestan layer (IRN level 2)
fetch("data/gadm41_IRN_2.json")
  .then((r) => r.json())
  .then((data) => {
    districtLayerGroup = L.geoJSON(data, { onEachFeature: onEachShahrestan });
    buildShahrestanLabels(data);
    updateShahrestanVisibility();
  })
  .catch(() => {
    console.warn("فایل شهرستان‌ها پیدا نشد — ادامه بدون آن.");
  });

// Pre-load ALL registered city district layers
CITY_DISTRICT_REGISTRY.forEach((cfg) => {
  fetch(cfg.filePath)
    .then((r) => r.json())
    .then((data) => {
      buildCityDistrictLayer(cfg, data);
      updateAllCityDistrictVisibility();
    })
    .catch(() => {
      console.warn(`فایل مناطق ${cfg.persianName} پیدا نشد: ${cfg.filePath}`);
    });
});

// Check if coordinates fall inside a given feature polygon
function isPointInPoly(latlng, polyCoordinates) {
  const x = latlng.lng,
    y = latlng.lat;
  let inside = false;
  for (
    let i = 0, j = polyCoordinates.length - 1;
    i < polyCoordinates.length;
    j = i++
  ) {
    const xi = polyCoordinates[i][0],
      yi = polyCoordinates[i][1];
    const xj = polyCoordinates[j][0],
      yj = polyCoordinates[j][1];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInFeature(latlng, feature) {
  const geom = feature.geometry;
  if (!geom) return false;
  if (geom.type === "Polygon") {
    return isPointInPoly(latlng, geom.coordinates[0]);
  } else if (geom.type === "MultiPolygon") {
    for (let i = 0; i < geom.coordinates.length; i++) {
      if (isPointInPoly(latlng, geom.coordinates[i][0])) return true;
    }
  }
  return false;
}

// Scans loaded layers to find boundaries containing the point, then triggers the info panel
function findLayerAndShowInfo(latlng) {
  // 1. Check City Districts
  for (const cfg of CITY_DISTRICT_REGISTRY) {
    const state = cityDistrictState[cfg.id];
    if (state && state.layerGroup) {
      let foundLayer = null;
      state.layerGroup.eachLayer((layer) => {
        if (layer.feature && pointInFeature(latlng, layer.feature))
          foundLayer = layer;
      });
      if (foundLayer) {
        const num = cfg.getDistrict(foundLayer.feature.properties);
        if (num !== null && num !== undefined) {
          showPopup(
            `${cfg.getLabel(foundLayer.feature.properties)} شهرداری ${cfg.persianName}`,
            cfg.courtsLookup()[cfg.getCourtKey(num)] || [],
          );
          showBackButton();
          return;
        }
      }
    }
  }

  // 2. Check Shahrestans
  if (districtLayerGroup) {
    let foundLayer = null;
    districtLayerGroup.eachLayer((layer) => {
      if (layer.feature && pointInFeature(latlng, layer.feature))
        foundLayer = layer;
    });
    if (foundLayer) {
      const props = foundLayer.feature.properties;
      showPopup(
        `${persianProvinceNames[props.NAME_1] || props.NAME_1} — ${persianShahrestanNames[props.NAME_2] || props.NAME_2}`,
        getCourtData(props.NAME_2),
      );
      showBackButton();
      return;
    }
  }

  // 3. Check Provinces
  for (let obj of provinceLayers) {
    if (obj.feature && pointInFeature(latlng, obj.feature)) {
      const name = obj.feature.properties.NAME_1 || "ناشناس";
      showPopup(persianProvinceNames[name] || name, getCourtData(name));
      showBackButton();
      return;
    }
  }
}
