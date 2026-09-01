#!/usr/bin/env python3
"""Blink re-auth orchestrator for HA Light Panel.

Runs as root, triggered by the blink-reauth.path systemd unit. Automates the
OAuth v2 + SMS-2FA login that HA's blinkpy cannot complete on its own:

  start           disable the blink config entry, run the OAuth signin
                  (Blink texts an SMS code), stash session state in the container
  verify CODE     submit the SMS code, mint tokens, install them into the config
                  entry (stop/edit/start HA), re-enable the entry
  cancel          re-enable the blink entry without changing tokens
  status          print the current status JSON
  process-request consume /var/spool/blink-reauth/request.json and dispatch to
                  one of the above (used by the blink-reauth.path systemd unit;
                  the hardened panel service cannot sudo, so it spools requests)

Progress is written to /run/blink-reauth/status.json so the panel can poll it.
Network/OAuth steps run inside the homeassistant container (blinkpy + aiohttp
live there); this host-side script orchestrates and does the privileged parts.
"""
import json
import os
import subprocess
import sys
import time
import urllib.request
import uuid

# Deployment paths. Every one can be overridden from the environment so this
# script is not tied to one host's layout; the defaults match a Home Assistant
# Container install with the panel running from systemd.
ENV_FILE = os.environ.get("PANEL_ENV_FILE", "/etc/ha-light-panel.env")
STATUS_DIR = os.environ.get("BLINK_REAUTH_STATUS_DIR", "/run/blink-reauth")
STATUS_FILE = os.path.join(STATUS_DIR, "status.json")
SPOOL_FILE = os.environ.get("BLINK_REAUTH_SPOOL", "/var/spool/blink-reauth/request.json")
HA_CONFIG_DIR = os.environ.get("HA_CONFIG_DIR", "/opt/homeassistant")
ENTRIES_FILE = os.path.join(HA_CONFIG_DIR, ".storage", "core.config_entries")
BOOTSTRAP_HOST = os.path.join(HA_CONFIG_DIR, "blink_token_bootstrap.json")
HA_URL = os.environ.get("HA_URL", "http://127.0.0.1:8123")
CONTAINER = os.environ.get("HA_CONTAINER", "homeassistant")

PHASE1_PY = r'''
import asyncio, aiohttp, json, hashlib, base64, os, pickle
from blinkpy.helpers import constants as const
from blinkpy.api import OAuthArgsParser

HA_TOKEN = os.environ["HA_TOKEN"]
STATE_PATH = "/tmp/blink_oauth_state.pickle"
entries = json.load(open("/config/.storage/core.config_entries"))["data"]["entries"]
entry = [e for e in entries if e["domain"] == "blink"][0]
d = entry["data"]
UA = const.OAUTH_USER_AGENT
PAGE_HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

async def set_entry_disabled(session, disabled_by):
    async with session.ws_connect("ws://127.0.0.1:8123/api/websocket") as ws:
        await ws.receive_json()
        await ws.send_json({"type": "auth", "access_token": HA_TOKEN})
        await ws.receive_json()
        await ws.send_json({"id": 1, "type": "config_entries/disable",
                            "entry_id": entry["entry_id"], "disabled_by": disabled_by})
        return await ws.receive_json()

async def main():
    async with aiohttp.ClientSession() as ha:
        await set_entry_disabled(ha, "user")
    await asyncio.sleep(3)

    verifier = base64.urlsafe_b64encode(os.urandom(32)).rstrip(b"=").decode()
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    jar = aiohttp.CookieJar()
    async with aiohttp.ClientSession(cookie_jar=jar) as s:
        r1 = await s.get(const.OAUTH_AUTHORIZE_URL, params={
            "app_brand": "blink", "app_version": "50.1",
            "client_id": const.OAUTH_V2_CLIENT_ID,
            "code_challenge": challenge, "code_challenge_method": "S256",
            "device_brand": "Apple", "device_model": "iPhone16,1",
            "device_os_version": "26.1", "hardware_id": d["hardware_id"],
            "redirect_uri": const.OAUTH_REDIRECT_URI,
            "response_type": "code", "scope": const.OAUTH_SCOPE,
        }, headers=PAGE_HEADERS)
        if r1.status != 200:
            print("RESULT " + json.dumps({"ok": False, "error": "authorize failed (HTTP %d)" % r1.status}))
            return
        r2 = await s.get(const.OAUTH_SIGNIN_URL, headers=PAGE_HEADERS)
        parser = OAuthArgsParser()
        parser.feed(await r2.text())
        if r2.status != 200 or not parser.csrf_token:
            print("RESULT " + json.dumps({"ok": False, "error": "signin page failed (HTTP %d)" % r2.status}))
            return
        r3 = await s.post(const.OAUTH_SIGNIN_URL, headers={
            "User-Agent": UA, "Accept": "*/*",
            "Content-Type": "application/x-www-form-urlencoded",
            "Origin": "https://api.oauth.blink.com",
            "Referer": const.OAUTH_SIGNIN_URL,
        }, data={"username": d["username"], "password": d["password"],
                 "csrf-token": parser.csrf_token}, allow_redirects=False)
        body = await r3.text()
        if r3.status == 429:
            try:
                wait = json.loads(body).get("next_time_in_secs", 600)
            except Exception:
                wait = 600
            print("RESULT " + json.dumps({"ok": False, "rate_limited": True,
                  "error": "Blink rate limit; retry in %d min" % (int(wait) // 60 or 1)}))
            return
        if r3.status not in (202, 412):
            print("RESULT " + json.dumps({"ok": False, "error": "signin failed (HTTP %d)" % r3.status}))
            return
        phone = ""
        try:
            phone = json.loads(body).get("phone", "")
        except Exception:
            pass
        jar.save(STATE_PATH + ".jar")
        with open(STATE_PATH, "wb") as f:
            pickle.dump({"csrf": parser.csrf_token, "verifier": verifier,
                         "hardware_id": d["hardware_id"]}, f)
        print("RESULT " + json.dumps({"ok": True, "phone": phone}))

asyncio.run(main())
'''

