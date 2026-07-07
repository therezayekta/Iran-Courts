// ═══════════════════════════════════════════════════════════════════════════
// MAP INIT
// ═══════════════════════════════════════════════════════════════════════════

function setExplicitHeight() {
  const h = window.innerHeight + "px";
  document.documentElement.style.height = h;
  document.body.style.height = h;
  const mapEl = document.getElementById("map");
  if (mapEl) mapEl.style.height = h;
}
setExplicitHeight();
window.addEventListener("resize", setExplicitHeight);
window.addEventListener("orientationchange", setExplicitHeight);

const map = L.map("map", {
  minZoom: 5,
  maxZoom: 17,
  zoomControl: true,
  attributionControl: true,
  zoomSnap: 0.5,
  tap: true,
  tapTolerance: 15,
  preferCanvas: true, // Switched to canvas renderer for massive performance boost
});

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  updateWhenIdle: true,
  keepBuffer: 3,
}).addTo(map);

const iranBounds = L.latLngBounds([24.5, 44.0], [40.0, 64.0]);

let initialZoom = null;

function applyInitialView() {
  map.invalidateSize();
  map.setMaxBounds(iranBounds.pad(0.2));
  const isMobile = window.innerWidth <= 600;
  map.fitBounds(iranBounds, { padding: isMobile ? [10, 10] : [48, 48] });
  initialZoom = map.getZoom();
  updateBackButtonVisibility();
}
requestAnimationFrame(() => requestAnimationFrame(applyInitialView));

window.addEventListener("load", () =>
  setTimeout(() => map.invalidateSize(), 100),
);

const SHAHRESTAN_ZOOM = 8.5;
const CITY_ZOOM = 10.0;

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS & NEW DATA FETCHING LOGIC
// ═══════════════════════════════════════════════════════════════════════════

function toPersianNum(n) {
  return String(n)
    .split("")
    .map((d) => "۰۱۲۳۴۵۶۷۸۹"[d] ?? d)
    .join("");
}

const courtCache = {};

const PCODE_TO_FILENAME = {
  IR001: "alborz",
  IR002: "ardabil",
  IR003: "bushehr",
  IR004: "chaharmahal-and-bakhtiari",
  IR005: "east-azerbaijan",
  IR006: "fars",
  IR007: "Gilan",
  IR008: "golestan",
  IR009: "hamadan",
  IR010: "hormozgan",
  IR011: "ilam",
  IR012: "isfahan",
  IR013: "kerman",
  IR014: "kermanshah",
  IR015: "khuzestan",
  IR016: "kohgiluyeh-and-buyer-ahmad",
  IR017: "kurdistan",
  IR018: "lorestan",
  IR019: "markazi",
  IR020: "mazandaran",
  IR021: "north-khorasan",
  IR022: "qazvin",
  IR023: "qom",
  IR024: "razavi-khorasan",
  IR025: "semnan",
  IR026: "sistan-and-baluchestan",
  IR027: "south-khorasan",
  IR028: "tehran",
  IR029: "west-azerbaijan",
  IR030: "yazd",
  IR031: "zanjan",
};

function resolveProvinceFileName(adm1Name, adm1Pcode) {
  if (adm1Pcode && PCODE_TO_FILENAME[adm1Pcode]) {
    return PCODE_TO_FILENAME[adm1Pcode];
  }
  if (!adm1Name) return null;
  return adm1Name.toLowerCase().replace(/\s+/g, "-");
}

async function loadProvinceCourtFile(adm1Name, adm1Pcode) {
  const fileName = resolveProvinceFileName(adm1Name, adm1Pcode);
  if (!fileName) return null;

  if (!courtCache[fileName]) {
    try {
      const res = await fetch(`data/courts/${fileName}.json`);
      courtCache[fileName] = res.ok ? await res.json() : null;
    } catch {
      courtCache[fileName] = null;
    }
  }
  return courtCache[fileName];
}

function normalizeLookupKey(str) {
  if (!str) return "";
  return str
    .replace(/^(شهرستان|بخش)\s*/, "")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/‌/g, "")
    .replace(/\s+/g, "")
    .replace(/و/g, "");
}

const AREA_KEY_ALIASES = {
  Theran: "Tehran",
  Quds: "Quds",
  Qarchak: "Qarchak",
  Pishva: "Pishva",
  Malard: "Malard",
  Baharestan: "Baharestan",
  Pardis: "Pardis",
  Shahriyar: "Shahriyar",
};

