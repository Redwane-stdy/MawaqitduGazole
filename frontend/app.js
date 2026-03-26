// ════════════════════════════════════════════════════════════
//  MawaqitduGazole — frontend logic
//  Connects to C# SignalR hub for live price updates.
// ════════════════════════════════════════════════════════════

const API_BASE = "http://localhost:5050";

// ── Colored console logger ────────────────────────────────────
const LOGS = {
  BOOT:    ['background:#1a1a2e;color:#00ff88;font-weight:bold;padding:2px 6px;border-radius:3px', '🟢 [BOOT]'],
  GPS:     ['background:#1a1a2e;color:#00bfff;font-weight:bold;padding:2px 6px;border-radius:3px', '📍 [GPS]'],
  FETCH:   ['background:#1a1a2e;color:#f0a500;font-weight:bold;padding:2px 6px;border-radius:3px', '📡 [FETCH]'],
  SETUP:   ['background:#1a1a2e;color:#a78bfa;font-weight:bold;padding:2px 6px;border-radius:3px', '⚙️  [SETUP]'],
  SIGNALR: ['background:#1a1a2e;color:#fb923c;font-weight:bold;padding:2px 6px;border-radius:3px', '🔌 [SIGNALR]'],
  GEO:     ['background:#1a1a2e;color:#34d399;font-weight:bold;padding:2px 6px;border-radius:3px', '🗺️  [GEO]'],
  ERROR:   ['background:#2d1515;color:#f87171;font-weight:bold;padding:2px 6px;border-radius:3px', '❌ [ERROR]'],
  WARN:    ['background:#2d2515;color:#fbbf24;font-weight:bold;padding:2px 6px;border-radius:3px', '⚠️  [WARN]'],
};
function log(flag, msg, data) {
  const [style, prefix] = LOGS[flag] ?? LOGS.FETCH;
  if (data !== undefined) console.log(`%c${prefix}%c ${msg}`, style, 'color:inherit', data);
  else console.log(`%c${prefix}%c ${msg}`, style, 'color:inherit');
}

// ── State ─────────────────────────────────────────────────────
let userLat = null;
let userLng = null;
let selectedFuel = null;
let sessionId = localStorage.getItem("gazole_session");
let connection = null;
let currentStation = null;

// ── DOM refs ──────────────────────────────────────────────────
const setupScreen    = document.getElementById("setup-screen");
const widgetScreen   = document.getElementById("widget-screen");
const setupForm      = document.getElementById("setup-form");
const startBtn       = document.getElementById("start-btn");
const geoBtn         = document.getElementById("geolocate-btn");
const geoStatus      = document.getElementById("geo-status");
const geoFallback    = document.getElementById("geo-fallback");
const locationInput  = document.getElementById("location-input");
const locationSearch = document.getElementById("location-search-btn");
const locationStatus = document.getElementById("location-status");
const citySuggestions = document.getElementById("city-suggestions");
const radiusInput    = document.getElementById("radius-input");
const radiusLabel    = document.getElementById("radius-label");
const fuelBtns       = document.querySelectorAll(".fuel-btn");

const loadingState  = document.getElementById("loading-state");
const resultState   = document.getElementById("result-state");
const noResultState = document.getElementById("no-result-state");

const priceValue      = document.getElementById("price-value");
const stationName     = document.getElementById("station-name");
const stationDist     = document.getElementById("station-dist");
const fuelTag         = document.getElementById("fuel-tag");
const topbarFuelBadge = document.getElementById("topbar-fuel-badge");
const lastUpdate      = document.getElementById("last-update");
const dbCount         = document.getElementById("db-count");
const top5Body        = document.getElementById("top5-body");
const mapsBtn         = document.getElementById("maps-btn");

// ── Compare panel ──────────────────────────────────────────
const compareBtn     = document.getElementById("compare-btn");
const comparePanel   = document.getElementById("compare-panel");
const compareClose   = document.getElementById("compare-close");
const compareOverlay = document.getElementById("compare-overlay");

function openCompare()  {
  comparePanel?.classList.remove("hidden");
  compareOverlay?.classList.remove("hidden");
}
function closeCompare() {
  comparePanel?.classList.add("hidden");
  compareOverlay?.classList.add("hidden");
}
compareBtn?.addEventListener("click", openCompare);
compareClose?.addEventListener("click", closeCompare);
compareOverlay?.addEventListener("click", closeCompare);