PHASE2_PY = r'''
import asyncio, aiohttp, json, os, pickle, time
from blinkpy.helpers import constants as const

CODE = os.environ["BLINK_2FA_CODE"]
STATE_PATH = "/tmp/blink_oauth_state.pickle"
OUT_PATH = "/config/blink_token_bootstrap.json"
with open(STATE_PATH, "rb") as f:
    state = pickle.load(f)
UA = const.OAUTH_USER_AGENT

async def main():
    jar = aiohttp.CookieJar()
    jar.load(STATE_PATH + ".jar")
    async with aiohttp.ClientSession(cookie_jar=jar) as s:
        r1 = await s.post(const.OAUTH_2FA_VERIFY_URL, headers={
            "User-Agent": UA, "Accept": "*/*",
            "Content-Type": "application/x-www-form-urlencoded",
            "Origin": "https://api.oauth.blink.com",
            "Referer": const.OAUTH_SIGNIN_URL,
        }, data={"2fa_code": CODE, "csrf-token": state["csrf"],
                 "remember_me": "false"})
        if r1.status != 201:
            print("RESULT " + json.dumps({"ok": False, "error": "SMS code rejected (HTTP %d)" % r1.status}))
            return
        r2 = await s.get(const.OAUTH_AUTHORIZE_URL, headers={
            "User-Agent": UA, "Accept": "*/*", "Referer": const.OAUTH_SIGNIN_URL,
        }, allow_redirects=False)
        from urllib.parse import urlparse, parse_qs
        code = parse_qs(urlparse(r2.headers.get("Location", "")).query).get("code", [None])[0]
        if not code:
            print("RESULT " + json.dumps({"ok": False, "error": "no authorization code (HTTP %d)" % r2.status}))
            return
        r3 = await s.post(const.OAUTH_TOKEN_URL, headers={
            "User-Agent": const.OAUTH_TOKEN_USER_AGENT,
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "*/*",
        }, data={
            "app_brand": "blink", "client_id": const.OAUTH_V2_CLIENT_ID,
            "code": code, "code_verifier": state["verifier"],
            "grant_type": "authorization_code",
            "hardware_id": state["hardware_id"],
            "redirect_uri": const.OAUTH_REDIRECT_URI,
            "scope": const.OAUTH_SCOPE,
        })
        if r3.status != 200:
            print("RESULT " + json.dumps({"ok": False, "error": "token exchange failed (HTTP %d)" % r3.status}))
            return
        token_data = await r3.json()
        out = {
            "token": token_data.get("access_token"),
            "refresh_token": token_data.get("refresh_token"),
            "expires_in": token_data.get("expires_in", 3600),
            "expiration_date": time.time() + token_data.get("expires_in", 3600),
        }
        with open(OUT_PATH, "w") as f:
            json.dump(out, f)
        os.chmod(OUT_PATH, 0o600)
        os.remove(STATE_PATH)
        os.remove(STATE_PATH + ".jar")
        print("RESULT " + json.dumps({"ok": True}))

asyncio.run(main())
'''

