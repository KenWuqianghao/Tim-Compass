# Tim Compass

A minimal mobile web app that points toward the nearest Tim Hortons and celebrates on arrival.

## Run

```bash
npm install
npm run dev
```

Open the local URL on a phone. Location and compass sensors require a secure context; `localhost` works for desktop testing, while phones usually need HTTPS or a local tunneling setup.

## Notes

- To match Google Maps results, set `GOOGLE_PLACES_API_KEY` with a Google Places API (New) key. The app keeps the key server-side in the Next.js API route.
- Nearby Tim Hortons locations are loaded by a Next.js API route from OpenStreetMap through Overpass.
- If no Google key is configured, the API falls back to official Tim Hortons pages when coordinates are available, then OpenStreetMap sources.
- Compass heading is smoothed to reduce sensor jitter while rotating.
- The arrival animation triggers within 75 meters.
- The Demo button exercises the compass and celebration without GPS.
