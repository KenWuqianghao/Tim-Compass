# Tim Compass

A minimal mobile web app that points toward the nearest Tim Hortons and celebrates on arrival.

## Run

```bash
npm install
npm run start
```

Open the local URL on a phone. Location and compass sensors require a secure context; `localhost` works for desktop testing, while phones usually need HTTPS or a local tunneling setup.

## Notes

- Nearby Tim Hortons locations are loaded from OpenStreetMap through Overpass.
- The arrival animation triggers within 75 meters.
- The Demo button exercises the compass and celebration without GPS.