ENABLE_PY = r'''
import asyncio, aiohttp, json, os
HA_TOKEN = os.environ["HA_TOKEN"]
entries = json.load(open("/config/.storage/core.config_entries"))["data"]["entries"]
entry_id = [e for e in entries if e["domain"] == "blink"][0]["entry_id"]
async def main():
    async with aiohttp.ClientSession() as s:
        async with s.ws_connect("ws://127.0.0.1:8123/api/websocket") as ws:
            await ws.receive_json()
            await ws.send_json({"type": "auth", "access_token": HA_TOKEN})
            await ws.receive_json()
            await ws.send_json({"id": 1, "type": "config_entries/disable",
                                "entry_id": entry_id, "disabled_by": None})
            r = await ws.receive_json()
            print("RESULT " + json.dumps({"ok": bool(r.get("success"))}))
asyncio.run(main())
'''


def ha_token():
    with open(ENV_FILE) as f:
        for line in f:
            if line.startswith("HA_TOKEN="):
                return line.split("=", 1)[1].strip()
    raise RuntimeError("HA_TOKEN not found in " + ENV_FILE)


def set_status(step, **extra):
    os.makedirs(STATUS_DIR, mode=0o755, exist_ok=True)
    payload = {"step": step, "updated": time.time(), **extra}
    with open(STATUS_FILE, "w") as f:
        json.dump(payload, f)
    os.chmod(STATUS_FILE, 0o644)
    return payload


def get_status():
    try:
        with open(STATUS_FILE) as f:
            return json.load(f)
    except Exception:
        return {"step": "idle"}


def docker_py(script, env=None):
    cmd = ["docker", "exec", "-i"]
    for key, value in (env or {}).items():
        cmd += ["-e", f"{key}={value}"]
    cmd += [CONTAINER, "python3", "-"]
    proc = subprocess.run(cmd, input=script, capture_output=True, text=True, timeout=120)
    for line in (proc.stdout or "").splitlines():
        if line.startswith("RESULT "):
            return json.loads(line[len("RESULT "):])
    return {"ok": False, "error": (proc.stderr or proc.stdout or "no output").strip()[-300:]}


def ha_api(path, timeout=8):
    req = urllib.request.Request(HA_URL + path, headers={
        "Authorization": "Bearer " + ha_token()})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.status, json.loads(resp.read().decode())


def wait_for_ha(timeout=240):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            status, _ = ha_api("/api/")
            if status == 200:
                return True
        except Exception:
            pass
        time.sleep(5)
    return False


def blink_entry_state():
    _, entries = ha_api("/api/config/config_entries/entry")
    for e in entries:
        if e.get("domain") == "blink":
            return e.get("state")
    return "missing"


def busy():
    status = get_status()
    active = status.get("step") in ("starting", "verifying", "installing_tokens", "enabling")
    return active and time.time() - status.get("updated", 0) < 300


def is_uuid(value):
    try:
        uuid.UUID(str(value))
        return True
    except (ValueError, AttributeError, TypeError):
        return False


def ensure_hardware_id():
    """Guarantee the entry's hardware_id is a UUID before signing in.

    Blink fronts /oauth/v2/authorize with Cloudflare, which rejects a
    non-UUID hardware_id with a bare HTTP 406 before the request reaches the
    app. A stored value like "Home Assistant" therefore makes every re-auth
    fail with no usable error, and no amount of waiting or retrying helps
    (verified 2026-08-19: that value 406s while fresh UUIDs get 302). Repair
    it in place with the same stop/edit/start dance the token install uses.
    """
    with open(ENTRIES_FILE) as f:
        doc = json.load(f)
    entry = next(e for e in doc["data"]["entries"] if e["domain"] == "blink")
    current = entry["data"].get("hardware_id")
    if is_uuid(current):
        return {"ok": True, "changed": False, "hardware_id": current}

    new_id = str(uuid.uuid4())
    subprocess.run(["docker", "stop", CONTAINER], check=True, capture_output=True)
    try:
        subprocess.run(["cp", ENTRIES_FILE, ENTRIES_FILE + ".bak-hardware-id"], check=True)
        with open(ENTRIES_FILE) as f:
            doc = json.load(f)
        for e in doc["data"]["entries"]:
            if e["domain"] == "blink":
                e["data"]["hardware_id"] = new_id
        with open(ENTRIES_FILE, "w") as f:
            json.dump(doc, f, indent=2)
    finally:
        subprocess.run(["docker", "start", CONTAINER], check=True, capture_output=True)

    if not wait_for_ha():
        return {"ok": False, "error": "Home Assistant did not come back after hardware_id repair"}
    return {"ok": True, "changed": True, "hardware_id": new_id, "previous": current}


def tokens_look_valid():
    """Whether the entry actually holds credentials worth loading."""
    try:
        with open(ENTRIES_FILE) as f:
            doc = json.load(f)
        entry = next(e for e in doc["data"]["entries"] if e["domain"] == "blink")
    except Exception:
        return False
    data = entry.get("data", {})
    for key in ("token", "refresh_token"):
        value = data.get(key)
        if not isinstance(value, str) or len(value) < 32:
            return False
        if value.strip().lower() in ("none", "null", ""):
            return False
    return True


