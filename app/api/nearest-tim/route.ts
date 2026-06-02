import { NextResponse } from "next/server";

export const runtime = "nodejs";

type LatLon = {
  lat: number;
  lon: number;
};

type TimLocation = LatLon & {
  address?: string;
  distance: number;
  id: string;
  name: string;
  source: "google" | "official" | "nominatim" | "overpass";
};

type OverpassElement = {
  center?: LatLon;
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string | undefined>;
  type: string;
};

type NominatimPlace = {
  display_name?: string;
  lat: string;
  lon: string;
  osm_id: number;
  osm_type: string;
};

type ReverseGeocode = {
  address?: {
    city?: string;
    state?: string;
    town?: string;
    village?: string;
  };
};

type GooglePlace = {
  displayName?: {
    text?: string;
  };
  formattedAddress?: string;
  id: string;
  location?: {
    latitude?: number;
    longitude?: number;
  };
};

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const SEARCH_RADII_METERS = [12000];
const PROVINCE_CODES: Record<string, string> = {
  Alberta: "ab",
  "British Columbia": "bc",
  Manitoba: "mb",
  "New Brunswick": "nb",
  "Newfoundland and Labrador": "nl",
  "Nova Scotia": "ns",
  Ontario: "on",
  "Prince Edward Island": "pe",
  Quebec: "qc",
  Saskatchewan: "sk",
};

function toRad(value: number) {
  return (value * Math.PI) / 180;
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

function readCoordinate(value: string | null) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildAddress(tags: Record<string, string | undefined> = {}) {
  return [
    [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" "),
    tags["addr:city"],
    tags["addr:state"] || tags["addr:province"],
  ]
    .filter(Boolean)
    .join(", ");
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function decodeHtml(value: string) {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ");
}

function extractAstroValue(block: string, key: string) {
  const match = new RegExp(`"${key}":\\[0,"([^"]*)"\\]`).exec(block);
  return match?.[1];
}

async function reverseGeocode(user: LatLon) {
  const params = new URLSearchParams({
    addressdetails: "1",
    format: "jsonv2",
    lat: String(user.lat),
    lon: String(user.lon),
  });

  const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, {
    headers: {
      "User-Agent": "tim-compass/0.2",
    },
    next: { revalidate: 600 },
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) return null;

  const payload = (await response.json()) as ReverseGeocode;
  const state = payload.address?.state;
  const city = payload.address?.city || payload.address?.town || payload.address?.village;
  if (!city || !state || !PROVINCE_CODES[state]) return null;

  return {
    city,
    provinceCode: PROVINCE_CODES[state],
  };
}

async function findWithGooglePlaces(user: LatLon) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return null;

  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    body: JSON.stringify({
      locationBias: {
        circle: {
          center: {
            latitude: user.lat,
            longitude: user.lon,
          },
          radius: 10000,
        },
      },
      textQuery: "Tim Hortons",
    }),
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location",
    },
    method: "POST",
    signal: AbortSignal.timeout(7000),
  });

  if (!response.ok) return null;

  const payload = (await response.json()) as { places?: GooglePlace[] };
  const candidates = (payload.places ?? [])
    .map((place): TimLocation | null => {
      const lat = place.location?.latitude;
      const lon = place.location?.longitude;
      if (typeof lat !== "number" || typeof lon !== "number") return null;
      const name = place.displayName?.text || "Tim Hortons";
      if (!/tim\s*hortons/i.test(name)) return null;
      const point = { lat, lon };

      return {
        ...point,
        address: place.formattedAddress,
        distance: distanceMeters(user, point),
        id: `google/${place.id}`,
        name,
        source: "google",
      };
    })
    .filter((place): place is TimLocation => place !== null)
    .sort((a, b) => a.distance - b.distance);

  return candidates[0] ?? null;
}

function parseOfficialLocations(html: string, user: LatLon) {
  const decoded = decodeHtml(html);
  const candidates: TimLocation[] = [];
  const locationPattern =
    /"businessAddress":\[0,\{(?<address>.*?)\}\].*?"coordinates":\[0,\{.*?"coordinates":\[1,\[\[0,(?<lon>-?\d+(?:\.\d+)?)\],\[0,(?<lat>-?\d+(?:\.\d+)?)\]\]\]\}/gs;

  for (const match of decoded.matchAll(locationPattern)) {
    const lat = Number(match.groups?.lat);
    const lon = Number(match.groups?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const addressBlock = match.groups?.address || "";
    const street = extractAstroValue(addressBlock, "streetAddress");
    const city = extractAstroValue(addressBlock, "addressLocality");
    const region = extractAstroValue(addressBlock, "addressRegion");
    const postalCode = extractAstroValue(addressBlock, "postalCode");
    const point = { lat, lon };
    const address = [
      street,
      [city, region].filter(Boolean).join(", "),
      postalCode,
    ]
      .filter(Boolean)
      .join(" ");

    candidates.push({
      ...point,
      address,
      distance: distanceMeters(user, point),
      id: `official/${street || lat + "," + lon}`,
      name: "Tim Hortons",
      source: "official",
    });
  }

  const unique = new Map<string, TimLocation>();
  for (const candidate of candidates) {
    unique.set(`${candidate.lat.toFixed(6)},${candidate.lon.toFixed(6)}`, candidate);
  }

  return [...unique.values()].sort((a, b) => a.distance - b.distance);
}

async function findWithOfficialLocator(user: LatLon) {
  const place = await reverseGeocode(user);
  if (!place) return null;

  const url = `https://locations.timhortons.ca/en/locations-list/${place.provinceCode}/${slugify(place.city)}/`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "tim-compass/0.2",
    },
    next: { revalidate: 86400 },
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) return null;

  const candidates = parseOfficialLocations(await response.text(), user);
  return candidates[0] ?? null;
}

