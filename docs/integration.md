# Home Assistant Integration

The panel is a separate Node service on its own port. That is fine on the LAN,
but it means the panel is not reachable through anything that only tunnels
Home Assistant core — Nabu Casa Cloud, a single reverse-proxied hostname, or a
VPN rule that only allows port 8123.

The `ha_light_panel` integration closes that gap. It registers one view inside
Home Assistant that reverse-proxies the panel at `/api/ha_light_panel/`, so the
panel is reachable exactly wherever Home Assistant itself is.

It also sends the panel an `X-Ingress-Path` header naming that prefix. The
panel rewrites its own links and fetches to stay underneath it, so a single
relative link works both on the LAN and remotely.

## Install with HACS

1. In Home Assistant, open **HACS**.
2. Click ⋮ → **Custom repositories**.
3. Add `https://github.com/Teethree89/ha-light-panel` with type **Integration**.
4. Find **HA Light Panel** in the HACS list, click **Download**.
5. Restart Home Assistant.
6. Go to **Settings → Devices & Services → Add Integration**, search for
   **HA Light Panel**, and enter where the panel is listening
   (`http://127.0.0.1:8890` when it runs under systemd on the same host).

The panel is then at `https://<your-ha>/api/ha_light_panel/`.

## Install manually

Copy `custom_components/ha_light_panel/` into your Home Assistant config
directory and restart, then add the integration as in step 6 above.

## YAML

The integration is set up from the UI, but a YAML block is imported once on
startup and then managed like any other entry:

```yaml
ha_light_panel:
  upstream: http://127.0.0.1:8890
```

## Notes

- The view is unauthenticated, matching the panel itself. Anything the panel
  can show is reachable at that path by anyone who can reach Home Assistant, so
  do not expose it more widely than you would the panel.
- Home Assistant has no API for unregistering an HTTP view, so removing the
  integration takes effect on the next restart.
- Only one entry is allowed; a second would register the same view again.