function resolveAreaKey(provinceData, targetKey) {
  if (!provinceData?.areas || !targetKey) return null;
  const areas = provinceData.areas;
  const direct = AREA_KEY_ALIASES[targetKey] || targetKey;
  if (areas[direct]) return direct;

  const targetFa =
    persianShahrestanNames[targetKey] ||
    persianProvinceNames[targetKey] ||
    targetKey;
  const cleanTarget = normalizeLookupKey(targetFa);

  for (const key of Object.keys(areas)) {
    const area = areas[key];
    const candidates = [key, area.nameFa, persianShahrestanNames[key]].filter(
      Boolean,
    );
    for (const candidate of candidates) {
      if (normalizeLookupKey(candidate) === cleanTarget) return key;
    }
  }
  return null;
}

function collectAreaCourts(area) {
  if (!area) return [];
  const courts = [...(area.courts || [])];
  for (const list of Object.values(area.districts || {})) {
    courts.push(...list);
  }
  return courts;
}

function collectProvinceCourts(provinceData) {
  if (!provinceData) return [];
  const courts = [...(provinceData.courts || [])];
  for (const area of Object.values(provinceData.areas || {})) {
    courts.push(...collectAreaCourts(area));
  }
  return courts;
}

async function getProvinceCourtsAsync(adm1Name, adm1Pcode) {
  const provinceData = await loadProvinceCourtFile(adm1Name, adm1Pcode);
  return collectProvinceCourts(provinceData);
}

async function getAreaCourtsAsync(adm1Name, areaKey, adm1Pcode) {
  const provinceData = await loadProvinceCourtFile(adm1Name, adm1Pcode);
  const key = resolveAreaKey(provinceData, areaKey);
  if (!key) return [];
  return collectAreaCourts(provinceData.areas[key]);
}

async function getDistrictCourtsAsync(
  adm1Name,
  areaKey,
  districtKey,
  adm1Pcode,
) {
  const provinceData = await loadProvinceCourtFile(adm1Name, adm1Pcode);
  const key = resolveAreaKey(provinceData, areaKey);
  if (!key) return [];
  return provinceData.areas[key]?.districts?.[districtKey] || [];
}

async function getCityDistrictMapAsync(adm1Name, cityKey, adm1Pcode) {
  const provinceData = await loadProvinceCourtFile(adm1Name, adm1Pcode);
  const key = resolveAreaKey(provinceData, cityKey);
  if (!key) return {};
  return provinceData.areas[key]?.districts || {};
}

