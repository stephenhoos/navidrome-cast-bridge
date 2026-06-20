# Navidrome Cast Bridge

This project includes a real Navidrome `.ndp` plugin and a companion bridge service for casting Navidrome tracks to Google Cast / Nest speakers.

The `.ndp` plugin runs inside Navidrome and forwards playback reports to the bridge. The bridge runs next to Navidrome, discovers Cast devices on the LAN, uses the Subsonic API to stream media, then tells a Cast receiver to play the proxied stream URL.

Google Cast itself cannot be implemented entirely inside a Navidrome plugin because Navidrome plugins run in a WebAssembly sandbox and do not get raw LAN discovery or CastV2 socket control.

## Status

Early release. The bridge can:

- install as a real Navidrome `.ndp` plugin
- discover Google Cast receivers on the LAN
- search Navidrome through the Subsonic API
- proxy Navidrome audio streams to Cast receivers
- load tracks into the default Cast media receiver
- send basic `play`, `pause`, and `stop` commands

It does not currently add controls inside the Navidrome web UI.

## Bridge UI

Open the bridge UI:

```text
http://192.168.1.6:4545/
```

The bridge UI provides:

- Cast on/off toggle
- Cast device picker
- latest playback event received from the Navidrome plugin
- latest track cast by the bridge
- Navidrome search and manual cast controls
- play, pause, and stop controls

The Navidrome plugin can forward playback events continuously while this UI controls whether those events are mirrored to the selected Cast device.

Navidrome's plugin API does not currently expose a web-player UI injection point, so the plugin cannot add a native Cast icon next to Now Playing without modifying Navidrome's frontend itself.

## Plugin

Build the Navidrome plugin package:

```sh
npm run plugin:package
```

That creates:

```text
dist/navidrome-cast-bridge.ndp
```

Install it by copying the `.ndp` file into your Navidrome plugin folder, then restart Navidrome. For Docker installs where `/data/plugins` is mounted from the host:

```sh
cp dist/navidrome-cast-bridge.ndp /path/to/navidrome/data/plugins/
docker compose restart navidrome
```

In Navidrome, configure the plugin:

```text
bridge_url = http://host.docker.internal:4545
cast_device = All My Speakers
auto_cast = false
```

Set `auto_cast` to `true` only if you want Navidrome playback reports mirrored automatically to the configured Cast device.

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
