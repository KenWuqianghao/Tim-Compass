const ARRIVAL_DISTANCE_METERS = 75;
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const els = {
  targetName: document.querySelector("#targetName"),
  distanceText: document.querySelector("#distanceText"),
  detailDistance: document.querySelector("#detailDistance"),
  bearingText: document.querySelector("#bearingText"),
  accuracyText: document.querySelector("#accuracyText"),
  needle: document.querySelector("#needle"),
  locateButton: document.querySelector("#locateButton"),
  demoButton: document.querySelector("#demoButton"),
  refreshButton: document.querySelector("#refreshButton"),
  statusText: document.querySelector("#statusText"),
  celebration: document.querySelector("#celebration"),
};

const state = {
  user: null,
  target: null,
  heading: 0,
  watchId: null,
  lookupUser: null,
  lastLookupAt: 0,
  isLookingUp: false,
  orientationReady: false,
  celebrating: false,
};

function toRad(value) {
  return (value * Math.PI) / 180;
}

function toDeg(value) {
  return (value * 180) / Math.PI;
}

function normalizeDegrees(value) {
  return (value + 360) % 360;
}

function distanceMeters(a, b) {
  const radius = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * radius * Math.asin(Math.sqrt(h));
}

function bearingDegrees(a, b) {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  return normalizeDegrees(toDeg(Math.atan2(y, x)));
}