function fastFeatureCenter(feature) {
  const geom = feature.geometry;
  if (!geom) return [0, 0];
  let minLng = Infinity,
    maxLng = -Infinity,
    minLat = Infinity,
    maxLat = -Infinity;
  const scanRing = (ring) => {
    for (let i = 0; i < ring.length; i++) {
      const lng = ring[i][0],
        lat = ring[i][1];
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  };
  if (geom.type === "Polygon") {
    scanRing(geom.coordinates[0]);
  } else if (geom.type === "MultiPolygon") {
    let best = null,
      bestSpan = -1;
    geom.coordinates.forEach((poly) => {
      const ring = poly[0];
      let lo = Infinity,
        hi = -Infinity;
      for (let i = 0; i < ring.length; i++) {
        if (ring[i][0] < lo) lo = ring[i][0];
        if (ring[i][0] > hi) hi = ring[i][0];
      }
      const span = hi - lo;
      if (span > bestSpan) {
        bestSpan = span;
        best = ring;
      }
    });
    if (best) scanRing(best);
  } else return [0, 0];
  return [(minLat + maxLat) / 2, (minLng + maxLng) / 2];
}

// ═══════════════════════════════════════════════════════════════════════════
// CITY DISTRICT REGISTRY
// ═══════════════════════════════════════════════════════════════════════════

const CITY_DISTRICT_REGISTRY = [
  {
    id: "tehran",
    cityKey: "Tehran",
    filePath: "data/tehran-districts.json",
    persianName: "تهران",
    provinceName: "Tehran",
    viewBounds: L.latLngBounds([35.534, 51.05], [35.87, 51.66]),
    districtCount: 22,
    getDistrict: (props) => props.district,
    getLabel: (props) => toPersianNum(props.district),
    getCourtKey: (num) => `منطقه ${toPersianNum(num)}`,
    filter: null,
  },
];

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
// MAP STYLES & STATE
// ═══════════════════════════════════════════════════════════════════════════

const provinceDefault = {
  color: "#475569",
  weight: 1.8,
  fillColor: "#64748b",
  fillOpacity: 0.04,
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
  fillOpacity: 0.02,
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

let provinceLayers = [],
  searchActiveMarker = null,
  selectedProvinceLayer = null,
  selectedProvinceName = null,
  selectedProvinceBounds = null;
let districtLayerGroup = null,
  selectedDistrictLayer = null,
  cityLabelLayer = null,
  provinceLabelGroup = null,
  shahrestanLabelGroup = null;
const cityDistrictState = {};

// ═══════════════════════════════════════════════════════════════════════════
// POPUP SYSTEM
// ═══════════════════════════════════════════════════════════════════════════

const COURT_TYPE_CLASSES = {
  حقوقی: "type-hoquqi",
  دادگاه: "type-dadgah",
  صلح: "type-solh",
  دادسرا: "type-dadsara",
  خانواده: "type-khanvade",
  "کیفری دو": "type-keyfari",
  کیفری: "type-keyfari",
};

function courtTypeClass(type) {
  if (!type) return "type-default";
  if (COURT_TYPE_CLASSES[type]) return COURT_TYPE_CLASSES[type];
  for (const [label, cls] of Object.entries(COURT_TYPE_CLASSES)) {
    if (type.includes(label)) return cls;
  }
  return "type-default";
}

function formatCourtCode(code) {
  if (code === null || code === undefined || code === "") return "—";
  return toPersianNum(String(code));
}

function renderCourtList(courts) {
  const body = document.getElementById("popup-body");
  if (!courts || courts.length === 0) {
    body.innerHTML =
      '<p class="popup-empty">اطلاعاتی برای این منطقه ثبت نشده است.</p>';
    return;
  }

  body.innerHTML = `
    <div class="court-summary">
      <span class="court-count-badge">${toPersianNum(courts.length)} مرکز قضایی</span>
    </div>
    <div class="court-list">
      ${courts
        .map(
          (c) => `
        <article class="court-row">
          <h3 class="court-row-name">${c.name}</h3>
          <div class="court-row-meta">
            <span class="court-meta-item">
              <span class="court-meta-label">کد</span>
              <span class="court-code">${formatCourtCode(c.code)}</span>
            </span>
            <span class="court-type-badge ${courtTypeClass(c.type)}">${c.type || "—"}</span>
          </div>
        </article>`,
        )
        .join("")}
    </div>`;
}

function showPopup(title, courts) {
  const popup = document.getElementById("info-popup");
  document.getElementById("popup-title").textContent = title;
  renderCourtList(courts);
  popup.classList.add("visible");
}

function hidePopup() {
  document.getElementById("info-popup").classList.remove("visible");
  if (searchActiveMarker) {
    map.removeLayer(searchActiveMarker);
    searchActiveMarker = null;
  }
}

function showBackButton() {
  document.getElementById("back-btn").classList.add("visible");
}
function hideBackButton() {
  document.getElementById("back-btn").classList.remove("visible");
}

function anyCityDistrictSelected() {
  return CITY_DISTRICT_REGISTRY.some(
    (cfg) => cityDistrictState[cfg.id]?.selectedLayer,
  );
}

function updateBackButtonVisibility() {
  const hasSelection =
    !!selectedProvinceLayer ||
    !!selectedDistrictLayer ||
    anyCityDistrictSelected();
  const zoomedIn = initialZoom !== null && map.getZoom() > initialZoom + 0.01;
  if (hasSelection || zoomedIn) showBackButton();
  else hideBackButton();
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
  CITY_DISTRICT_REGISTRY.forEach((cfg) => {
    const state = cityDistrictState[cfg.id];
    if (state && state.selectedLayer) {
      const num = cfg.getDistrict(
        state.selectedLayer.feature?.properties || {},
      );
      state.selectedLayer.setStyle({
        fillColor: districtColor(num || 1),
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
// SEARCH LOGIC (Nominatim primary + Photon fallback, both free OSM)
// ═══════════════════════════════════════════════════════════════════════════

let searchTimeout = null;
let searchAbortController = null;

const IRAN_BBOX = { minLat: 24.5, maxLat: 40.0, minLon: 44.0, maxLon: 64.0 };

function inIran(lat, lon) {
  return (
    lat >= IRAN_BBOX.minLat &&
    lat <= IRAN_BBOX.maxLat &&
    lon >= IRAN_BBOX.minLon &&
    lon <= IRAN_BBOX.maxLon
  );
}

function detectCityBias(query) {
  const trimmed = query.trim();
  const cities = typeof majorCities !== "undefined" ? majorCities : [];
  for (const city of cities) {
    if (trimmed.startsWith(city.name)) {
      return { lat: city.lat, lon: city.lng };
    }
  }
  return null;
}

function fetchNominatim(query, mapBounds, signal) {
  const b = mapBounds || { west: 44, south: 24.5, east: 64, north: 40 };
  const viewbox = `${b.west},${b.south},${b.east},${b.north}`;
  const zoomed = map.getZoom() >= 8;
  const url =
    `https://nominatim.openstreetmap.org/search` +
    `?q=${encodeURIComponent(query)}` +
    `&format=jsonv2` +
    `&countrycodes=ir` +
    `&viewbox=${viewbox}` +
    (zoomed ? `&bounded=1` : ``) +
    `&limit=6` +
    `&accept-language=fa,en` +
    `&addressdetails=1`;

  return fetch(url, {
    headers: {
      "User-Agent": "IranCourtsMap/1.0 (irancourts.therezayekta.workers.dev)",
    },
    signal,
  })
    .then((res) => (res.ok ? res.json() : []))
    .then((items) =>
      (items || [])
        .filter(
          (i) => i.lat && i.lon && inIran(parseFloat(i.lat), parseFloat(i.lon)),
        )
        .map((i) => {
          const addr = i.address || {};
          const parts = (i.display_name || "").split(",").map((s) => s.trim());
          const title = parts[0] || i.name || "";
          const sub = [
            addr.neighbourhood || addr.suburb || addr.quarter,
            addr.city || addr.town || addr.village || addr.county,
            addr.state,
          ]
            .filter(Boolean)
            .join("، ");
          return {
            lat: parseFloat(i.lat),
            lng: parseFloat(i.lon),
            title,
            subtitle: sub || "ایران",
            source: "nominatim",
          };
        }),
    )
    .catch((e) => {
      if (e.name === "AbortError") throw e;
      return [];
    });
}

function fetchPhoton(query, bias, signal) {
  const { lat, lon } = bias;
  const url =
    `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}` +
    `&lat=${lat}&lon=${lon}&limit=5`;

  return fetch(url, { signal })
    .then((res) => (res.ok ? res.json() : { features: [] }))
    .then((data) =>
      (data.features || [])
        .filter((f) => f?.geometry?.coordinates)
        .filter((f) =>
          inIran(f.geometry.coordinates[1], f.geometry.coordinates[0]),
        )
        .map((f) => {
          const p = f.properties;
          const name = p.name || p.street || "";
          const city = p.city || p.county || "";
          const state = p.state || "";
          return {
            lat: f.geometry.coordinates[1],
            lng: f.geometry.coordinates[0],
            title: name,
            subtitle: [city, state].filter(Boolean).join("، ") || "ایران",
            source: "photon",
          };
        }),
    )
    .catch((e) => {
      if (e.name === "AbortError") throw e;
      return [];
    });
}

let _cachedCityContext = null;

async function resolveMapCenterCity() {
  const zoom = map.getZoom();
  if (zoom < 9) return null;

  const center = map.getCenter();
  const c = _cachedCityContext;
  if (
    c &&
    c.zoom === Math.round(zoom) &&
    Math.abs(c.lat - center.lat) < 0.05 &&
    Math.abs(c.lng - center.lng) < 0.05
  ) {
    return c.cityName;
  }

  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse` +
      `?lat=${center.lat}&lon=${center.lng}` +
      `&format=jsonv2&accept-language=fa,en`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "IranCourtsMap/1.0 (irancourts.therezayekta.workers.dev)",
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const addr = data.address || {};
    const cityName =
      addr.city || addr.town || addr.village || addr.county || null;
    _cachedCityContext = {
      lat: center.lat,
      lng: center.lng,
      zoom: Math.round(zoom),
      cityName,
    };
    return cityName;
  } catch {
    return null;
  }
}

map.on("moveend", () => {
  _cachedCityContext = null;
});

async function fetchCombined(query, signal) {
  const mapCenter = map.getCenter();
  const mapBounds = map.getBounds();
  const bounds = {
    west: mapBounds.getWest(),
    south: mapBounds.getSouth(),
    east: mapBounds.getEast(),
    north: mapBounds.getNorth(),
  };

  const cityBias = detectCityBias(query);
  const photonBias = cityBias || { lat: mapCenter.lat, lon: mapCenter.lng };

  let enrichedQuery = query;
  if (!cityBias && map.getZoom() >= 9) {
    const detectedCity = await resolveMapCenterCity();
    if (detectedCity && !query.includes(detectedCity)) {
      enrichedQuery = `${detectedCity} ${query}`;
    }
  }

  return Promise.allSettled([
    fetchNominatim(enrichedQuery, bounds, signal),
    fetchPhoton(enrichedQuery, photonBias, signal),
  ]).then(([nominatimResult, photonResult]) => {
    const nominatim =
      nominatimResult.status === "fulfilled" ? nominatimResult.value : [];
    const photon =
      photonResult.status === "fulfilled" ? photonResult.value : [];

    const combined = [...nominatim];
    for (const p of photon) {
      const tooClose = combined.some(
        (m) => Math.abs(m.lat - p.lat) < 0.01 && Math.abs(m.lng - p.lng) < 0.01,
      );
      if (!tooClose) combined.push(p);
    }
    return combined.slice(0, 8);
  });
}

function handleSearch(query) {
  const resultsContainer = document.getElementById("search-results");
  if (!query || query.trim() === "") {
    resultsContainer.classList.add("hidden");
    return;
  }

  if (searchTimeout) clearTimeout(searchTimeout);
  if (searchAbortController) searchAbortController.abort();

  searchAbortController = new AbortController();
  const signal = searchAbortController.signal;

  searchTimeout = setTimeout(() => {
    resultsContainer.innerHTML = `<div class="search-item" style="cursor:default; justify-content:center; color:#64748b;">در حال جستجو...</div>`;
    resultsContainer.classList.remove("hidden");

    fetchCombined(query, signal)
      .then((results) => {
        if (!results || results.length === 0) {
          resultsContainer.innerHTML = `<div class="search-item" style="cursor:default; justify-content:center; color:#64748b;">موردی یافت نشد</div>`;
          return;
        }

        resultsContainer.innerHTML = results
          .map(
            (item) => `
          <div class="search-item" onclick="selectAddressResult(${item.lat}, ${item.lng}, '${item.title.replace(/'/g, "\\'")}')">
            <div style="display:flex; flex-direction:column; gap:2px; min-width:0; text-align:right;">
              <span class="search-item-title" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${item.title}</span>
              <span style="font-size:10px; color:#64748b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${item.subtitle}</span>
            </div>
          </div>`,
          )
          .join("");
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        resultsContainer.innerHTML = `<div class="search-item" style="cursor:default; justify-content:center; color:#64748b;">خطا در جستجو، دوباره تلاش کنید</div>`;
      });
  }, 400);
}

function selectAddressResult(lat, lon, displayName) {
  document.getElementById("search-input").value = displayName;
  document.getElementById("search-results").classList.add("hidden");
  const latlng = L.latLng(lat, lon);
  if (searchActiveMarker) map.removeLayer(searchActiveMarker);
  searchActiveMarker = L.marker(latlng).addTo(map);
  searchActiveMarker.bindPopup(`<b>${displayName}</b>`).openPopup();
  map.flyTo(latlng, 16, { duration: 1.2 });
  map.once("moveend", () =>
    resolveCityDistrictLoadsNear(latlng).then(() =>
      findLayerAndShowInfo(latlng),
    ),
  );
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

// ═══════════════════════════════════════════════════════════════════════════
// MAP LAYERS
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

  layer.on("click", async (e) => {
    L.DomEvent.stopPropagation(e);
    if (selectedProvinceLayer && selectedProvinceLayer !== layer)
      selectedProvinceLayer.setStyle(provinceDefault);
    layer.setStyle(provinceSelected);
    selectedProvinceLayer = layer;
    selectedProvinceName = feature.properties.adm1_name || "ناشناس";
    selectedProvinceBounds = layer.getBounds();
    const popupEl = document.getElementById("info-popup");
    const popupRect = popupEl.getBoundingClientRect();
    const mapRect = map.getContainer().getBoundingClientRect();

    const isPopupVisible = popupEl.classList.contains("visible");
    const overlapLeft =
      isPopupVisible && popupRect.left <= mapRect.left
        ? popupRect.right - mapRect.left
        : 0;
    const overlapRight =
      isPopupVisible && popupRect.right >= mapRect.right
        ? mapRect.right - popupRect.left
        : 0;
    const overlapBottom =
      isPopupVisible && popupRect.bottom >= mapRect.bottom
        ? mapRect.bottom - popupRect.top
        : 0;

    const paddingTopLeft = [40 + Math.max(0, overlapLeft), 40];
    const paddingBottomRight = [
      40 + Math.max(0, overlapRight),
      40 + Math.max(0, overlapBottom),
    ];

    const fitZoom = map.getBoundsZoom(
      selectedProvinceBounds,
      false,
      paddingTopLeft,
      paddingBottomRight,
    );
    const targetZoom = Math.min(
      CITY_ZOOM - 0.1,
      Math.max(SHAHRESTAN_ZOOM, fitZoom),
    );

    const targetPoint = map
      .project(selectedProvinceBounds.getCenter(), targetZoom)
      .subtract([
        (paddingBottomRight[0] - paddingTopLeft[0]) / 2,
        (paddingBottomRight[1] - paddingTopLeft[1]) / 2,
      ]);
    const targetCenter = map.unproject(targetPoint, targetZoom);

    map.flyTo(targetCenter, targetZoom, { duration: 0.9 });
    map.once("moveend", () => {
      updateCityLabelVisibility();
      updateProvinceLabelsVisibility();
      updateShahrestanVisibility();
    });

    const displayName =
      feature.properties.adm1_name1 ||
      persianProvinceNames[selectedProvinceName] ||
      selectedProvinceName;
    const courtsToShow = await getProvinceCourtsAsync(
      selectedProvinceName,
      feature.properties.adm1_pcode,
    );
    showPopup(displayName, courtsToShow);
    showBackButton();
  });
}

function buildProvinceLabels(geojsonData) {
  if (provinceLabelGroup) map.removeLayer(provinceLabelGroup);
  provinceLabelGroup = L.layerGroup();
  const PROVINCE_LABEL_CENTERS = {
    Tehran: [35.75, 51.45],
    Alborz: [35.92, 50.82],
    Qom: [34.65, 50.95],
    Isfahan: [32.8, 52.0],
    Fars: [29.85, 53.0],
    "Razavi Khorasan": [35.3, 59.2],
  };
  geojsonData.features.forEach((f) => {
    const name1 = f.properties.adm1_name || "";
    const center = PROVINCE_LABEL_CENTERS[name1] || fastFeatureCenter(f);
    L.marker(center, {
      icon: L.divIcon({
        className: "province-label",
        html: `<span>${f.properties.adm1_name1 || persianProvinceNames[name1] || name1}</span>`,
      }),
      interactive: false,
    }).addTo(provinceLabelGroup);
  });
}

function updateProvinceLabelsVisibility() {
  if (!provinceLabelGroup) return;
  const zoom = map.getZoom();
  if (zoom < SHAHRESTAN_ZOOM) {
    if (!map.hasLayer(provinceLabelGroup)) provinceLabelGroup.addTo(map);
  } else {
    if (map.hasLayer(provinceLabelGroup)) map.removeLayer(provinceLabelGroup);
  }
}

function onEachShahrestan(feature, layer) {
  layer.setStyle(shahrestanDefault);
  layer.on("mouseover", () => {
    if (layer !== selectedDistrictLayer) layer.setStyle(shahrestanHover);
  });
  layer.on("mouseout", () => {
    if (layer !== selectedDistrictLayer) layer.setStyle(shahrestanDefault);
  });

  layer.on("click", async (e) => {
    L.DomEvent.stopPropagation(e);
    if (selectedDistrictLayer && selectedDistrictLayer !== layer)
      selectedDistrictLayer.setStyle(shahrestanDefault);
    layer.setStyle(shahrestanSelected);
    selectedDistrictLayer = layer;
    const name2 = feature.properties.adm2_name || "ناشناس";
    const name1 = feature.properties.adm1_name || "";
    const pcode = feature.properties.adm1_pcode || "";
    const bounds = layer.getBounds();
    const fitZoom = map.getBoundsZoom(bounds, false, [50, 50], [50, 50]);
    const targetZoom = Math.min(
      CITY_ZOOM - 0.1,
      Math.max(SHAHRESTAN_ZOOM, fitZoom),
    );
    map.flyTo(bounds.getCenter(), targetZoom, { duration: 0.8 });

    const persianName = stripShahrestanPrefix(
      feature.properties.adm2_name1 || persianShahrestanNames[name2] || name2,
    );
    const provinceFa =
      feature.properties.adm1_name1 || persianProvinceNames[name1] || name1;
    const courtsToShow = await getAreaCourtsAsync(name1, name2, pcode);
    showPopup(`${provinceFa} — ${persianName}`, courtsToShow);
    showBackButton();
  });
}

function stripShahrestanPrefix(str) {
  if (!str) return str;
  return str.replace(/^شهرستان\s+/, "");
}

function buildShahrestanLabels(geojsonData) {
  if (shahrestanLabelGroup) map.removeLayer(shahrestanLabelGroup);
  shahrestanLabelGroup = L.layerGroup();
  geojsonData.features.forEach((f) => {
    const raw =
      f.properties.adm2_name1 ||
      persianShahrestanNames[f.properties.adm2_name || ""];
    const label = stripShahrestanPrefix(raw);
    if (!label) return;
    L.marker(fastFeatureCenter(f), {
      icon: L.divIcon({
        className: "shahrestan-label",
        html: `<span>${label}</span>`,
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

function buildCityLabels() {
  if (cityLabelLayer) return;
  cityLabelLayer = L.layerGroup();
  (typeof majorCities !== "undefined" ? majorCities : []).forEach((city) => {
    L.marker([city.lat, city.lng], {
      icon: L.divIcon({
        className: "city-label",
        html: `<span>${city.name}</span>`,
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

function buildCityDistrictLayer(cfg, geojsonData) {
  const state = {
    layerGroup: L.layerGroup(),
    labelGroup: L.layerGroup(),
    selectedLayer: null,
    loaded: true,
  };
  cityDistrictState[cfg.id] = state;

  geojsonData.features.forEach((feature) => {
    if (cfg.filter && !cfg.filter(feature)) return;
    const num = cfg.getDistrict(feature.properties);
    if (num === null || num === undefined) return;

    const defaultStyle = {
      color: "#ffffffcc",
      weight: 1.5,
      fillColor: districtColor(num),
      fillOpacity: 0.22,
    };
    const hoverStyle = { fillOpacity: 0.45, weight: 2.2, color: "#fff" };
    const selectedStyle = { fillOpacity: 0.58, weight: 2.5, color: "#fff" };

    const layer = L.geoJSON(feature, { style: defaultStyle });
    layer.feature = feature;

    layer.on("mouseover", () => {
      if (layer !== state.selectedLayer) layer.setStyle(hoverStyle);
    });
    layer.on("mouseout", () => {
      if (layer !== state.selectedLayer) layer.setStyle(defaultStyle);
    });

    layer.on("click", async (e) => {
      L.DomEvent.stopPropagation(e);
      if (state.selectedLayer && state.selectedLayer !== layer) {
        state.selectedLayer.setStyle({
          fillColor: districtColor(
            cfg.getDistrict(state.selectedLayer.feature?.properties || {}) || 1,
          ),
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

      const districtData = await getCityDistrictMapAsync(
        cfg.provinceName,
        cfg.cityKey,
      );
      const courts = districtData[cfg.getCourtKey(num)] || [];
      showPopup(
        `${cfg.getLabel(feature.properties)} شهرداری ${cfg.persianName}`,
        courts,
      );
      showBackButton();
    });

    layer.addTo(state.layerGroup);
    L.marker(L.geoJSON(feature).getBounds().getCenter(), {
      icon: L.divIcon({
        className: "city-district-label",
        html: cfg.getLabel(feature.properties),
        iconAnchor: [12, 8],
      }),
      interactive: false,
    }).addTo(state.labelGroup);
  });
}

function ensureCityDistrictLoaded(cfg) {
  if (cityDistrictState[cfg.id]?.loaded) return;
  fetch(cfg.filePath)
    .then((r) => r.json())
    .then((data) => buildCityDistrictLayer(cfg, data))
    .catch(() => console.warn(`Error: ${cfg.filePath}`));
}

function updateAllCityDistrictVisibility() {
  const zoom = map.getZoom();
  const center = map.getCenter();
  CITY_DISTRICT_REGISTRY.forEach((cfg) => {
    const show = zoom >= CITY_ZOOM && cfg.viewBounds.contains(center);
    if (show) ensureCityDistrictLoaded(cfg);
    const state = cityDistrictState[cfg.id];
    if (!state) return;
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

map.on("zoomend moveend", () => {
  updateShahrestanVisibility();
  updateAllCityDistrictVisibility();
  updateCityLabelVisibility();
  updateProvinceLabelsVisibility();
  updateBackButtonVisibility();
  const hint = document.getElementById("zoom-hint");
  if (map.getZoom() >= SHAHRESTAN_ZOOM) hint.classList.add("hidden");
  else hint.classList.remove("hidden");
});
map.on("click", () => hidePopup());

// ═══════════════════════════════════════════════════════════════════════════
// RUN & LOAD DATASETS
// ═══════════════════════════════════════════════════════════════════════════

const loadAdmin1 = fetch(
  `data/boundaries/irn_admin1_simplified.geojson?v=${Date.now()}`,
)
  .then((r) => r.json())
  .then((data) => {
    L.geoJSON(data, { onEachFeature: onEachProvince }).addTo(map);
    buildProvinceLabels(data);
    updateProvinceLabelsVisibility();
  })
  .catch((err) => console.error("Error loading provinces", err));

const loadAdmin2 = fetch(
  `data/boundaries/irn_admin2_simplified.geojson?v=${Date.now()}`,
)
  .then((r) => r.json())
  .then((data) => {
    districtLayerGroup = L.geoJSON(data, { onEachFeature: onEachShahrestan });
    buildShahrestanLabels(data);
    updateShahrestanVisibility();
  });

Promise.all([loadAdmin1, loadAdmin2])
  .then(() => {
    setTimeout(() => {
      document.body.classList.add("loaded");
    }, 500);
  })
  .catch((err) => {
    console.error("Critical error loading map data", err);
    document.body.classList.add("loaded");
  });

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
      yi = polyCoordinates[i][1],
      xj = polyCoordinates[j][0],
      yj = polyCoordinates[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

function pointInFeature(latlng, feature) {
  const geom = feature.geometry;
  if (!geom) return false;
  if (geom.type === "Polygon")
    return isPointInPoly(latlng, geom.coordinates[0]);
  if (geom.type === "MultiPolygon") {
    for (let i = 0; i < geom.coordinates.length; i++)
      if (isPointInPoly(latlng, geom.coordinates[i][0])) return true;
  }
  return false;
}

async function findLayerAndShowInfo(latlng) {
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
          const districtData = await getCityDistrictMapAsync(
            cfg.provinceName,
            cfg.cityKey,
          );
          showPopup(
            `${cfg.getLabel(foundLayer.feature.properties)} شهرداری ${cfg.persianName}`,
            districtData[cfg.getCourtKey(num)] || [],
          );
          showBackButton();
          return;
        }
      }
    }
  }

  if (districtLayerGroup) {
    let foundLayer = null;
    districtLayerGroup.eachLayer((layer) => {
      if (layer.feature && pointInFeature(latlng, layer.feature))
        foundLayer = layer;
    });
    if (foundLayer) {
      const props = foundLayer.feature.properties;
      const name1 = props.adm1_name || "";
      const name2 = props.adm2_name || "";
      const pcode = props.adm1_pcode || "";
      const courtsToShow = await getAreaCourtsAsync(name1, name2, pcode);
      const persianName = stripShahrestanPrefix(
        props.adm2_name1 || persianShahrestanNames[name2] || name2,
      );
      const provinceFa =
        props.adm1_name1 || persianProvinceNames[name1] || name1;
      showPopup(`${provinceFa} — ${persianName}`, courtsToShow);
      showBackButton();
      return;
    }
  }

  for (let obj of provinceLayers) {
    if (obj.feature && pointInFeature(latlng, obj.feature)) {
      const props = obj.feature.properties;
      const name = props.adm1_name || "ناشناس";
      const pcode = props.adm1_pcode || "";
      const courtsToShow = await getProvinceCourtsAsync(name, pcode);
      const displayName =
        props.adm1_name1 || persianProvinceNames[name] || name;
      showPopup(displayName, courtsToShow);
      showBackButton();
      return;
    }
  }
}
