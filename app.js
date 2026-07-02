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

const SHAHRESTAN_ZOOM = 7.0;
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

// Province court file: data/courts/{slug}.json
// {
//   province: "Tehran",          // GADM NAME_1
//   provinceFa: "تهران",
//   courts: [{ name, code, type }],   // province-wide
//   areas: {
//     "Tehran": {                // GADM NAME_2 or custom key
//       nameFa: "تهران",
//       courts: [],
//       districts: { "منطقه ۱": [...] }
//     }
//   }
// }
async function loadProvinceCourtFile(provinceNameGADM) {
  if (!provinceNameGADM) return null;
  const fileName = provinceNameGADM.toLowerCase().replace(/\s+/g, "-");

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
  return str.replace(/\s+/g, "").replace(/و/g, "");
}

const AREA_KEY_ALIASES = {
  Theran: "Tehran",
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

async function getProvinceCourtsAsync(provinceNameGADM) {
  const provinceData = await loadProvinceCourtFile(provinceNameGADM);
  return collectProvinceCourts(provinceData);
}

async function getAreaCourtsAsync(provinceNameGADM, areaKey) {
  const provinceData = await loadProvinceCourtFile(provinceNameGADM);
  const key = resolveAreaKey(provinceData, areaKey);
  if (!key) return [];
  return collectAreaCourts(provinceData.areas[key]);
}

async function getDistrictCourtsAsync(provinceNameGADM, areaKey, districtKey) {
  const provinceData = await loadProvinceCourtFile(provinceNameGADM);
  const key = resolveAreaKey(provinceData, areaKey);
  if (!key) return [];
  return provinceData.areas[key]?.districts?.[districtKey] || [];
}

async function getCityDistrictMapAsync(provinceNameGADM, cityKey) {
  const provinceData = await loadProvinceCourtFile(provinceNameGADM);
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
  {
    id: "isfahan",
    cityKey: "Isfahan",
    filePath: "data/isfahan.geojson",
    persianName: "اصفهان",
    provinceName: "Isfahan",
    viewBounds: L.latLngBounds([32.52, 51.48], [32.82, 51.82]),
    districtCount: 15,
    getDistrict: (props) => {
      const en = props["name:en"] || "";
      const m = en.match(/District\s+(\d+)/i);
      return m ? parseInt(m[1], 10) : null;
    },
    getLabel: (props) => props["name"] || props["name:fa"] || "",
    getCourtKey: (num) => String(num),
    filter: (feature) => feature.properties.admin_level === "9",
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

// Keeps the back button visible any time the user has zoomed/panned away from
// the initial full-Iran view, in addition to whenever something is selected.
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
// SEARCH LOGIC
// ═══════════════════════════════════════════════════════════════════════════

let searchTimeout = null;

function buildAddressSubtitle(item) {
  const addr = item.address || {};
  const city =
    addr.city ||
    addr.town ||
    addr.village ||
    addr.county ||
    addr.state_district;
  const province = addr.state || addr.province;
  if (city && province && city !== province) return `${city}، ${province}`;
  if (province) return province;
  if (city) return city;
  return (item.display_name || "").split(",").slice(1, 3).join(",") || "ایران";
}

function fetchNominatim(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=ir&limit=15&accept-language=fa&addressdetails=1&dedupe=0`;
  return fetch(url, { headers: { "User-Agent": "IranCourtsMap/1.0" } }).then(
    (res) => res.json(),
  );
}

function searchWithFallback(query) {
  const words = query.trim().split(/\s+/);
  function attempt(wordCount) {
    if (wordCount < 1)
      return Promise.resolve({ results: [], isPartial: false });
    const trimmedQuery = words.slice(0, wordCount).join(" ");
    return fetchNominatim(trimmedQuery).then((data) => {
      if (data && data.length > 0)
        return {
          results: data,
          isPartial: wordCount < words.length,
          matchedQuery: trimmedQuery,
        };
      return attempt(wordCount - 1);
    });
  }
  return attempt(words.length);
}

function handleSearch(query) {
  const resultsContainer = document.getElementById("search-results");
  if (!query || query.trim() === "") {
    resultsContainer.classList.add("hidden");
    return;
  }
  if (searchTimeout) clearTimeout(searchTimeout);

  searchTimeout = setTimeout(() => {
    resultsContainer.innerHTML = `<div class="search-item" style="cursor:default; justify-content:center; color:#64748b;">در حال جستجو...</div>`;
    resultsContainer.classList.remove("hidden");

    searchWithFallback(query)
      .then(({ results: data, isPartial, matchedQuery }) => {
        if (!data || data.length === 0) {
          resultsContainer.innerHTML = `<div class="search-item" style="cursor:default; justify-content:center; color:#64748b;">موردی یافت نشد</div>`;
          return;
        }
        const seenPerProvince = {};
        const picked = [];
        for (const item of data) {
          const province =
            (item.address && (item.address.state || item.address.province)) ||
            "?";
          const count = seenPerProvince[province] || 0;
          if (count >= 2) continue;
          seenPerProvince[province] = count + 1;
          picked.push(item);
          if (picked.length >= 8) break;
        }
        const partialNotice = isPartial
          ? `<div class="search-item" style="cursor:default; justify-content:center; color:#b45309; font-size:11px;">آدرس دقیق یافت نشد — نزدیک‌ترین نتیجه برای «${matchedQuery}»</div>`
          : "";
        resultsContainer.innerHTML =
          partialNotice +
          picked
            .map(
              (item) => `
        <div class="search-item" onclick="selectAddressResult(${item.lat}, ${item.lon}, '${item.display_name.replace(/'/g, "\\'")}')">
          <div style="display:flex; flex-direction:column; gap:2px; min-width:0; text-align:right;">
            <span class="search-item-title" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${item.display_name.split(",")[0]}</span>
            <span style="font-size:10px; color:#64748b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${buildAddressSubtitle(item)}</span>
          </div><span class="search-item-badge">مکان</span>
        </div>`,
            )
            .join("");
      })
      .catch(() => {
        resultsContainer.innerHTML = `<div class="search-item" style="cursor:default; justify-content:center; color:#64748b;">خطا در جستجو، دوباره تلاش کنید</div>`;
      });
  }, 400);
}

function selectAddressResult(lat, lon, displayName) {
  document.getElementById("search-input").value = displayName.split(",")[0];
  document.getElementById("search-results").classList.add("hidden");
  const latlng = L.latLng(lat, lon);
  if (searchActiveMarker) map.removeLayer(searchActiveMarker);
  searchActiveMarker = L.marker(latlng).addTo(map);
  searchActiveMarker
    .bindPopup(`<b>${displayName.split(",")[0]}</b>`)
    .openPopup();
  map.flyTo(latlng, 16, { duration: 1.2 });
  map.once("moveend", () =>
    resolveCityDistrictLoadsNear(latlng).then(() =>
      findLayerAndShowInfo(latlng),
    ),
  );
}

function resolveCityDistrictLoadsNear(latlng) {
  const pending = [];
  CITY_DISTRICT_REGISTRY.forEach((cfg) => {
    if (!cfg.viewBounds.contains(latlng)) return;
    if (cityDistrictState[cfg.id]?.loaded) return;
    pending.push(
      fetch(cfg.filePath)
        .then((r) => r.json())
        .then((data) => buildCityDistrictLayer(cfg, data))
        .catch(() => console.warn(`Error loading: ${cfg.filePath}`)),
    );
  });
  return pending.length ? Promise.all(pending) : Promise.resolve();
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
    selectedProvinceName = feature.properties.NAME_1 || "ناشناس";
    selectedProvinceBounds = layer.getBounds();
    map.flyToBounds(selectedProvinceBounds, {
      padding: [40, 40],
      maxZoom: 9,
      duration: 0.9,
    });

    const displayName =
      persianProvinceNames[selectedProvinceName] || selectedProvinceName;
    const courtsToShow = await getProvinceCourtsAsync(selectedProvinceName);
    showPopup(displayName, courtsToShow);
    showBackButton();
    updateCityLabelVisibility();
    updateProvinceLabelsVisibility();
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
    const name1 = f.properties.NAME_1 || "";
    const center = PROVINCE_LABEL_CENTERS[name1] || fastFeatureCenter(f);
    L.marker(center, {
      icon: L.divIcon({
        className: "province-label",
        html: `<span>${persianProvinceNames[name1] || name1}</span>`,
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
    const name2 = feature.properties.NAME_2 || "ناشناس";
    const name1 = feature.properties.NAME_1 || "";
    map.flyToBounds(layer.getBounds(), {
      padding: [50, 50],
      maxZoom: 12,
      duration: 0.8,
    });

    const persianName = persianShahrestanNames[name2] || name2;
    const provinceFa = persianProvinceNames[name1] || name1;
    const courtsToShow = await getAreaCourtsAsync(name1, name2);
    showPopup(`${provinceFa} — ${persianName}`, courtsToShow);
    showBackButton();
  });
}

function buildShahrestanLabels(geojsonData) {
  if (shahrestanLabelGroup) map.removeLayer(shahrestanLabelGroup);
  shahrestanLabelGroup = L.layerGroup();
  geojsonData.features.forEach((f) => {
    const label = persianShahrestanNames[f.properties.NAME_2 || ""];
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

function addWorldOverlay(iranGeoJSON) {
  const iranRings = [];
  iranGeoJSON.features.forEach((f) => {
    const coords =
      f.geometry.type === "Polygon"
        ? [f.geometry.coordinates]
        : f.geometry.coordinates;
    coords.forEach((poly) => poly.forEach((ring) => iranRings.push(ring)));
  });
  L.geoJSON(
    {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-180, -90],
            [180, -90],
            [180, 90],
            [-180, 90],
            [-180, -90],
          ],
          ...iranRings,
        ],
      },
    },
    {
      style: {
        color: "transparent",
        weight: 0,
        fillColor: "#dde8f0",
        fillOpacity: 1.0,
        noClip: true,
      },
      interactive: false,
    },
  ).addTo(map);
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

fetch("data/gadm41_IRN_1.json")
  .then((r) => r.json())
  .then((data) => {
    L.geoJSON(data, { onEachFeature: onEachProvince }).addTo(map);
    addWorldOverlay(data);
    buildProvinceLabels(data);
    updateProvinceLabelsVisibility();
  })
  .catch((err) => console.error("Error loading provinces", err));

fetch("data/gadm41_IRN_2.json")
  .then((r) => r.json())
  .then((data) => {
    districtLayerGroup = L.geoJSON(data, { onEachFeature: onEachShahrestan });
    buildShahrestanLabels(data);
    updateShahrestanVisibility();
  });

CITY_DISTRICT_REGISTRY.forEach((cfg) => {
  fetch(cfg.filePath)
    .then((r) => r.json())
    .then((data) => {
      buildCityDistrictLayer(cfg, data);
      updateAllCityDistrictVisibility();
    });
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
      const courtsToShow = await getAreaCourtsAsync(props.NAME_1, props.NAME_2);
      showPopup(
        `${persianProvinceNames[props.NAME_1] || props.NAME_1} — ${persianShahrestanNames[props.NAME_2] || props.NAME_2}`,
        courtsToShow,
      );
      showBackButton();
      return;
    }
  }

  for (let obj of provinceLayers) {
    if (obj.feature && pointInFeature(latlng, obj.feature)) {
      const name = obj.feature.properties.NAME_1 || "ناشناس";
      const courtsToShow = await getProvinceCourtsAsync(name);
      showPopup(persianProvinceNames[name] || name, courtsToShow);
      showBackButton();
      return;
    }
  }
}
