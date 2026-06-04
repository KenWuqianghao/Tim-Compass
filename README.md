# Tim Compass

A minimal mobile web app that points toward the nearest Tim Hortons and celebrates on arrival.

## Run

```bash
npm install
npm run dev
```

To refresh the bundled Tim Hortons dataset:

```bash
npm run data:tim
```

Open the local URL on a phone. Location and compass sensors require a secure context; `localhost` works for desktop testing, while phones usually need HTTPS or a local tunneling setup.

## Notes

- Nearby Tim Hortons locations are loaded from a bundled dataset generated from official Tim Hortons location pages.
- OpenStreetMap sources are only used as a fallback if the bundled dataset cannot produce a match.
- Compass heading is smoothed to reduce sensor jitter while rotating.
- The arrival animation triggers within 25 meters when GPS accuracy is reasonable.