// ── Boot ──────────────────────────────────────────────────────
(async () => {
  log('BOOT', `API_BASE = ${API_BASE}`);
  log('BOOT', `sessionId in localStorage = ${sessionId ?? 'none'}`);
  if (sessionId) {
    log('BOOT', `Session trouvée (${sessionId}) — validation serveur…`);
    try {
      const check = await fetch(`${API_BASE}/api/cheapest?sessionId=${sessionId}`);
      if (!check.ok) throw new Error(`HTTP ${check.status}`);
      const station = await check.json();
      log('BOOT', 'Session valide — restauration du widget');

      const raw = localStorage.getItem("gazole_prefs");
      if (raw) {
        const p = JSON.parse(raw);
        userLat = p.lat; userLng = p.lng; selectedFuel = p.fuel;
        log('BOOT', `Prefs restaurées — fuel=${selectedFuel}, lat=${userLat}, lng=${userLng}`);
      }
      showWidget();
      if (station) renderResult(station);
      await connectSignalR(sessionId);
      await loadTop5FromSession();
      await refreshMeta();
    } catch (err) {
      log('WARN', `Session invalide ou serveur injoignable (${err.message}) — retour accueil`);
      localStorage.removeItem("gazole_session");
      localStorage.removeItem("gazole_prefs");
      sessionId = null;
      showSetup();
      requestGeolocation();
    }
  } else {
    log('BOOT', 'No session, showing setup screen');
    showSetup();
    requestGeolocation();
  }
})();

// ── Setup screen logic ────────────────────────────────────────
fuelBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    fuelBtns.forEach(b => b.classList.remove("selected"));
    btn.classList.add("selected");
    selectedFuel = btn.dataset.fuel;
    log('SETUP', `Fuel selected: ${selectedFuel}`);
    checkReady();
  });
});

radiusInput.addEventListener("input", () => {
  radiusLabel.textContent = radiusInput.value + " km";
});

// ── Geolocation ───────────────────────────────────────────────
function requestGeolocation() {
  if (!navigator.geolocation) {
    log('GPS', 'navigator.geolocation not available (browser/context unsupported)');
    showGeoFallback("Géolocalisation non supportée — entrez votre ville.");
    return;
  }
  log('GPS', 'Requesting position…');
  geoStatus.textContent = "Localisation en cours…";
  geoStatus.style.color = "var(--text-dim)";
  navigator.geolocation.getCurrentPosition(
    pos => {
      userLat = pos.coords.latitude;
      userLng = pos.coords.longitude;
      log('GPS', `Position obtained: ${userLat.toFixed(5)}, ${userLng.toFixed(5)}`, { accuracy: pos.coords.accuracy });
      geoStatus.textContent = `Position trouvée (${userLat.toFixed(4)}, ${userLng.toFixed(4)})`;
      geoStatus.style.color = "var(--green)";
      geoBtn.textContent = "📍 Position GPS enregistrée ✓";
      if (geoFallback) geoFallback.classList.add("hidden");
      checkReady();
    },
    err => {
      const codes = { 1: 'PERMISSION_DENIED', 2: 'POSITION_UNAVAILABLE', 3: 'TIMEOUT' };
      log('ERROR', `Geolocation failed — code ${err.code} (${codes[err.code] ?? 'UNKNOWN'}): ${err.message}`);
      const msg = err.code === 1
        ? "Permission GPS refusée — entrez votre ville ci-dessous."
        : err.code === 3
          ? "Timeout GPS — entrez votre ville ci-dessous."
          : "Position GPS indisponible — entrez votre ville ci-dessous.";
      showGeoFallback(msg);
    },
    { timeout: 10000, enableHighAccuracy: false }
  );
}

function showGeoFallback(message) {
  log('GPS', `Showing fallback: ${message}`);
  geoStatus.textContent = message;
  geoStatus.style.color = "var(--text-dim)";
  if (geoFallback) geoFallback.classList.remove("hidden");
  if (locationInput) locationInput.focus();
}

geoBtn.addEventListener("click", requestGeolocation);

// ── API Adresse autocomplete ──────────────────────────────────
let debounceTimer = null;

