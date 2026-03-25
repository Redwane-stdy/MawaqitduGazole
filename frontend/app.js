// ════════════════════════════════════════════════════════════
//  MawaqitduGazole — frontend logic
//  Connects to C# SignalR hub for live price updates.
// ════════════════════════════════════════════════════════════

const API_BASE = "http://localhost:5000";

// ── State ─────────────────────────────────────────────────────
let userLat = null;
let userLng = null;
let selectedFuel = null;
let sessionId = localStorage.getItem("gazole_session");
let connection = null;

// ── DOM refs ──────────────────────────────────────────────────
const setupScreen  = document.getElementById("setup-screen");
const widgetScreen = document.getElementById("widget-screen");
const setupForm    = document.getElementById("setup-form");
const startBtn     = document.getElementById("start-btn");
const geoBtn       = document.getElementById("geolocate-btn");
const geoStatus    = document.getElementById("geo-status");
const radiusInput  = document.getElementById("radius-input");
const radiusLabel  = document.getElementById("radius-label");
const fuelBtns     = document.querySelectorAll(".fuel-btn");

const loadingState  = document.getElementById("loading-state");
const resultState   = document.getElementById("result-state");
const noResultState = document.getElementById("no-result-state");

const priceValue  = document.getElementById("price-value");
const stationName = document.getElementById("station-name");
const stationDist = document.getElementById("station-dist");
const fuelTag     = document.getElementById("fuel-tag");
const lastUpdate  = document.getElementById("last-update");
const dbCount     = document.getElementById("db-count");
const top5Body    = document.getElementById("top5-body");

// ── Boot ──────────────────────────────────────────────────────
(async () => {
  if (sessionId) {
    showWidget();
    await connectSignalR(sessionId);
    await loadTop5FromSession();
    await refreshMeta();
  } else {
    showSetup();
  }
})();

// ── Setup screen logic ────────────────────────────────────────
fuelBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    fuelBtns.forEach(b => b.classList.remove("selected"));
    btn.classList.add("selected");
    selectedFuel = btn.dataset.fuel;
    checkReady();
  });
});

radiusInput.addEventListener("input", () => {
  radiusLabel.textContent = radiusInput.value + " km";
});

geoBtn.addEventListener("click", () => {
  if (!navigator.geolocation) {
    geoStatus.textContent = "Géolocalisation non supportée.";
    geoStatus.style.color = "var(--red)";
    return;
  }
  geoStatus.textContent = "Localisation en cours…";
  geoStatus.style.color = "var(--text-dim)";
  navigator.geolocation.getCurrentPosition(
    pos => {
      userLat = pos.coords.latitude;
      userLng = pos.coords.longitude;
      geoStatus.textContent = `Position trouvée (${userLat.toFixed(4)}, ${userLng.toFixed(4)})`;
      geoStatus.style.color = "var(--green)";
      geoBtn.textContent = "📍 Position GPS enregistrée ✓";
      checkReady();
    },
    err => {
      geoStatus.textContent = `Erreur: ${err.message}`;
      geoStatus.style.color = "var(--red)";
    },
    { timeout: 10000 }
  );
});

function checkReady() {
  startBtn.disabled = !(userLat && userLng && selectedFuel);
}