function overpassQuery({ lat, lon }: LatLon, radius: number) {
  return `
    [out:json][timeout:25];
    (
      nwr(around:${radius},${lat},${lon})["name"~"Tim[[:space:]]*Hortons",i];
      nwr(around:${radius},${lat},${lon})["brand"~"Tim[[:space:]]*Hortons",i];
      nwr(around:${radius},${lat},${lon})["brand:wikidata"="Q1751066"];
      nwr(around:${radius},${lat},${lon})["operator"~"Tim[[:space:]]*Hortons",i];
    );
    out center tags 80;
  `;
}

function normalizeCandidate(user: LatLon, item: OverpassElement): TimLocation | null {
  const lat = item.lat ?? item.center?.lat;
  const lon = item.lon ?? item.center?.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const point = { lat, lon } as LatLon;

  const candidate = {
    ...point,
    address: buildAddress(item.tags),
    id: `${item.type}/${item.id}`,
    name: item.tags?.name || item.tags?.brand || "Tim Hortons",
    source: "overpass" as const,
  };

  return {
    ...candidate,
    distance: distanceMeters(user, point),
  };
}

async function findWithNominatim(user: LatLon) {
  const span = 0.18;
  const params = new URLSearchParams({
    bounded: "1",
    format: "jsonv2",
    limit: "20",
    q: "Tim Hortons",
    viewbox: [
      user.lon - span,
      user.lat + span,
      user.lon + span,
      user.lat - span,
    ].join(","),
  });

  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: {
      "User-Agent": "tim-compass/0.2",
    },
    next: { revalidate: 300 },
    signal: AbortSignal.timeout(7000),
  });

  if (!response.ok) {
    throw new Error(`Nominatim failed with ${response.status}`);
  }

  const payload = (await response.json()) as NominatimPlace[];
  const candidates = payload
    .map((place): TimLocation | null => {
      const lat = Number(place.lat);
      const lon = Number(place.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const point = { lat, lon };

      return {
        ...point,
        address: place.display_name,
        distance: distanceMeters(user, point),
        id: `${place.osm_type}/${place.osm_id}`,
        name: "Tim Hortons",
        source: "nominatim",
      };
    })
    .filter((place): place is TimLocation => place !== null)
    .sort((a, b) => a.distance - b.distance);

  return candidates[0] ?? null;
}

async function findWithOverpass(user: LatLon) {
  let lastError: unknown;

  for (const radius of SEARCH_RADII_METERS) {
    const body = new URLSearchParams({ data: overpassQuery(user, radius) });
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const response = await fetch(endpoint, {
          body,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            "User-Agent": "tim-compass/0.2",
          },
          method: "POST",
          next: { revalidate: 300 },
          signal: AbortSignal.timeout(5000),
        });

        if (!response.ok) {
          throw new Error(`Overpass failed with ${response.status}`);
        }

        const payload = (await response.json()) as { elements?: OverpassElement[] };
        const candidates = (payload.elements ?? [])
          .map((item) => normalizeCandidate(user, item))
          .filter((item): item is TimLocation => item !== null)
          .sort((a, b) => a.distance - b.distance);

        if (candidates.length > 0) {
          return candidates[0];
        }
      } catch (error) {
        lastError = error;
      }
    }
  }

  console.error(lastError);
  return null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const lat = readCoordinate(url.searchParams.get("lat"));
  const lon = readCoordinate(url.searchParams.get("lon"));

  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return NextResponse.json({ error: "Valid lat and lon query parameters are required." }, { status: 400 });
  }

  try {
    const user = { lat, lon };
    const location =
      (await findWithGooglePlaces(user)) ??
      (await findWithOfficialLocator(user)) ??
      (await findWithOverpass(user)) ??
      (await findWithNominatim(user));
    if (!location) {
      return NextResponse.json({ error: "Unable to find a nearby Tim Hortons." }, { status: 502 });
    }
    return NextResponse.json({ location });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to find a nearby Tim Hortons.",
      },
      { status: 502 },
    );
  }
}
