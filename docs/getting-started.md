# Getting Started

A first panel in about ten minutes. You need Home Assistant and a couple of
temperature sensors — everything else is optional.

## 0. See it first (optional)

```sh
npm run demo
```

Opens the panel at `http://127.0.0.1:8890/` against a built-in fake Home
Assistant. No token, no configuration, nothing touching your real setup. Useful
for deciding whether you want it before doing any work.

`npm run demo:ha` starts only the fake Home Assistant, on port 8123, if you want
to point a separately-running panel at it.

## 1. Get a token

In Home Assistant, click your username in the sidebar, scroll to
**Long-Lived Access Tokens**, and click **Create Token**. Copy it somewhere
safe; Home Assistant only shows it once.

The token goes in an environment variable, never in the config file.

## 2. Find your entity ids

Go to **Developer tools → States** and search for your sensors. An entity id
looks like `sensor.living_room_temperature`. Note down:

- one or two room temperature sensors
- their humidity sensors, if they have them
- your thermostat, if you have one (`climate.something`)

That is enough for a working panel.

## 3. Start from the starter config

[examples/starter.json](../examples/starter.json) is a small, commented config
with three room cards and nothing else switched on:

```sh
cp examples/starter.json config.json
```

Open it and replace each example entity id with one of yours. Delete any room
you do not have a sensor for. The file allows `//` comments, so the notes in it
are safe to keep.

> The other example, [examples/frameo-climate.json](../examples/frameo-climate.json),
> is the opposite end: every feature switched on at once. Use it as a key
> reference, not as a starting point.

## 4. Run it

```sh
cp .env.example .env      # then set HA_URL and HA_TOKEN
npm run validate
npm start
```

Open `http://localhost:8890/`.

`npm run validate` catches JSON mistakes before you start. It does not check
that your entity ids exist — that is the next step.

## 5. Read the panel

If a card shows `--`, the panel reached Home Assistant but that entity returned
nothing. Usually a typo in the entity id, or a sensor that is genuinely
unavailable.

Two places to look:

- `http://localhost:8890/health` — reports the last poll and the last error.
  `{"ok":true}` means Home Assistant is answering.
- the startup log — it prints which config file it loaded, or that it fell back
  to built-in defaults, which is what you see if `CONFIG_PATH` points somewhere
  that does not exist.

## 6. Add the rest

Once rooms render, uncomment the optional blocks in your config one at a time:

| Block | What it adds |
|---|---|
| `panel.comfort` | Target temperature range card |
| `panel.mode` | Heating / Cooling / Comfort OK headline |
| `panel.actions` | Buttons that call your scripts |
| `panel.statusPanel` | Side widget for a wearable or similar |
| `panel.safetyPanel` | Smoke and CO strip |
| `cameras` | Camera snapshot grid |

Full key reference: [configuration guide](configuration.md).

## Common first-run problems

**Everything shows `--`.** The token is wrong or missing. Check `/health` — a
401 from Home Assistant shows up there.

**Panel shows rooms I did not configure.** `CONFIG_PATH` is not pointing at your
file, so the built-in reference layout is being used. The startup log says which
file it loaded.

**`.local` address does not resolve.** Common on Android WebViews and some
kiosk browsers. Use the numeric IP instead, for both `HA_URL` and the panel URL.

**Live view or clips do nothing.** Those need the separate
[Blink Liveview Proxy](https://github.com/Teethree89/ha-blink-live-view-proxy).
Snapshots, rooms, and climate do not.

## Running it for real

Once it works, pick a deployment:

- **Home Assistant OS** — the [add-on](../addon/DOCS.md), easiest if you run HAOS
- **Docker** — `docker-compose.example.yml`
- **systemd** — `scripts/install-systemd.sh` on a Debian-style host

Then point a display at it: see the
[Frameo / Fully Kiosk guide](frameo-fully-kiosk.md).

## Appendix: what the panel needs from Home Assistant

The panel is a read-mostly REST client. It uses two endpoints:

| Call | Purpose |
|---|---|
| `GET /api/states` | Polled every `POLL_MS`; returns every entity, filtered locally to the ones your config names |
| `POST /api/services/<domain>/<service>` | Fired when you press a button or toggle motion |

It also fetches `entity_picture` URLs for camera snapshots, and proxies
`/api/blink_liveview_proxy/...` when the Blink proxy is installed.

That is the whole contract, which is why `scripts/demo-server.js` can stand in
for Home Assistant in about a hundred lines with no dependencies. If you are
debugging a connection problem, `GET /api/states` with your token is the single
thing to verify:

```sh
curl -H "Authorization: Bearer $HA_TOKEN" http://homeassistant.local:8123/api/states | head -c 400
```

A `401` means the token is wrong. Connection refused means `HA_URL` is wrong.

## Portrait and phone screens

The panel's native layout is a 1280x800 landscape canvas, which is what a photo
frame or wall tablet gives you. On a portrait screen it reflows rather than
shrinking to fit: status cards become a 2x2 grid, room cards stack full-width,
buttons stack, and the page scrolls. Rotating back restores the landscape layout
exactly.

Nothing to configure — it keys off `@media (max-aspect-ratio: 1 / 1)`.
