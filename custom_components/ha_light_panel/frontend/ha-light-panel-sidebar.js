// Thin Home Assistant navigation and setup shell. The panel process continues
// to render the dashboard and visual builder through the ingress proxy.
const PANEL_BASE = "/api/ha_light_panel";

class HaLightPanelSidebar extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._tab = "overview";
    this._hass = null;
    this._status = null;
    this._connection = "checking";
    this._message = "Checking the HA Light Panel connection…";
    this._busy = false;
  }

  set hass(value) { this._hass = value; if (this.isConnected) this._checkPanel(); }
  set narrow(_value) {}
  set panel(_value) {}

  set route(value) {
    const next = value && String(value.path || "").replace(/^\//, "") === "builder" ? "builder" : "overview";
    const changed = next !== this._tab;
    this._tab = next;
    if (changed) this._beginCheck();
    this._render();
    if (changed && this.isConnected) this._checkPanel();
  }

  connectedCallback() { this._render(); this._checkPanel(); }
  _beginCheck() { this._connection = "checking"; this._message = "Checking the HA Light Panel connection…"; }
  _target() { return this._tab === "builder" ? `${PANEL_BASE}/builder` : `${PANEL_BASE}/`; }
  _absolute(path) { return new URL(path, window.location.origin).href; }
  _escape(value) { const node = document.createElement("span"); node.textContent = String(value || ""); return node.innerHTML; }

  async _checkPanel() {
    if (!this._hass || this._busy) return;
    const tab = this._tab;
    this._beginCheck(); this._render();
    try {
      this._status = await this._hass.callApi("GET", "ha_light_panel/sidebar-status");
      if (!this._status.configured) {
        this._connection = "unavailable";
        this._message = "The HA Light Panel integration has not been connected to a panel service yet.";
      } else if (!this._status.reachable) {
        this._connection = "unavailable";
        this._message = this._status.detail || "Home Assistant cannot reach the configured panel service.";
      } else {
        // The proxy route can remain old after an address correction, so check
        // exactly the ingress page that the iframe is about to load.
        const response = await fetch(this._target(), { cache: "no-store" });
        if (!response.ok) throw new Error(`The ingress page responded with ${response.status}`);
        this._connection = "ready";
        this._message = "";
      }
    } catch (_error) {
      this._connection = "unavailable";
      this._message = "The Home Assistant integration is not ready to open this page.";
    }
    if (tab !== this._tab) return;
    this._render();
  }

  async _saveUpstream() {
    const input = this.shadowRoot.querySelector("[data-upstream]");
    const upstream = input ? input.value.trim() : "";
    if (!upstream || !this._hass) return;
    this._busy = true; this._message = "Saving the panel address…"; this._render();
    try {
      const result = await this._hass.callApi("POST", "ha_light_panel/sidebar-status", { upstream });
      if (result.restart_required) {
        this._connection = "unavailable";
        this._message = `Saved ${result.upstream}. Restart Home Assistant to apply the changed address.`;
      } else {
        this._message = `Connected ${result.upstream}. Loading the panel…`;
        this._connection = "checking";
        window.setTimeout(() => this._checkPanel(), 800);
      }
    } catch (error) {
      this._connection = "unavailable";
      this._message = (error && error.body) || "That address could not be saved. Enter a full http:// or https:// URL.";
    } finally { this._busy = false; this._render(); }
  }

  async _findPanels() {
    if (!this._hass || this._busy) return;
    this._busy = true;
    this._message = "Looking for a running HA Light Panel service…";
    this._render();
    try {
      const result = await this._hass.callApi("POST", "ha_light_panel/sidebar-discover", {});
      const panels = result.panels || [];
      this._status = { ...(this._status || {}), candidates: panels };
      this._connection = "unavailable";
      this._message = panels.length
        ? `Found ${panels.length} ${panels.length === 1 ? "HA Light Panel service" : "HA Light Panel services"}. Choose one below.`
        : "No HA Light Panel service answered on this Home Assistant host or its detected add-on address.";
    } catch (_error) {
      this._connection = "unavailable";
      this._message = "Panel discovery could not run. Enter the panel address manually.";
    } finally { this._busy = false; this._render(); }
  }

  _select(tab) { this._tab = tab; if (tab !== "links") this._beginCheck(); this._render(); if (tab !== "links") this._checkPanel(); }
  _navigate(path) { window.history.pushState(null, "", path); window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } })); }
  _copy(value) { navigator.clipboard.writeText(value).then(() => { this._message = "Link copied to the clipboard."; this._render(); }).catch(() => window.prompt("Copy this link:", value)); }

  _setupBody() {
    const status = this._status || {};
    const defaultUrl = status.upstream || status.default_upstream || "http://127.0.0.1:8890";
    const candidates = (status.candidates || []).map((candidate) => `<button type="button" class="candidate" data-use-url="${this._escape(candidate.url)}"><strong>${this._escape(candidate.name || candidate.label || "HA Light Panel")}${candidate.version ? ` · ${this._escape(candidate.version)}` : ""}</strong><code>${this._escape(candidate.url)}</code></button>`).join("");
    return `<div class="status"><div class="status-card"><h2>${this._connection === "checking" ? "Connecting…" : "Connect HA Light Panel"}</h2><p>${this._escape(this._message)}</p>${this._connection === "checking" ? "" : `<ol><li>Make sure the <strong>HA Light Panel</strong> add-on, Docker container, or systemd service is running.</li><li>Use <strong>Find panel address</strong> to test this HA host and any detected HAOS add-on, or enter an address yourself.</li><li>Select <strong>Connect panel</strong>. If you replace an existing address, restart Home Assistant when asked.</li></ol>${candidates ? `<div class="candidates"><label>Verified HA Light Panel services</label>${candidates}</div>` : ""}<label class="input-label">Panel service address<input data-upstream value="${this._escape(defaultUrl)}" spellcheck="false" placeholder="http://127.0.0.1:8890"></label><div class="actions"><button type="button" class="secondary" data-find ${this._busy ? "disabled" : ""}>Find panel address</button><button type="button" data-save ${this._busy ? "disabled" : ""}>Connect panel</button><button type="button" class="secondary" data-integrations>Open Integrations</button></div><p class="hint">Running the panel on another machine? Replace the host with that machine’s LAN IP or hostname, such as <code>http://192.168.1.50:8890</code>.</p>`}</div></div>`;
  }

  _linksBody() {
    const proxiedOverview = this._absolute(`${PANEL_BASE}/`);
    const proxiedBuilder = this._absolute(`${PANEL_BASE}/builder`);
    const upstream = this._status && this._status.upstream;
    const parsed = upstream ? new URL(upstream) : null;
    const directLan = parsed ? `${parsed.protocol}//${window.location.hostname}:${parsed.port || "8890"}/` : "";
    const loopback = parsed && ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
    const linkRow = (label, url, note) => `<div class="link-row"><div><strong>${label}</strong><code>${this._escape(url)}</code><small>${note}</small></div><button type="button" data-copy="${this._escape(url)}">Copy</button></div>`;
    return `<div class="links"><div class="links-card"><h2>Use HA Light Panel on another device</h2><p>Use the Home Assistant links first: they work from any phone, tablet, or desktop that can reach this Home Assistant instance.</p>${linkRow("Panel overview", proxiedOverview, "Recommended: works through Home Assistant, including the remote access you already use.")}${linkRow("Card builder", proxiedBuilder, "Open this on a desktop when you want to import or compose Lovelace YAML.")}${upstream ? `<h3>Direct LAN address</h3>${loopback ? `<p class="warning">Home Assistant reaches the panel through <code>${this._escape(upstream)}</code>, which is local to the HA host and cannot be opened from another device. If port 8890 is exposed on your HA host, try:</p>${linkRow("Direct panel candidate", directLan, "Fastest local route; only use it if this address opens on your LAN.")}` : linkRow("Configured panel service", upstream, "Use this directly when the address is reachable from your other device.")}` : `<p class="warning">Connect the panel first to see its configured service address.</p>`}</div></div>`;
  }

  _render() {
    const builder = this._tab === "builder"; const links = this._tab === "links"; const target = this._target();
    const title = links ? "Device Links" : builder ? "Card Builder" : "Panel Overview";
    const description = links ? "Copy the right link for your phone, tablet, desktop, or wall display." : builder ? "Compose cards visually, import Lovelace YAML, then copy or download the result." : "Your lightweight Home Assistant panel, served through this integration.";
    const content = links ? this._linksBody() : this._connection === "ready" ? `<iframe title="HA Light Panel ${title}" src="${target}" allow="clipboard-write"></iframe>` : this._setupBody();
    this.shadowRoot.innerHTML = `<style>:host{display:block;height:100%;color:var(--primary-text-color)}.shell{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--primary-background-color)}header{display:flex;align-items:center;gap:16px;min-height:64px;padding:8px 20px;border-bottom:1px solid var(--divider-color);background:var(--card-background-color)}.identity{min-width:0;margin-right:auto}h1{margin:0;font-size:18px;font-weight:500}p{margin:2px 0 0;color:var(--secondary-text-color);font-size:13px}.identity p{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}nav{display:flex;gap:4px;padding:4px;border-radius:9px;background:var(--secondary-background-color)}button,a{min-height:36px;padding:0 13px;border:0;border-radius:7px;color:var(--primary-text-color);background:transparent;font:inherit;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:7px;white-space:nowrap}button.active,.actions button:not(.secondary){color:var(--text-primary-color,#fff);background:var(--primary-color);font-weight:500}a{border:1px solid var(--divider-color)}a:hover,button:not(.active):not(:disabled):hover{background:var(--secondary-background-color)}button:disabled{opacity:.55;cursor:wait}iframe{flex:1;min-height:0;width:100%;border:0;background:#071017}.status,.links{flex:1;overflow:auto;padding:28px}.status{display:grid;place-items:center}.status-card,.links-card{width:min(650px,100%);padding:28px;border:1px solid var(--divider-color);border-radius:14px;background:var(--card-background-color);box-shadow:var(--ha-card-box-shadow,none)}h2{margin:0 0 8px;font-size:20px;font-weight:500}h3{margin:26px 0 8px;font-size:15px}ol{margin:20px 0;padding-left:22px;color:var(--secondary-text-color);line-height:1.7}code{font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}.input-label,.candidates label{display:grid;gap:7px;margin-top:18px;color:var(--secondary-text-color);font-size:12px;font-weight:500}input{min-height:42px;padding:0 11px;border:1px solid var(--divider-color);border-radius:7px;color:var(--primary-text-color);background:var(--secondary-background-color);font:13px ui-monospace,SFMono-Regular,Menlo,monospace}.actions{display:flex;gap:8px;margin-top:16px;flex-wrap:wrap}.secondary{color:var(--primary-text-color);background:var(--secondary-background-color)}.hint,.warning{margin-top:16px;line-height:1.5}.warning{color:var(--warning-color,#ff9800)}.candidates{display:grid;gap:7px}.candidate{display:grid;justify-items:start;gap:2px;min-height:0;padding:10px;border:1px solid var(--divider-color);text-align:left}.candidate strong{font-size:13px}.candidate code{color:var(--secondary-text-color)}.link-row{display:flex;align-items:center;gap:16px;padding:15px 0;border-bottom:1px solid var(--divider-color)}.link-row>div{min-width:0;flex:1;display:grid;gap:3px}.link-row code{overflow-wrap:anywhere;color:var(--primary-color)}small{color:var(--secondary-text-color);font-size:12px;line-height:1.4}@media(max-width:760px){header{gap:8px;padding:8px 12px}.identity p{display:none}h1{font-size:16px}nav{margin-left:auto}nav button{padding:0 9px}a span{display:none}a{padding:0 10px}.status,.links{padding:16px}.status-card,.links-card{padding:20px}}</style><section class="shell"><header><div class="identity"><h1>${title}</h1><p>${description}</p></div><nav aria-label="HA Light Panel pages"><button type="button" class="${!builder&&!links?"active":""}" data-tab="overview">Overview</button><button type="button" class="${builder?"active":""}" data-tab="builder">Builder</button><button type="button" class="${links?"active":""}" data-tab="links">Device links</button></nav>${!links?`<a href="${target}" target="_blank" rel="noopener" title="Open this page in a new tab">↗ <span>New tab</span></a>`:""}</header>${content}</section>`;
    this.shadowRoot.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => this._select(button.dataset.tab)));
    this.shadowRoot.querySelectorAll("[data-copy]").forEach((button) => button.addEventListener("click", () => this._copy(button.dataset.copy)));
    const save = this.shadowRoot.querySelector("[data-save]"); if (save) save.addEventListener("click", () => this._saveUpstream());
    const find = this.shadowRoot.querySelector("[data-find]"); if (find) find.addEventListener("click", () => this._findPanels());
    this.shadowRoot.querySelectorAll("[data-use-url]").forEach((button) => button.addEventListener("click", () => { const input = this.shadowRoot.querySelector("[data-upstream]"); if (input) input.value = button.dataset.useUrl; }));
    const integrations = this.shadowRoot.querySelector("[data-integrations]"); if (integrations) integrations.addEventListener("click", () => this._navigate("/config/integrations"));
  }
}

customElements.define("ha-light-panel-sidebar", HaLightPanelSidebar);
