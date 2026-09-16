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

## Sidebar navigation

After the restart, admins will see **HA Light Panel** in the Home Assistant
sidebar. Its internal navigation provides two pages:

- **Overview** embeds the lightweight panel at `/api/ha_light_panel/`.
- **Builder** embeds the visual SVG panel layout builder at
  `/api/ha_light_panel/builder`.

The Builder is currently **work in progress**: it exports a reviewed panel
configuration for manual installation, not a direct write to the running
service. See the [installation guide](installation.md#visual-builder-status--work-in-progress)
for its current scope and backup guidance.

The sidebar page is authenticated and keeps the regular Home Assistant
navigation available. Its **New tab** button, and the direct ingress URLs,
remain useful when you prefer the panel without the HA chrome.

### First-time connection help

If `/api/ha_light_panel/` already opens the panel, no IP address or discovery
step is needed: the Home Assistant proxy is already configured and the sidebar
uses that working route first.

If the sidebar cannot open the panel, it shows the exact URL Home Assistant is
currently using and a **Connect panel** form. **Find panel address** probes
only safe local candidates (the same host, Home Assistant's configured local
hostname, and a detected HAOS add-on) and lists only services that identify as
**HA Light Panel**. It checks the service before embedding it, so an
unavailable panel produces instructions instead of a blank page.

- **Systemd or Docker on the same host as Home Assistant:** use
  `http://127.0.0.1:8890`.
- **Panel on another machine:** use that machine's LAN hostname or IP, for
  example `http://192.168.1.50:8890`.
- **HA Light Panel add-on on HAOS/Supervised:** the sidebar detects the
  Supervisor-assigned add-on hostname and offers it as a one-click choice when
  the add-on is installed.

Changing an existing upstream address is saved immediately, but requires a
Home Assistant restart because HA cannot replace a registered HTTP proxy route
while it is running.

### Links for other devices

The sidebar's **Device links** page has one-click copy buttons for the panel
overview and builder through the HA proxy. These are the recommended links for
phones, tablets, desktops, and wall displays because they work anywhere that
can reach your Home Assistant instance. It also explains whether the direct
panel address can be used from another device: `127.0.0.1` only works inside
the HA host, while a LAN hostname/IP can be opened directly.

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
