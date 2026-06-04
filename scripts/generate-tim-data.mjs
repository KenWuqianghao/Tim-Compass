import fs from "node:fs/promises";

const BASE_URL = "https://locations.timhortons.ca";
const INDEX_URL = `${BASE_URL}/en/locations-list/`;
const OUT_FILE = new URL("../data/tim-hortons.json", import.meta.url);
const CONCURRENCY = Number(process.env.TIM_CRAWL_CONCURRENCY || 8);
const LIMIT = Number(process.env.TIM_CRAWL_LIMIT || 0);
const USER_AGENT = "tim-compass-location-index/0.1";

function absoluteUrl(href) {
  return new URL(href, BASE_URL).toString();
}

function unique(values) {
  return [...new Set(values)];
}

function extractLinks(html, pattern) {
  return unique(
    [...html.matchAll(/href="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((href) => pattern.test(href))
      .map(absoluteUrl),
  );
}

function normalizeSpace(value) {
  return value.replace(/\s+/g, " ").trim();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) {
    throw new Error(`Failed ${response.status} for ${url}`);
  }

  return response.text();
}

async function mapConcurrent(items, worker, concurrency) {
  const results = [];
  let index = 0;

  async function run() {
    while (index < items.length) {
      const current = items[index];
      index += 1;

      try {
        const result = await worker(current, index, items.length);
        if (result !== null && result !== undefined) {
          results.push(result);
        }
      } catch (error) {
        console.warn(error instanceof Error ? error.message : error);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, run));
  return results;
}

function parseJsonLdLocations(html, url) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
  const locations = [];

  for (const block of blocks) {
    try {
      const raw = block[1]
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&");
      const data = JSON.parse(raw);
      const lat = Number(data.geo?.latitude);
      const lon = Number(data.geo?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      const address = data.address || {};
      locations.push({
        address: normalizeSpace(
          [
            address.streetAddress,
            [address.addressLocality, address.addressRegion].filter(Boolean).join(", "),
            address.postalCode,
          ]
            .filter(Boolean)
            .join(" "),
        ),
        city: address.addressLocality || "",
        country: address.addressCountry?.name || address.addressCountry || "CA",
        id: url.replace(BASE_URL, ""),
        lat,
        lon,
        name: data.name || "Tim Hortons",
        phone: data.telephone || "",
        postalCode: address.postalCode || "",
        province: address.addressRegion || "",
        sourceUrl: url,
        streetAddress: address.streetAddress || "",
      });
    } catch {
      // Some JSON-LD blocks can be unrelated or malformed. Ignore them.
    }
  }

  return locations;
}

async function main() {
  console.log("Fetching province index...");
  const indexHtml = await fetchText(INDEX_URL);
  const provinceUrls = extractLinks(indexHtml, /^\/en\/locations-list\/[a-z]{2}\/$/);
  console.log(`Found ${provinceUrls.length} province/territory pages.`);

  const cityGroups = await mapConcurrent(
    provinceUrls,
    async (url) => {
      const html = await fetchText(url);
      const links = extractLinks(html, /^\/en\/locations-list\/[a-z]{2}\/[^/]+\/$/);
      console.log(`${new URL(url).pathname}: ${links.length} city pages`);
      return links;
    },
    CONCURRENCY,
  );
  const cityUrls = unique(cityGroups.flat());
  console.log(`Found ${cityUrls.length} city pages.`);

  const detailGroups = await mapConcurrent(
    cityUrls,
    async (url, current, total) => {
      const html = await fetchText(url);
      const links = extractLinks(html, /^\/en\/[a-z]{2}\/[^/]+\/[^/]+\/$/);
      if (current % 50 === 0 || current === total) {
        console.log(`Scanned ${current}/${total} city pages; latest had ${links.length} stores`);
      }
      return links;
    },
    CONCURRENCY,
  );
  let detailUrls = unique(detailGroups.flat());
  if (LIMIT > 0) {
    detailUrls = detailUrls.slice(0, LIMIT);
  }
  console.log(`Found ${detailUrls.length} store pages.`);

  const locationGroups = await mapConcurrent(
    detailUrls,
    async (url, current, total) => {
      const html = await fetchText(url);
      const locations = parseJsonLdLocations(html, url);
      if (current % 100 === 0 || current === total) {
        console.log(`Parsed ${current}/${total} store pages.`);
      }
      return locations;
    },
    CONCURRENCY,
  );

  const byCoordinate = new Map();
  for (const location of locationGroups.flat()) {
    byCoordinate.set(`${location.lat.toFixed(7)},${location.lon.toFixed(7)}`, location);
  }

  const generatedAt = new Date().toISOString();
  const locations = [...byCoordinate.values()].sort((a, b) => {
    const province = a.province.localeCompare(b.province);
    if (province !== 0) return province;
    const city = a.city.localeCompare(b.city);
    if (city !== 0) return city;
    return a.streetAddress.localeCompare(b.streetAddress);
  });

  await fs.mkdir(new URL("../data", import.meta.url), { recursive: true });
  await fs.writeFile(
    OUT_FILE,
    `${JSON.stringify(
      {
        generatedAt,
        source: INDEX_URL,
        count: locations.length,
        locations,
      },
      null,
      2,
    )}\n`,
  );

  console.log(`Wrote ${locations.length} locations to ${OUT_FILE.pathname}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