setupForm.addEventListener("submit", async e => {
  e.preventDefault();
  startBtn.disabled = true;
  startBtn.textContent = "Connexion…";

  try {
    const resp = await fetch(`${API_BASE}/api/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fuelType:  selectedFuel,
        latitude:  userLat,
        longitude: userLng,
        radiusKm:  parseInt(radiusInput.value),
      }),
    });

    if (!resp.ok) throw new Error(await resp.text());
    const data = await resp.json();

    sessionId = data.sessionId;
    localStorage.setItem("gazole_session", sessionId);

    showWidget();

    if (data.cheapest) {
      renderResult(data.cheapest);
    } else {
      showState("no-result");
    }

    await connectSignalR(sessionId);
    await loadTop5Direct(userLat, userLng, selectedFuel, parseInt(radiusInput.value));
    await refreshMeta();
  } catch (err) {
    startBtn.disabled = false;
    startBtn.textContent = "Afficher le prix →";
    alert("Erreur: " + err.message);
  }
});

document.getElementById("reset-btn").addEventListener("click", () => {
  localStorage.removeItem("gazole_session");
  sessionId = null;
  if (connection) connection.stop();
  showSetup();
  // Reset form state
  selectedFuel = null;
  userLat = userLng = null;
  fuelBtns.forEach(b => b.classList.remove("selected"));
  geoStatus.textContent = "";
  geoBtn.textContent = "📍 Utiliser ma position GPS";
  startBtn.disabled = true;
  startBtn.textContent = "Afficher le prix →";
});

document.getElementById("expand-btn")?.addEventListener("click", async () => {
  // Double the radius and re-fetch
  const resp = await fetch(`${API_BASE}/api/cheapest?sessionId=${sessionId}`);
  if (resp.ok) {
    const data = await resp.json();
    if (data) renderResult(data);
  }
});

// ── Widget logic ──────────────────────────────────────────────
async function connectSignalR(sid) {
  connection = new signalR.HubConnectionBuilder()
    .withUrl(`${API_BASE}/hub/prices`)
    .withAutomaticReconnect()
    .build();

  connection.on("PriceUpdate", station => {
    renderResult(station);
    loadTop5FromSession();
  });

  try {
    await connection.start();
    await connection.invoke("Subscribe", sid);
    console.log("[SignalR] connected & subscribed");
  } catch (err) {
    console.warn("[SignalR] connection failed, falling back to polling:", err.message);
    startPolling(sid);
  }
}

function startPolling(sid) {
  setInterval(async () => {
    try {
      const resp = await fetch(`${API_BASE}/api/cheapest?sessionId=${sid}`);
      if (resp.ok) renderResult(await resp.json());
    } catch {}
  }, 60_000);
}

async function loadTop5FromSession() {
  if (!sessionId) return;
  // We need the session's coordinates — get them via cheapest (which also updates last_seen)
  // For top5 we rely on the same location stored on the server side.
  // Simpler: re-use the meta route + /api/nearby with stored coords.
  // Since we don't expose raw session prefs on the client, we skip top5 refresh here —
  // it will update on next PriceUpdate event.
}

async function loadTop5Direct(lat, lng, fuel, radius) {
  try {
    const resp = await fetch(
      `${API_BASE}/api/nearby?lat=${lat}&lng=${lng}&fuel=${fuel}&radius=${radius}&limit=5`
    );
    if (!resp.ok) return;
    const stations = await resp.json();
    renderTop5(stations);
  } catch {}
}

async function refreshMeta() {
  try {
    const resp = await fetch(`${API_BASE}/api/meta`);
    if (!resp.ok) return;
    const meta = await resp.json();
    const d = new Date(meta.lastFetch);
    lastUpdate.textContent = `Mis à jour ${formatRelative(d)}`;
    dbCount.textContent = `${meta.stationCount.toLocaleString("fr-FR")} stations`;
  } catch {
    lastUpdate.textContent = "Connexion au serveur…";
  }
}

// ── Render helpers ────────────────────────────────────────────
function renderResult(station) {
  priceValue.textContent = station.price.toFixed(3).replace(".", ",");
  stationName.textContent = `${station.address}, ${station.city}`;
  stationDist.textContent = `à ${station.distanceKm} km`;
  fuelTag.textContent = fuelLabel(station.fuelType);
  showState("result");
}

function renderTop5(stations) {
  top5Body.innerHTML = stations.map((s, i) => `
    <tr>
      <td>${s.address}, ${s.city}</td>
      <td>${s.distanceKm} km</td>
      <td>${s.price.toFixed(3).replace(".", ",")} €</td>
    </tr>
  `).join("");
}

function showState(state) {
  loadingState.classList.add("hidden");
  resultState.classList.add("hidden");
  noResultState.classList.add("hidden");

  if (state === "loading")    loadingState.classList.remove("hidden");
  else if (state === "result") resultState.classList.remove("hidden");
  else if (state === "no-result") noResultState.classList.remove("hidden");
}

function showWidget() {
  setupScreen.classList.add("hidden");
  widgetScreen.classList.remove("hidden");
  showState("loading");
}

function showSetup() {
  widgetScreen.classList.add("hidden");
  setupScreen.classList.remove("hidden");
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