def enable_entry_if_safe():
    """Re-enable the blink entry, but only once credentials are real.

    Enabling an entry with junk tokens is not merely useless: blinkpy retries
    the password grant on HA's setup_retry backoff, and Blink texts a fresh
    2FA code for *every* one of those attempts. A cancelled or failed re-auth
    used to re-enable unconditionally, which turned a mistimed cancel into an
    SMS flood (observed 2026-08-19). So leave it disabled unless the tokens
    are real - a disabled entry is quiet, and re-auth works while disabled.
    """
    if not tokens_look_valid():
        return {"ok": True, "enabled": False,
                "reason": "tokens missing or invalid; entry left disabled to avoid a 2FA SMS retry loop"}
    result = docker_py(ENABLE_PY, env={"HA_TOKEN": ha_token()})
    return {**result, "enabled": bool(result.get("ok"))}


def cmd_start():
    if busy():
        print(json.dumps({"ok": False, "error": "re-auth already in progress"}))
        return
    set_status("starting")
    repair = ensure_hardware_id()
    if not repair.get("ok"):
        set_status("error", error=repair.get("error", "hardware_id repair failed"))
        print(json.dumps(repair))
        return
    result = docker_py(PHASE1_PY, env={"HA_TOKEN": ha_token()})
    if result.get("ok"):
        set_status("awaiting_code", phone=result.get("phone", ""))
    else:
        set_status("error", error=result.get("error", "start failed"))
        enable_entry_if_safe()
    print(json.dumps({**result}))


def cmd_verify(code):
    if get_status().get("step") != "awaiting_code":
        print(json.dumps({"ok": False, "error": "no re-auth in progress"}))
        return
    set_status("verifying")
    result = docker_py(PHASE2_PY, env={"BLINK_2FA_CODE": code})
    if not result.get("ok"):
        set_status("error", error=result.get("error", "verify failed"))
        enable_entry_if_safe()
        print(json.dumps(result))
        return

    set_status("installing_tokens")
    subprocess.run(["docker", "stop", CONTAINER], check=True, capture_output=True)
    try:
        backup = ENTRIES_FILE + ".bak-blink-reauth"
        subprocess.run(["cp", ENTRIES_FILE, backup], check=True)
        with open(BOOTSTRAP_HOST) as f:
            tokens = json.load(f)
        with open(ENTRIES_FILE) as f:
            doc = json.load(f)
        for e in doc["data"]["entries"]:
            if e["domain"] == "blink":
                e["data"].update(tokens)
        with open(ENTRIES_FILE, "w") as f:
            json.dump(doc, f, indent=2)
        os.remove(BOOTSTRAP_HOST)
    finally:
        subprocess.run(["docker", "start", CONTAINER], check=True, capture_output=True)

    if not wait_for_ha():
        set_status("error", error="Home Assistant did not come back after restart")
        return

    set_status("enabling")
    enable_entry_if_safe()
    deadline = time.time() + 120
    while time.time() < deadline:
        try:
            state = blink_entry_state()
            if state == "loaded":
                set_status("done")
                print(json.dumps({"ok": True}))
                return
        except Exception:
            pass
        time.sleep(5)
    set_status("error", error="Blink entry did not reach loaded state (check HA logs)")
    print(json.dumps({"ok": False, "error": "entry not loaded"}))


def cmd_cancel():
    enabled = enable_entry_if_safe()
    status = set_status("cancelled")
    print(json.dumps({"ok": True, **status, "entry_enabled": enabled.get("enabled", False),
                      "entry_note": enabled.get("reason", "")}))


REQUEST_FILE = SPOOL_FILE


def cmd_process_request():
    try:
        with open(REQUEST_FILE) as f:
            req = json.load(f)
        os.remove(REQUEST_FILE)
    except FileNotFoundError:
        return
    action = req.get("action")
    if action == "start":
        cmd_start()
    elif action == "verify":
        code = str(req.get("code", ""))
        if code.isdigit() and 4 <= len(code) <= 8:
            cmd_verify(code)
        else:
            set_status("error", error="invalid code")
    elif action == "cancel":
        cmd_cancel()


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else "status"
    if action == "start":
        cmd_start()
    elif action == "verify":
        code = sys.argv[2] if len(sys.argv) > 2 else ""
        if not code.isdigit() or not 4 <= len(code) <= 8:
            print(json.dumps({"ok": False, "error": "invalid code"}))
            return
        cmd_verify(code)
    elif action == "cancel":
        cmd_cancel()
    elif action == "process-request":
        cmd_process_request()
    else:
        print(json.dumps(get_status()))


if __name__ == "__main__":
    main()
