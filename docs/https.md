# HTTPS

HA Light Panel works well over plain HTTP on a trusted LAN:

```text
http://192.168.1.20:8890/
```

For many Android frames and old WebViews, this is the most reliable setup. Use a static IP or DHCP reservation for the server, because `.local` mDNS names may not resolve inside Android WebView even when they work from a desktop browser.

## When HTTPS Matters

Use HTTPS when:

- You expose the panel outside your LAN.
- You put it behind a remote reverse proxy.
- You want browser microphone access for push-to-talk.
- You need modern browser APIs that require a secure context.

Microphone capture through `navigator.mediaDevices.getUserMedia()` generally requires HTTPS, `localhost`, or another browser-trusted secure origin. A wall tablet pointed at `http://192.168.x.x` should not be expected to grant microphone access consistently.

## Avoid Self-Signed Cert Surprises

Self-signed HTTPS can be worse than HTTP on Android frames:

- Old WebViews may reject private CAs.
- Some kiosk apps do not expose certificate exception screens.
- User-installed CAs may not be trusted by apps on newer Android versions.

If HTTPS is only for a LAN wall panel and not for microphone or remote access, HTTP is often the better tradeoff.

## Recommended HTTPS Shape

Use a real domain and a trusted certificate:

```text
https://panel.example.com/
```

Good options:

- Caddy reverse proxy with a public DNS name.
- DNS-01 ACME challenge if the service is LAN-only.
- Split-horizon DNS so `panel.example.com` resolves to the HA server's local IP at home.

Example Caddyfile:

```caddyfile
panel.example.com {
  reverse_proxy 127.0.0.1:8890
}
```

If the panel must stay LAN-only and your DNS provider supports API tokens, configure Caddy's DNS challenge plugin for your provider. That lets Caddy get a trusted certificate without exposing the panel to the internet.

## Home Assistant URL

When HA Light Panel runs on the same box as Home Assistant, point the backend URL at localhost:

```sh
HA_URL=http://127.0.0.1:8123
```

The browser-facing URL can still be local-network friendly:

```sh
HA_BROWSER_URL=http://192.168.1.20:8123
```

For HTTPS deployments:

```sh
HA_BROWSER_URL=https://ha.example.com
```

## Practical Recommendation

Start with HTTP on LAN:

```text
http://SERVER_IP:8890/
```

Move to HTTPS later if you add microphone push-to-talk, remote access, or a proper trusted domain.