async function searchCities(query) {
  log('GEO', `Searching cities for: "${query}"`);
  const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&type=municipality&limit=5`;
  log('FETCH', `GET ${url}`);
  const resp = await fetch(url);
  log('FETCH', `Response status: ${resp.status}`);
  if (!resp.ok) throw new Error(`API Adresse HTTP ${resp.status}`);
  const data = await resp.json();
  log('GEO', `Got ${data.features?.length ?? 0} suggestions`, data.features?.map(f => f.properties.label));
  return data.features ?? [];
}

function renderSuggestions(features) {
  if (!citySuggestions) return;
  if (!features.length) {
    citySuggestions.innerHTML = '<li class="no-result">Aucun résultat</li>';
    citySuggestions.classList.remove("hidden");
    return;
  }
  citySuggestions.innerHTML = features.map((f, i) => {
    const { label } = f.properties;
    const [lon, lat] = f.geometry.coordinates;
    return `<li data-lat="${lat}" data-lng="${lon}" data-label="${escapeHtml(label)}">${escapeHtml(label)}</li>`;
  }).join("");
  citySuggestions.classList.remove("hidden");

  citySuggestions.querySelectorAll("li[data-lat]").forEach(li => {
    li.addEventListener("click", () => {
      userLat = parseFloat(li.dataset.lat);
      userLng = parseFloat(li.dataset.lng);
      locationInput.value = li.dataset.label;
      log('GEO', `City selected: ${li.dataset.label} → ${userLat}, ${userLng}`);
      hideSuggestions();
      if (locationStatus) {
        locationStatus.textContent = `Position : ${li.dataset.label}`;
        locationStatus.style.color = "var(--green)";
      }
      checkReady();
    });
  });
}

function hideSuggestions() {
  if (citySuggestions) citySuggestions.classList.add("hidden");
}

if (locationInput) {
  locationInput.addEventListener("input", () => {
    const query = locationInput.value.trim();
    clearTimeout(debounceTimer);
    if (query.length < 2) { hideSuggestions(); return; }
    debounceTimer = setTimeout(async () => {
      try {
        const features = await searchCities(query);
        renderSuggestions(features);
      } catch (err) {
        log('ERROR', `Autocomplete failed: ${err.message}`);
      }
    }, 250);
  });

  locationInput.addEventListener("keydown", e => {
    if (e.key === "Escape") hideSuggestions();
    if (e.key === "Enter") { e.preventDefault(); locationSearch?.click(); }
  });
}

document.addEventListener("click", e => {
  if (!e.target.closest(".autocomplete-wrapper")) hideSuggestions();
});

if (locationSearch) {
  locationSearch.addEventListener("click", async () => {
    const query = locationInput?.value.trim();
    if (!query) return;

    // If a suggestion is already selected (userLat set), just validate
    if (userLat && userLng) { checkReady(); hideSuggestions(); return; }

    locationSearch.disabled = true;
    if (locationStatus) { locationStatus.textContent = "Recherche…"; locationStatus.style.color = "var(--text-dim)"; }
    try {
      const features = await searchCities(query);
      if (!features.length) throw new Error("Aucun résultat.");
      const best = features[0];
      userLat = best.geometry.coordinates[1];
      userLng = best.geometry.coordinates[0];
      const label = best.properties.label;
      log('GEO', `Resolved to: ${label} → ${userLat}, ${userLng}`);
      if (locationInput) locationInput.value = label;
      if (locationStatus) { locationStatus.textContent = `Position : ${label}`; locationStatus.style.color = "var(--green)"; }
      hideSuggestions();
      checkReady();
    } catch (err) {
      log('ERROR', `City search failed: ${err.message}`);
      if (locationStatus) { locationStatus.textContent = "Erreur : " + err.message; locationStatus.style.color = "var(--red)"; }
    } finally {
      if (locationSearch) locationSearch.disabled = false;
    }
  });
}

function checkReady() {
  const ready = !!(userLat && userLng && selectedFuel);
  log('SETUP', `checkReady → ${ready} (lat=${userLat}, lng=${userLng}, fuel=${selectedFuel})`);
  startBtn.disabled = !ready;
}

// ── Setup form submit ─────────────────────────────────────────
setupForm.addEventListener("submit", async e => {
  e.preventDefault();
  startBtn.disabled = true;
  startBtn.textContent = "Connexion…";

  const payload = {
    fuelType:  selectedFuel,
    latitude:  userLat,
    longitude: userLng,
    radiusKm:  parseInt(radiusInput.value),
  };
  log('SETUP', `Submitting setup`, payload);
  log('FETCH', `POST ${API_BASE}/api/setup`);

  try {
    const resp = await fetch(`${API_BASE}/api/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    log('FETCH', `POST /api/setup → ${resp.status} ${resp.statusText}`);
    if (!resp.ok) {
      const body = await resp.text();
      log('ERROR', `Setup failed — HTTP ${resp.status}`, body);
      throw new Error(body || `HTTP ${resp.status}`);
    }
    const data = await resp.json();
    log('SETUP', `Setup success`, data);

    sessionId = data.sessionId;
    localStorage.setItem("gazole_session", sessionId);
    localStorage.setItem("gazole_prefs", JSON.stringify({
      lat: userLat, lng: userLng, fuel: selectedFuel, radius: parseInt(radiusInput.value)
    }));
    showWidget();

    if (data.cheapest) {
      log('SETUP', `Cheapest station received`, data.cheapest);
      renderResult(data.cheapest);
    } else {
      log('WARN', 'No cheapest station in response — showing no-result state');
      showState("no-result");
    }

    await connectSignalR(sessionId);
    await loadTop5Direct(userLat, userLng, selectedFuel, parseInt(radiusInput.value));
    await refreshMeta();
  } catch (err) {
    log('ERROR', `Setup error: ${err.message}`, err);
    startBtn.disabled = false;
    startBtn.textContent = "Afficher le prix →";
    alert("Erreur: " + err.message);
  }
});

