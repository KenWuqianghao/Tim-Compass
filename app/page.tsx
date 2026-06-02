"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type LatLon = {
  lat: number;
  lon: number;
};

type UserLocation = LatLon & {
  accuracy?: number;
};

type TimLocation = LatLon & {
  address?: string;
  distance: number;
  id: string;
  name: string;
  source: string;
};

type DeviceOrientationEventWithCompass = DeviceOrientationEvent & {
  webkitCompassHeading?: number;
};

const ARRIVAL_DISTANCE_METERS = 75;
const TARGET_REFRESH_DISTANCE_METERS = 250;
const TARGET_REFRESH_MS = 90_000;
const HEADING_DEADBAND_DEGREES = 0.7;
const HEADING_SMOOTHING = 0.18;

function toRad(value: number) {
  return (value * Math.PI) / 180;
}

function toDeg(value: number) {
  return (value * 180) / Math.PI;
}

function normalizeDegrees(value: number) {
  return (value + 360) % 360;
}

function shortestAngleDelta(from: number, to: number) {
  return ((to - from + 540) % 360) - 180;
}

function smoothDegrees(current: number, next: number, alpha: number) {
  return normalizeDegrees(current + shortestAngleDelta(current, next) * alpha);
}

function distanceMeters(a: LatLon, b: LatLon) {
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

function bearingDegrees(a: LatLon, b: LatLon) {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  return normalizeDegrees(toDeg(Math.atan2(y, x)));
}

function formatDistance(meters?: number) {
  if (typeof meters !== "number" || !Number.isFinite(meters)) return "--";
  const value = meters;
  if (value < 1000) return `${Math.round(value)} m`;
  if (value < 10000) return `${(value / 1000).toFixed(1)} km`;
  return `${Math.round(value / 1000)} km`;
}

function directionLabel(degrees?: number) {
  if (typeof degrees !== "number" || !Number.isFinite(degrees)) return "--";
  const labels = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return labels[Math.round(degrees / 45) % labels.length] ?? "--";
}

async function requestCompassPermission() {
  const orientation = DeviceOrientationEvent as typeof DeviceOrientationEvent & {
    requestPermission?: () => Promise<PermissionState>;
  };

  if (!orientation?.requestPermission) return true;

  try {
    return (await orientation.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

export default function Home() {
  const [user, setUser] = useState<UserLocation | null>(null);
  const [target, setTarget] = useState<TimLocation | null>(null);
  const [heading, setHeading] = useState(0);
  const [status, setStatus] = useState("Ready when you are.");
  const [isLocating, setIsLocating] = useState(false);

  const watchIdRef = useRef<number | null>(null);
  const lastLookupRef = useRef<{ at: number; user: UserLocation } | null>(null);
  const targetRequestRef = useRef<AbortController | null>(null);
  const headingRef = useRef(0);
  const rawHeadingRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);

  const metrics = useMemo(() => {
    if (!user || !target) {
      return {
        bearing: undefined,
        distance: undefined,
        relativeBearing: 0,
      };
    }

    const distance = distanceMeters(user, target);
    const bearing = bearingDegrees(user, target);

    return {
      bearing,
      distance,
      relativeBearing: normalizeDegrees(bearing - heading),
    };
  }, [heading, target, user]);
  const isCelebrating =
    metrics.distance !== undefined && metrics.distance <= ARRIVAL_DISTANCE_METERS;

  const refreshTarget = useCallback(async (nextUser: UserLocation) => {
    targetRequestRef.current?.abort();
    const controller = new AbortController();
    targetRequestRef.current = controller;
    setStatus("Finding the nearest Tim Hortons...");

    try {
      const params = new URLSearchParams({
        lat: String(nextUser.lat),
        lon: String(nextUser.lon),
      });
      const response = await fetch(`/api/nearest-tim?${params}`, {
        signal: controller.signal,
      });
      const payload = (await response.json()) as {
        error?: string;
        location?: TimLocation;
      };

      if (!response.ok || !payload.location) {
        throw new Error(payload.error || "Unable to find a nearby Tim Hortons.");
      }

      setTarget(payload.location);
      lastLookupRef.current = { at: Date.now(), user: nextUser };
      setStatus(payload.location.address || "Compass is locked on.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setStatus(error instanceof Error ? error.message : "Unable to find a nearby Tim Hortons.");
    }
  }, []);

  const shouldRefreshTarget = useCallback(
    (nextUser: UserLocation) => {
      if (!target || !lastLookupRef.current) return true;
      const moved = distanceMeters(nextUser, lastLookupRef.current.user);
      const stale = Date.now() - lastLookupRef.current.at > TARGET_REFRESH_MS;

      return moved > TARGET_REFRESH_DISTANCE_METERS || stale;
    },
    [target],
  );

  const handlePosition = useCallback(
    (position: GeolocationPosition) => {
      const nextUser = {
        accuracy: position.coords.accuracy,
        lat: position.coords.latitude,
        lon: position.coords.longitude,
      };

      setUser(nextUser);
      setIsLocating(false);

      if (shouldRefreshTarget(nextUser)) {
        void refreshTarget(nextUser);
      }
    },
    [refreshTarget, shouldRefreshTarget],
  );

  const startLocation = useCallback(async () => {
    if (!("geolocation" in navigator)) {
      setStatus("This browser does not support location.");
      return;
    }

    if (!(await requestCompassPermission())) {
      setStatus("Location works, but compass permission was not granted.");
    }

    setIsLocating(true);
    setStatus("Waiting for GPS...");

    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      handlePosition,
      (error) => {
        setIsLocating(false);
        setStatus(error.message || "Location permission was not granted.");
      },
      {
        enableHighAccuracy: true,
        maximumAge: 3000,
        timeout: 15000,
      },
    );
  }, [handlePosition]);

  const startDemo = useCallback(() => {
    const demoUser = {
      accuracy: 18,
      lat: 43.6531,
      lon: -79.3839,
    };
    const demoTarget = {
      distance: 52,
      id: "demo",
      lat: 43.65335,
      lon: -79.38336,
      name: "Tim Hortons",
      source: "demo",
    };

    lastLookupRef.current = { at: Date.now(), user: demoUser };
    setUser(demoUser);
    setTarget(demoTarget);
    rawHeadingRef.current = 300;
    headingRef.current = 300;
    setHeading(300);
    setStatus("Demo mode: moving close to arrival.");

    window.setTimeout(() => {
      setUser({
        ...demoUser,
        lat: 43.65332,
        lon: -79.38339,
      });
      setStatus("You made it.");
    }, 2200);
  }, []);

  useEffect(() => {
    function handleOrientation(event: DeviceOrientationEventWithCompass) {
      let nextHeading: number | null = null;
      if (typeof event.webkitCompassHeading === "number" && Number.isFinite(event.webkitCompassHeading)) {
        nextHeading = event.webkitCompassHeading;
      } else if (typeof event.alpha === "number" && Number.isFinite(event.alpha)) {
        nextHeading = normalizeDegrees(360 - event.alpha);
      }

      if (nextHeading === null) return;
      rawHeadingRef.current = nextHeading;
    }

    function animateHeading() {
      const delta = Math.abs(shortestAngleDelta(headingRef.current, rawHeadingRef.current));
      if (delta > HEADING_DEADBAND_DEGREES) {
        const next = smoothDegrees(headingRef.current, rawHeadingRef.current, HEADING_SMOOTHING);
        headingRef.current = next;
        setHeading(next);
      }

      animationFrameRef.current = window.requestAnimationFrame(animateHeading);
    }

    window.addEventListener("deviceorientationabsolute", handleOrientation, true);
    window.addEventListener("deviceorientation", handleOrientation, true);
    animationFrameRef.current = window.requestAnimationFrame(animateHeading);

    return () => {
      window.removeEventListener("deviceorientationabsolute", handleOrientation, true);
      window.removeEventListener("deviceorientation", handleOrientation, true);
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      targetRequestRef.current?.abort();
    };
  }, []);

  return (
    <>
      <main className="app-shell" aria-live="polite">
        <section className="topbar" aria-label="Tim Compass status">
          <div>
            <p className="eyebrow">Tim Compass</p>
            <h1>{target?.name || "Find your nearest Tim Hortons"}</h1>
          </div>
          <button
            aria-label="Refresh nearest Tim Hortons"
            className="icon-button"
            onClick={() => {
              if (user) void refreshTarget(user);
            }}
            type="button"
          >
            <span aria-hidden="true">↻</span>
          </button>
        </section>

        <section className="compass-stage" aria-label="Compass">
          <div className="distance-pill">{formatDistance(metrics.distance)}</div>
          <div className="compass" aria-hidden="true">
            <div className="compass-ring">
              <span className="cardinal north">N</span>
              <span className="cardinal east">E</span>
              <span className="cardinal south">S</span>
              <span className="cardinal west">W</span>
            </div>
            <div
              className="needle"
              style={{ "--rotation": `${metrics.relativeBearing}deg` } as React.CSSProperties}
            >
              <div className="needle-head" />
              <div className="needle-tail" />
            </div>
            <div className="center-cap">
              <span />
            </div>
          </div>
        </section>

        <section className="info-panel" aria-label="Nearest Tim Hortons details">
          <div className="metric">
            <span>Direction</span>
            <strong>
              {metrics.bearing === undefined
                ? "--"
                : `${directionLabel(metrics.bearing)} ${Math.round(metrics.bearing)}°`}
            </strong>
          </div>
          <div className="metric">
            <span>Distance</span>
            <strong>{formatDistance(metrics.distance)}</strong>
          </div>
          <div className="metric">
            <span>Accuracy</span>
            <strong>{user?.accuracy ? `±${Math.round(user.accuracy)} m` : "--"}</strong>
          </div>
        </section>

        <section className="actions" aria-label="Controls">
          <button className="primary-button" disabled={isLocating} onClick={startLocation} type="button">
            {isLocating ? "Locating..." : "Use my location"}
          </button>
          <button className="secondary-button" onClick={startDemo} type="button">
            Demo
          </button>
        </section>

        <p className="status">{status}</p>
      </main>

      <div className={`celebration ${isCelebrating ? "is-visible" : ""}`} aria-hidden={!isCelebrating}>
        <div className="celebration-sky">
          <span className="burst burst-one" />
          <span className="burst burst-two" />
          <span className="burst burst-three" />
        </div>
        <div className="leaf leaf-one" aria-hidden="true" />
        <div className="leaf leaf-two" aria-hidden="true" />
        <div className="leaf leaf-three" aria-hidden="true" />
        <div className="cup" aria-hidden="true">
          <span className="cup-lid" />
          <span className="cup-body" />
          <span className="cup-label">TIM</span>
        </div>
        <div className="celebration-copy">
          <p>Arrived</p>
          <strong>Double-double time</strong>
        </div>
      </div>
    </>
  );
}
