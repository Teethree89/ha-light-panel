# Security

HA Light Panel uses a Home Assistant long-lived access token. Treat it like a password.

Recommended:

- Run only on a trusted LAN.
- Store the token in an environment file, not in Git.
- Keep `.env`, `config.json`, and systemd env files private.
- Use HTTPS and authentication before exposing this outside your home network.
- Create a dedicated Home Assistant user/token if possible.

Not recommended:

- Do not expose this service directly to the public internet.
- Do not commit real tokens.
- Do not put it behind an unauthenticated public reverse proxy.