function formatDistance(meters) {
  if (!Number.isFinite(meters)) return "--";
  if (meters < 1000) return `${Math.round(meters)} m`;
  if (meters < 10000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters / 1000)} km`;
}

function directionLabel(degrees) {
  if (!Number.isFinite(degrees)) return "--";
  const labels = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return labels[Math.round(degrees / 45) % labels.length];
}

function setStatus(message) {
  els.statusText.textContent = message;
}

function setTarget(target) {
  state.target = target;
  els.targetName.textContent = target?.name || "Nearest Tim Hortons";
  render();
}

function render() {
  if (!state.user || !state.target) {
    els.needle.style.setProperty("--rotation", "0deg");
    return;
  }

  const distance = distanceMeters(state.user, state.target);
  const bearing = bearingDegrees(state.user, state.target);
  const relativeBearing = normalizeDegrees(bearing - state.heading);

  els.needle.style.setProperty("--rotation", `${relativeBearing}deg`);
  els.distanceText.textContent = formatDistance(distance);
  els.detailDistance.textContent = formatDistance(distance);
  els.bearingText.textContent = `${directionLabel(bearing)} ${Math.round(bearing)}°`;
  els.accuracyText.textContent = state.user.accuracy
    ? `±${Math.round(state.user.accuracy)} m`
    : "--";

  if (distance <= ARRIVAL_DISTANCE_METERS) {
    celebrate();
  } else if (state.celebrating) {
    stopCelebration();
  }
}

function celebrate() {
  state.celebrating = true;
  els.celebration.classList.add("is-visible");
  els.celebration.setAttribute("aria-hidden", "false");
}

function stopCelebration() {
  state.celebrating = false;
  els.celebration.classList.remove("is-visible");
  els.celebration.setAttribute("aria-hidden", "true");
}

function overpassQuery({ lat, lon }, radius = 25000) {
  return `
    [out:json][timeout:25];
    (
      node(around:${radius},${lat},${lon})["name"~"^Tim Hortons$",i];
      way(around:${radius},${lat},${lon})["name"~"^Tim Hortons$",i];
      relation(around:${radius},${lat},${lon})["name"~"^Tim Hortons$",i];
      node(around:${radius},${lat},${lon})["brand"~"^Tim Hortons$",i];
      way(around:${radius},${lat},${lon})["brand"~"^Tim Hortons$",i];
      relation(around:${radius},${lat},${lon})["brand"~"^Tim Hortons$",i];
    );
    out center tags 30;
  `;
}

async function fetchNearestTim(user) {
  const params = new URLSearchParams({ data: overpassQuery(user) });
  let lastError;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: params,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
      });

      if (!response.ok) {
        throw new Error(`Overpass request failed with ${response.status}`);
      }

      const payload = await response.json();
      const candidates = payload.elements
        .map((item) => {
          const lat = item.lat ?? item.center?.lat;
          const lon = item.lon ?? item.center?.lon;
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

          const candidate = {
            lat,
            lon,
            name: item.tags?.name || "Tim Hortons",
          };

          return {
            ...candidate,
            distance: distanceMeters(user, candidate),
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.distance - b.distance);

      if (candidates.length > 0) {
        return candidates[0];
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("No Tim Hortons found nearby.");
}

function updateUser(position) {
  state.user = {
    lat: position.coords.latitude,
    lon: position.coords.longitude,
    accuracy: position.coords.accuracy,
  };
}

async function refreshTarget() {
  if (!state.user || state.isLookingUp) return;

  state.isLookingUp = true;
  setStatus("Finding the nearest Tim Hortons...");
  try {
    setTarget(await fetchNearestTim(state.user));
    state.lookupUser = { ...state.user };
    state.lastLookupAt = Date.now();
    setStatus("Compass is locked on.");
  } catch (error) {
    setStatus("Could not find a nearby Tim Hortons from OpenStreetMap.");
    console.error(error);
  } finally {
    state.isLookingUp = false;
  }
}

function shouldRefreshTarget() {
  if (!state.target || !state.lookupUser) return true;

  const moved = distanceMeters(state.user, state.lookupUser);
  const stale = Date.now() - state.lastLookupAt > 120000;

  return moved > 300 || stale;
}

async function requestOrientation() {
  if (state.orientationReady) return;

  const orientation = window.DeviceOrientationEvent;
  if (orientation?.requestPermission) {
    try {
      const permission = await orientation.requestPermission();
      if (permission !== "granted") {
        setStatus("Location works, but compass permission was not granted.");
        return;
      }
    } catch {
      setStatus("Location works, but compass permission was not granted.");
      return;
    }
  }

  window.addEventListener("deviceorientationabsolute", handleOrientation, true);
  window.addEventListener("deviceorientation", handleOrientation, true);
  state.orientationReady = true;
}

function handleOrientation(event) {
  const webkitHeading = event.webkitCompassHeading;
  if (Number.isFinite(webkitHeading)) {
    state.heading = webkitHeading;
  } else if (Number.isFinite(event.alpha)) {
    state.heading = normalizeDegrees(360 - event.alpha);
  }

  render();
}

async function startLocation() {
  if (!("geolocation" in navigator)) {
    setStatus("This browser does not support location.");
    return;
  }

  await requestOrientation();
  els.locateButton.disabled = true;
  els.locateButton.textContent = "Locating...";
  setStatus("Waiting for GPS...");

  if (state.watchId !== null) {
    navigator.geolocation.clearWatch(state.watchId);
  }

  state.watchId = navigator.geolocation.watchPosition(
    async (position) => {
      updateUser(position);
      els.locateButton.disabled = false;
      els.locateButton.textContent = "Use my location";
      els.accuracyText.textContent = `±${Math.round(position.coords.accuracy)} m`;

      if (shouldRefreshTarget()) {
        await refreshTarget();
      } else {
        render();
      }
    },
    (error) => {
      els.locateButton.disabled = false;
      els.locateButton.textContent = "Use my location";
      setStatus(error.message || "Location permission was not granted.");
    },
    {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 15000,
    },
  );
}

function startDemo() {
  stopCelebration();
  state.user = {
    lat: 43.6531,
    lon: -79.3839,
    accuracy: 18,
  };
  setTarget({
    name: "Tim Hortons",
    lat: 43.65335,
    lon: -79.38336,
  });
  state.heading = 300;
  setStatus("Demo mode: move close to arrival after a short preview.");
  render();

  window.setTimeout(() => {
    state.user = {
      ...state.user,
      lat: 43.65332,
      lon: -79.38339,
    };
    setStatus("You made it.");
    render();
  }, 2200);
}

els.locateButton.addEventListener("click", startLocation);
els.demoButton.addEventListener("click", startDemo);
els.refreshButton.addEventListener("click", refreshTarget);
els.celebration.addEventListener("click", stopCelebration);

render();