// ── Reset ─────────────────────────────────────────────────────
document.getElementById("reset-btn").addEventListener("click", () => {
  log('BOOT', 'Reset triggered');
  localStorage.removeItem("gazole_session");
  sessionId = null;
  if (connection) connection.stop();
  showSetup();
  selectedFuel = null;
  userLat = userLng = null;
  currentStation = null;
  fuelBtns.forEach(b => b.classList.remove("selected"));
  if (geoStatus) { geoStatus.textContent = ""; }
  if (geoBtn) geoBtn.textContent = "📍 Utiliser ma position GPS";
  if (geoFallback) geoFallback.classList.add("hidden");
  if (locationInput) locationInput.value = "";
  if (locationStatus) locationStatus.textContent = "";
  hideSuggestions();
  startBtn.disabled = true;
  startBtn.textContent = "Afficher le prix →";
  requestGeolocation();
});

document.getElementById("expand-btn")?.addEventListener("click", async () => {
  log('FETCH', `GET ${API_BASE}/api/cheapest?sessionId=${sessionId}`);
  const resp = await fetch(`${API_BASE}/api/cheapest?sessionId=${sessionId}`);
  log('FETCH', `GET /api/cheapest → ${resp.status}`);
  if (resp.ok) {
    const data = await resp.json();
    if (data) renderResult(data);
  }
});

// ── Google Maps button ─────────────────────────────────────────
mapsBtn?.addEventListener("click", () => {
  if (!currentStation) { log('WARN', 'Maps button clicked but no currentStation'); return; }
  const dest = encodeURIComponent(`${currentStation.address}, ${currentStation.city}, France`);
  const url = (userLat && userLng)
    ? `https://www.google.com/maps/dir/${userLat},${userLng}/${dest}`
    : `https://www.google.com/maps/search/${dest}`;
  log('FETCH', `Opening Google Maps: ${url}`);
  window.open(url, '_blank');
});

// ── SignalR ───────────────────────────────────────────────────
async function connectSignalR(sid) {
  if (typeof signalR === 'undefined') {
    log('WARN', 'SignalR CDN not loaded — falling back to polling');
    startPolling(sid);
    return;
  }
  log('SIGNALR', `Connecting to ${API_BASE}/hub/prices…`);
  connection = new signalR.HubConnectionBuilder()
    .withUrl(`${API_BASE}/hub/prices`)
    .withAutomaticReconnect()
    .build();

  connection.on("PriceUpdate", station => {
    log('SIGNALR', 'PriceUpdate received', station);
    renderResult(station);
    loadTop5FromSession();
  });

  try {
    await connection.start();
    log('SIGNALR', `Connected. Subscribing to session ${sid}…`);
    await connection.invoke("Subscribe", sid);
    log('SIGNALR', 'Subscribed ✓');
  } catch (err) {
    log('WARN', `SignalR connection failed, falling back to polling: ${err.message}`);
    startPolling(sid);
  }
}

