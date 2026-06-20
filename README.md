# Navidrome Cast Bridge

This is a companion service for casting Navidrome tracks to Google Cast / Nest speakers.

It is intentionally not a pure Navidrome `.ndp` plugin. Navidrome plugins run inside a WebAssembly sandbox, while Google Cast needs LAN device discovery and CastV2 socket control. This bridge runs next to Navidrome, uses the Subsonic API to find tracks and stream media, then tells a Cast receiver to play the proxied stream URL.

## Status

Early release. The bridge can:

- discover Google Cast receivers on the LAN
- search Navidrome through the Subsonic API
- proxy Navidrome audio streams to Cast receivers
- load tracks into the default Cast media receiver
- send basic `play`, `pause`, and `stop` commands

It does not currently add controls inside the Navidrome web UI.

## Setup

```sh
npm install
cp .env.example .env
npm start
```

Required settings:

```sh
NAVIDROME_URL=http://navidrome.local:4533
NAVIDROME_USER=your_user
NAVIDROME_PASSWORD=your_password
BRIDGE_PUBLIC_URL=http://192.168.1.20:4545
```

`BRIDGE_PUBLIC_URL` must be reachable by the Nest speaker. Do not use `localhost` unless the speaker is running on the same host, which it is not.

## Docker

Docker can work well on Linux with host networking:

```sh
docker build -t navidrome-cast-bridge .
docker run --rm --network host --env-file .env navidrome-cast-bridge
```

On macOS, run the bridge directly on the host with Node.js. Docker Desktop commonly prevents mDNS/Cast discovery from working correctly inside containers.

## API

List discovered Cast devices:

```sh
curl http://localhost:4545/devices
```

Search Navidrome:

```sh
curl 'http://localhost:4545/search?q=radiohead'
```

Cast a song:

```sh
curl -X POST http://localhost:4545/cast \
  -H 'content-type: application/json' \
  -d '{"device":"Kitchen speaker","songId":"abc123"}'
```

Control playback:

```sh
curl -X POST http://localhost:4545/control \
  -H 'content-type: application/json' \
  -d '{"device":"Kitchen speaker","action":"pause"}'
```

Supported actions: `play`, `pause`, `stop`.

## Notes

- The speaker fetches audio from this bridge, and the bridge fetches from Navidrome.
- Keep this service on your trusted LAN. It does not currently implement user authentication.
- If casting connects but audio does not start, check that `BRIDGE_PUBLIC_URL` is reachable from the speaker and that your Navidrome URL works from this host.