function startPolling(sid) {
  log('SIGNALR', `Starting polling every 60s for session ${sid}`);
  setInterval(async () => {
    try {
      const resp = await fetch(`${API_BASE}/api/cheapest?sessionId=${sid}`);
      if (resp.ok) renderResult(await resp.json());
    } catch {}
  }, 60_000);
}

async function loadTop5FromSession() {
  const raw = localStorage.getItem("gazole_prefs");
  if (!raw) { log('WARN', 'loadTop5FromSession: no prefs in localStorage'); return; }
  try {
    const p = JSON.parse(raw);
    log('FETCH', `loadTop5FromSession → lat=${p.lat}, lng=${p.lng}, fuel=${p.fuel}, radius=${p.radius}`);
    await loadTop5Direct(p.lat, p.lng, p.fuel, p.radius);
  } catch (err) {
    log('ERROR', `loadTop5FromSession failed: ${err.message}`);
  }
}

async function loadTop5Direct(lat, lng, fuel, radius) {
  const url = `${API_BASE}/api/nearby?lat=${lat}&lng=${lng}&fuel=${fuel}&radius=${radius}&limit=5`;
  log('FETCH', `GET ${url}`);
  try {
    const resp = await fetch(url);
    log('FETCH', `GET /api/nearby → ${resp.status}`);
    if (!resp.ok) { log('WARN', `nearby returned ${resp.status}`); return; }
    const stations = await resp.json();
    log('FETCH', `Got ${stations.length} nearby stations`);
    renderTop5(stations);
  } catch (err) {
    log('ERROR', `loadTop5Direct failed: ${err.message}`);
  }
}

async function refreshMeta() {
  log('FETCH', `GET ${API_BASE}/api/meta`);
  try {
    const resp = await fetch(`${API_BASE}/api/meta`);
    log('FETCH', `GET /api/meta → ${resp.status}`);
    if (!resp.ok) return;
    const meta = await resp.json();
    log('FETCH', 'Meta received', meta);
    const d = new Date(meta.lastFetch);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const timeStr = d.toLocaleTimeString("fr-FR"); // HH:MM:SS
    const dateStr = d.toLocaleDateString("fr-FR"); // DD/MM/YYYY
    lastUpdate.textContent = sameDay
      ? `Actualisé à ${timeStr}`
      : `Actualisé le ${dateStr} à ${timeStr}`;
    dbCount.textContent = `${meta.stationCount.toLocaleString("fr-FR")} stations`;
  } catch (err) {
    log('ERROR', `refreshMeta failed: ${err.message}`);
    lastUpdate.textContent = "Connexion au serveur…";
  }
}

// ── Render helpers ────────────────────────────────────────────
function renderResult(station) {
  currentStation = station;
  priceValue.textContent = station.price.toFixed(3).replace(".", ",");
  stationName.textContent = `${station.address}, ${station.city}`;
  stationDist.textContent = `à ${station.distanceKm} km`;
  fuelTag.textContent = fuelLabel(station.fuelType);
  if (topbarFuelBadge) topbarFuelBadge.textContent = fuelLabel(station.fuelType);
  showState("result");
}

let top5Stations = [];

function renderTop5(stations) {
  top5Stations = stations;
  top5Body.innerHTML = stations.map((s, i) => `
    <tr data-idx="${i}"${i === 0 ? ' class="selected"' : ''}>
      <td>${i + 1}</td>
      <td>${escapeHtml(s.address)}, ${escapeHtml(s.city)}</td>
      <td>${s.distanceKm} km</td>
      <td>${s.price.toFixed(3).replace(".", ",")} €</td>
    </tr>
  `).join("");
}

top5Body.addEventListener("click", e => {
  const row = e.target.closest("tr[data-idx]");
  if (!row) return;
  const s = top5Stations[parseInt(row.dataset.idx)];
  if (!s) return;
  top5Body.querySelectorAll("tr").forEach(r => r.classList.remove("selected"));
  row.classList.add("selected");
  renderResult(s);
  closeCompare();
  log('FETCH', `Station sélectionnée : ${s.address}, ${s.city} — ${s.price.toFixed(3)} €/L`);
});

function showState(state) {
  loadingState.classList.add("hidden");
  resultState.classList.add("hidden");
  noResultState.classList.add("hidden");

  if (state === "loading")        loadingState.classList.remove("hidden");
  else if (state === "result")    resultState.classList.remove("hidden");
  else if (state === "no-result") noResultState.classList.remove("hidden");
}

let logConnected = false;

function showWidget() {
  setupScreen.classList.add("hidden");
  widgetScreen.classList.remove("hidden");
  if (logToggleBtn) logToggleBtn.classList.remove("hidden");
  if (!logConnected) { connectLogSSE(); logConnected = true; }
  showState("loading");
}

function showSetup() {
  widgetScreen.classList.add("hidden");
  setupScreen.classList.remove("hidden");
  if (logToggleBtn) logToggleBtn.classList.add("hidden");
  if (logPanel) logPanel.classList.add("hidden");
}

// ── Log panel ─────────────────────────────────────────────────
const logPanel      = document.getElementById("log-panel");
const logToggleBtn  = document.getElementById("log-toggle-btn");
const logClearBtn   = document.getElementById("log-clear-btn");
const logCloseBtn   = document.getElementById("log-close-btn");
const logTabs       = document.querySelectorAll(".log-tab");
const logPaneApi    = document.getElementById("log-pane-api");
const logPaneIng    = document.getElementById("log-pane-ingestion");

logToggleBtn?.addEventListener("click", () => {
  logPanel.classList.toggle("hidden");
  if (!logPanel.classList.contains("hidden")) logToggleBtn.style.bottom = "296px";
  else logToggleBtn.style.bottom = "1rem";
});
logCloseBtn?.addEventListener("click", () => {
  logPanel.classList.add("hidden");
  if (logToggleBtn) logToggleBtn.style.bottom = "1rem";
});
logClearBtn?.addEventListener("click", () => {
  if (logPaneApi)  logPaneApi.innerHTML = "";
  if (logPaneIng)  logPaneIng.innerHTML = "";
});
logTabs.forEach(tab => {
  tab.addEventListener("click", () => {
    logTabs.forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    const which = tab.dataset.tab;
    if (logPaneApi) { logPaneApi.classList.toggle("hidden", which !== "api"); logPaneApi.classList.toggle("active", which === "api"); }
    if (logPaneIng) { logPaneIng.classList.toggle("hidden", which !== "ingestion"); logPaneIng.classList.toggle("active", which === "ingestion"); }
  });
});

function appendLog(pane, entry) {
  if (!pane) return;
  const chClass  = entry.channel === "API" ? "log-ch-api" : "log-ch-ing";
  const lvlClass = { INFO: "log-lvl-info", WARN: "log-lvl-warn", ERROR: "log-lvl-error", FATAL: "log-lvl-fatal" }[entry.level] ?? "log-lvl-info";
  const line = document.createElement("div");
  line.className = "log-line";
  line.innerHTML = `<span class="log-ts">[${entry.ts}]</span>`
    + `<span class="${chClass}">[${entry.channel}]</span>`
    + `<span class="${lvlClass}">[${entry.level}]</span>`
    + `<span class="log-msg">${escapeHtml(entry.msg)}</span>`;
  pane.appendChild(line);
  while (pane.children.length > 300) pane.removeChild(pane.firstChild);
  pane.scrollTop = pane.scrollHeight;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function connectLogSSE() {
  log('SIGNALR', `Connecting SSE log stream → ${API_BASE}/logs`);
  const apiSrc = new EventSource(`${API_BASE}/logs`);
  apiSrc.onmessage = e => { try { appendLog(logPaneApi, JSON.parse(e.data)); } catch {} };
  apiSrc.onerror   = () => log('WARN', 'SSE API log stream error/closed');

  log('SIGNALR', 'Connecting SSE log stream → http://localhost:5001/logs');
  const ingSrc = new EventSource("http://localhost:5001/logs");
  ingSrc.onmessage = e => { try { appendLog(logPaneIng, JSON.parse(e.data)); } catch {} };
  ingSrc.onerror   = () => log('WARN', 'SSE Ingestion log stream error/closed');
}

function fuelLabel(type) {
  return { Gazole: "Diesel", SP95: "SP95", SP98: "SP98", E10: "E10", E85: "E85", GPLc: "GPL" }[type] ?? type;
}

function formatRelative(date) {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60)   return "à l'instant";
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  return `il y a ${Math.floor(diff / 3600)} h`;
}
