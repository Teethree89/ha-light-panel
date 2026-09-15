// Thin Home Assistant navigation and setup shell. The panel process continues
// to render the dashboard and visual builder through the ingress proxy.
const PANEL_BASE = "/api/ha_light_panel";
const UPDATE_TIMEOUT_MS = 5 * 60 * 1000;

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
    // A systemd updater restarts the panel outside this browser request, so
    // progress is inferred from reachability and the version that returns.
    this._update = null;
    this._updateTimer = null;
  }

  // Home Assistant assigns a fresh hass object whenever its state changes.
  // Re-checking here would tear down and recreate the iframe every few
  // seconds, preventing the embedded panel from ever settling.
  set hass(value) {
    const firstAssignment = !this._hass;
    this._hass = value;
    if (firstAssignment && this.isConnected) this._checkPanel();
  }
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
  disconnectedCallback() { window.clearTimeout(this._updateTimer); }
  _beginCheck() { this._connection = "checking"; this._message = "Checking the HA Light Panel connection…"; }
  _target() { return this._tab === "builder" ? `${PANEL_BASE}/builder` : `${PANEL_BASE}/`; }
  _absolute(path) { return new URL(path, window.location.origin).href; }
  _escape(value) { const node = document.createElement("span"); node.textContent = String(value || ""); return node.innerHTML; }

  async _checkPanel() {
    if (!this._hass) return;
    const tab = this._tab;
    this._beginCheck(); this._render();
    try {
      // The ingress page is the source of truth. An existing proxy may be
      // healthy even when optional address discovery cannot probe its private
      // container hostname, and it should never be hidden behind setup UI.
      const response = await fetch(this._target(), { cache: "no-store" });
      if (response.ok) {
        this._connection = "ready";
        this._message = "";
        try { this._status = await this._hass.callApi("GET", "ha_light_panel/sidebar-status"); } catch (_statusError) {}
      } else {
        throw new Error(`The ingress page responded with ${response.status}`);
      }
    } catch (_error) {
      try {
        this._status = await this._hass.callApi("GET", "ha_light_panel/sidebar-status");
        this._connection = "unavailable";
        this._message = !this._status.configured
          ? "The HA Light Panel integration has not been connected to a panel service yet."
          : this._status.detail || "The Home Assistant integration is not ready to open this page.";
      } catch (_statusError) {
        this._connection = "unavailable";
        this._message = "The Home Assistant integration is not ready to open this page.";
      }
    }
    if (tab !== this._tab) return;
    if (this._update && (this._connection !== "ready" || this._status?.reachable === false)) this._update.sawRestart = true;
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
        : result.error || "No HA Light Panel service answered on this Home Assistant host or its detected add-on address.";
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

  _overviewBody() {
    const status = this._status || {}; const health = status.health || {}; const update = health.update || {};
    const install = health.install || {
      method: update.method === "systemd" ? "systemd" : "manual",
      label: update.method === "systemd" ? "Managed systemd service" : "Manual or custom service",
      detail: update.reason || "Install type was not reported by this panel version."
    };
    const live = this._connection === "ready" && status.reachable !== false;
    const dataHealthy = health.ok !== false;
    const version = health.version || "Unknown"; const updated = health.lastPollAt ? new Date(health.lastPollAt).toLocaleString() : "Not reported";
    const service = status.upstream || "Not connected";
    const servicePercent = live ? 100 : 12;
    const dataPercent = !live ? 0 : dataHealthy ? 100 : 55;
    const updateStatus = this._updateStatus();
    return `<div class="overview"><div class="overview-card hero"><div><span class="pill ${live ? "good" : "bad"}">${live ? "Online" : "Needs attention"}</span><h2>HA Light Panel</h2><p>${this._escape(live ? "The panel service is reachable through Home Assistant." : status.detail || this._message)}</p></div><a href="${this._target()}" target="_blank" rel="noopener">Open dashboard ↗</a></div><div class="overview-grid"><div class="overview-card"><h3>Service status</h3><strong>${this._escape(service)}</strong><div class="meter" role="progressbar" aria-label="Panel service status" aria-valuenow="${servicePercent}"><span style="width:${servicePercent}%"></span></div><small>${live ? `Online · version ${this._escape(version)} · last poll ${this._escape(updated)}` : "Home Assistant cannot currently reach the panel service."}</small><div class="meter-label"><span>Home Assistant data</span><span>${dataHealthy ? "Connected" : "Needs attention"}</span></div><div class="meter ${dataHealthy ? "" : "warning"}" role="progressbar" aria-label="Home Assistant data status" aria-valuenow="${dataPercent}"><span style="width:${dataPercent}%"></span></div></div><div class="overview-card updates"><h3>Update panel</h3><p>${this._escape(install.label)}${install.detected ? " detected." : "."}</p>${update.available ? `<button type="button" data-update ${this._busy || updateStatus?.phase === "working" ? "disabled" : ""}>Update panel now</button><small>Starts <code>${this._escape(update.service || "the managed updater")}</code> securely on the panel host.</small>` : `<small>${this._escape(update.reason || "This install is updated outside Home Assistant.")}</small>`}${this._updateHtml(updateStatus)}</div><div class="overview-card"><h3>Installation</h3><strong>${this._escape(install.label)}</strong><small>${this._escape(install.detail || "")}</small>${this._manualUpdateHtml(install.method, update.service || "")}</div><div class="overview-card"><h3>Layout Builder</h3><p>Edit native SVG cards, entity bindings, font sizes, and responsive layout presets.</p><button type="button" data-tab="builder">Open builder</button></div><div class="overview-card"><h3>Other devices</h3><p>Copy the Home Assistant-backed links for tablets, phones, and desktops.</p><button type="button" class="secondary" data-tab="links">Device links</button></div></div></div>`;
  }

  _updateStatus() {
    if (!this._update) return null;
    const health = (this._status || {}).health || {};
    const live = this._connection === "ready" && this._status?.reachable !== false;
    const versionChanged = health.version && this._update.from && health.version !== this._update.from;
    const elapsed = Date.now() - this._update.since;
    if (versionChanged) return { phase: "done", percent: 100, label: `Panel is online with version ${health.version}.` };
    if (elapsed > UPDATE_TIMEOUT_MS) return { phase: "timeout", percent: 100, label: "The panel did not confirm a new version within five minutes. Use the instructions below to check the host updater." };
    if (!live || this._update.sawRestart) return { phase: "working", percent: 72, label: live ? "The panel restarted and is checking back in…" : "The panel is restarting. It may be briefly unavailable." };
    // The updater exits without restarting when the installed release is
    // already current. Do not leave a spinner running forever in that case.
    if (elapsed > 9000) return { phase: "done", percent: 100, label: "The panel remains online. It was already current or the update completed without a restart." };
    return { phase: "working", percent: 36, label: "Update request accepted. Waiting for the host updater…" };
  }

  _manualUpdateSteps(method, service) {
    const systemdService = service || "ha-light-panel-update.service";
    const all = {
      systemd: { title: "Managed systemd", steps: [`sudo systemctl start ${systemdService}`, `journalctl -u ${systemdService} -f`], note: "The Overview button runs the first command for you when the managed updater is available." },
      supervisor: { title: "Home Assistant add-on", steps: ["Settings → Add-ons → HA Light Panel → Update"], note: "The Home Assistant Supervisor owns add-on updates." },
      container: { title: "Docker or Compose", steps: ["docker compose pull", "docker compose up -d"], note: "Run these from the folder containing the compose file. A container cannot replace the image it is running from." },
      manual: { title: "Manual or custom service", steps: ["curl -fsSL https://raw.githubusercontent.com/Teethree89/ha-light-panel/main/scripts/bootstrap.sh | sudo bash"], note: "The bootstrap installer preserves its standard configuration and installs a managed updater for future use." }
    };
    return all[method] || all.manual;
  }

  _manualUpdateHtml(method, service) {
    const current = this._manualUpdateSteps(method, service);
    const alternatives = ["systemd", "supervisor", "container", "manual"].filter((item) => item !== method).map((item) => {
      const steps = this._manualUpdateSteps(item, service);
      return `<h4>${this._escape(steps.title)}</h4><ol>${steps.steps.map((step) => `<li><code>${this._escape(step)}</code></li>`).join("")}</ol><small>${this._escape(steps.note)}</small>`;
    }).join("");
    return `<details class="install-help" open><summary>${this._escape(current.title)} instructions</summary><ol>${current.steps.map((step) => `<li><code>${this._escape(step)}</code></li>`).join("")}</ol><small>${this._escape(current.note)}</small><details class="other-installs"><summary>Instructions for other install types</summary>${alternatives}</details></details>`;
  }

  _updateHtml(update) {
    if (!update) return "";
    const busy = update.phase === "working";
    return `<div class="update-progress ${this._escape(update.phase)}"><div class="meter ${busy ? "busy" : ""}" role="progressbar" aria-label="Panel update status" aria-valuenow="${update.percent}"><span style="width:${update.percent}%"></span></div><small>${this._escape(update.label)}</small>${update.phase === "timeout" ? `<button type="button" class="secondary" data-update-dismiss>Dismiss</button>` : ""}</div>`;
  }

  _scheduleUpdateCheck() {
    window.clearTimeout(this._updateTimer);
    if (!this._update || this._updateStatus()?.phase !== "working") return;
    this._updateTimer = window.setTimeout(async () => { await this._checkPanel(); this._scheduleUpdateCheck(); }, 1800);
  }

  async _updatePanel() {
    if (!this._hass || this._busy) return;
    this._busy = true; this._message = "Starting the managed panel update…"; this._render();
    try {
      const result = await this._hass.callApi("POST", "ha_light_panel/sidebar-update", {});
      this._update = { from: ((this._status || {}).health || {}).version || "", since: Date.now(), sawRestart: false };
      this._message = result.message || "Update started. The panel may reconnect shortly.";
    }
    catch (error) { this._message = (error && error.body) || "The panel update could not be started."; }
    finally { this._busy = false; this._render(); this._scheduleUpdateCheck(); }
  }

  _render() {
    const builder = this._tab === "builder"; const links = this._tab === "links"; const target = this._target();
    const title = links ? "Device Links" : builder ? "Panel Layout" : "Panel Overview";
    const description = links ? "Copy the right link for your phone, tablet, desktop, or wall display." : builder ? "Edit native SVG cards, bind entities, and download the reviewed panel config." : "Your lightweight Home Assistant panel, served through this integration.";
    const content = links ? this._linksBody() : builder ? this._connection === "ready" ? `<iframe title="HA Light Panel ${title}" src="${target}" allow="clipboard-write"></iframe>` : this._setupBody() : this._connection === "ready" ? this._overviewBody() : this._setupBody();
    this.shadowRoot.innerHTML = `<style>:host{display:block;height:100%;color:var(--primary-text-color)}.shell{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--primary-background-color)}header{display:flex;align-items:center;gap:16px;min-height:64px;padding:8px 20px;border-bottom:1px solid var(--divider-color);background:var(--card-background-color)}.identity{min-width:0;margin-right:auto}h1{margin:0;font-size:18px;font-weight:500}p{margin:2px 0 0;color:var(--secondary-text-color);font-size:13px}.identity p{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}nav{display:flex;gap:4px;padding:4px;border-radius:9px;background:var(--secondary-background-color)}button,a{min-height:36px;padding:0 13px;border:0;border-radius:7px;color:var(--primary-text-color);background:transparent;font:inherit;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:7px;white-space:nowrap}button.active,.actions button:not(.secondary),.overview-card button:not(.secondary){color:var(--text-primary-color,#fff);background:var(--primary-color);font-weight:500}a{border:1px solid var(--divider-color)}a:hover,button:not(.active):not(:disabled):hover{background:var(--secondary-background-color)}button:disabled{opacity:.55;cursor:wait}iframe{flex:1;min-height:0;width:100%;border:0;background:#071017}.status,.links,.overview{flex:1;overflow:auto;padding:28px}.status{display:grid;place-items:center}.status-card,.links-card,.overview-card{padding:28px;border:1px solid var(--divider-color);border-radius:14px;background:var(--card-background-color);box-shadow:var(--ha-card-box-shadow,none)}.status-card,.links-card{width:min(650px,100%)}h2{margin:0 0 8px;font-size:20px;font-weight:500}h3{margin:0 0 9px;font-size:15px}h4{margin:15px 0 5px;font-size:13px}ol{margin:12px 0;padding-left:22px;color:var(--secondary-text-color);line-height:1.7}code{font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}.input-label,.candidates label{display:grid;gap:7px;margin-top:18px;color:var(--secondary-text-color);font-size:12px;font-weight:500}input{min-height:42px;padding:0 11px;border:1px solid var(--divider-color);border-radius:7px;color:var(--primary-text-color);background:var(--secondary-background-color);font:13px ui-monospace,SFMono-Regular,Menlo,monospace}.actions{display:flex;gap:8px;margin-top:16px;flex-wrap:wrap}.secondary{color:var(--primary-text-color);background:var(--secondary-background-color)}.hint,.warning{margin-top:16px;line-height:1.5}.warning{color:var(--warning-color,#ff9800)}.candidates{display:grid;gap:7px}.candidate{display:grid;justify-items:start;gap:2px;min-height:0;padding:10px;border:1px solid var(--divider-color);text-align:left}.candidate strong{font-size:13px}.candidate code{color:var(--secondary-text-color)}.link-row{display:flex;align-items:center;gap:16px;padding:15px 0;border-bottom:1px solid var(--divider-color)}.link-row>div{min-width:0;flex:1;display:grid;gap:3px}.link-row code{overflow-wrap:anywhere;color:var(--primary-color)}small{color:var(--secondary-text-color);font-size:12px;line-height:1.4}.overview{width:min(1040px,100%);margin:0 auto}.overview-card{display:grid;gap:9px}.overview-card strong{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}.overview-card.hero{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:16px}.overview-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.pill{display:inline-flex;width:max-content;padding:4px 8px;border-radius:999px;font-size:11px;font-weight:700}.pill.good{background:rgba(34,197,94,.18);color:var(--success-color,#3ddc84)}.pill.bad{background:rgba(244,67,54,.15);color:var(--error-color,#ff776d)}.meter{height:8px;overflow:hidden;border-radius:999px;background:var(--secondary-background-color)}.meter span{display:block;height:100%;border-radius:inherit;background:var(--success-color,#3ddc84);transition:width .35s ease}.meter.warning span{background:var(--warning-color,#ff9800)}.meter.busy span{width:42%!important;animation:panel-update 1.2s ease-in-out infinite alternate;background:var(--primary-color)}.meter-label{display:flex;justify-content:space-between;color:var(--secondary-text-color);font-size:12px}.update-progress{display:grid;gap:8px;margin-top:4px;padding-top:4px;border-top:1px solid var(--divider-color)}.update-progress.timeout small{color:var(--warning-color,#ff9800)}.install-help{margin-top:4px;color:var(--secondary-text-color);font-size:13px}.install-help summary,.other-installs summary{cursor:pointer;color:var(--primary-text-color);font-weight:500}.other-installs{margin-top:13px;padding-top:10px;border-top:1px solid var(--divider-color)}.install-help li{overflow-wrap:anywhere}.install-help code{white-space:normal}@keyframes panel-update{from{transform:translateX(-40%)}to{transform:translateX(140%)}}@media(max-width:760px){header{gap:8px;padding:8px 12px}.identity p{display:none}h1{font-size:16px}nav{margin-left:auto}nav button{padding:0 9px}a span{display:none}a{padding:0 10px}.status,.links,.overview{padding:16px}.status-card,.links-card,.overview-card{padding:20px}.overview-grid{grid-template-columns:1fr}.overview-card.hero{align-items:flex-start;flex-direction:column}}</style><section class="shell"><header><div class="identity"><h1>${title}</h1><p>${description}</p></div><nav aria-label="HA Light Panel pages"><button type="button" class="${!builder&&!links?"active":""}" data-tab="overview">Overview</button><button type="button" class="${builder?"active":""}" data-tab="builder">Builder</button><button type="button" class="${links?"active":""}" data-tab="links">Device links</button></nav>${!links?`<a href="${target}" target="_blank" rel="noopener" title="Open this page in a new tab">↗ <span>New tab</span></a>`:""}</header>${content}</section>`;
    this.shadowRoot.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => this._select(button.dataset.tab)));
    this.shadowRoot.querySelectorAll("[data-copy]").forEach((button) => button.addEventListener("click", () => this._copy(button.dataset.copy)));
    const save = this.shadowRoot.querySelector("[data-save]"); if (save) save.addEventListener("click", () => this._saveUpstream());
    const find = this.shadowRoot.querySelector("[data-find]"); if (find) find.addEventListener("click", () => this._findPanels());
    this.shadowRoot.querySelectorAll("[data-use-url]").forEach((button) => button.addEventListener("click", () => { const input = this.shadowRoot.querySelector("[data-upstream]"); if (input) input.value = button.dataset.useUrl; }));
    const integrations = this.shadowRoot.querySelector("[data-integrations]"); if (integrations) integrations.addEventListener("click", () => this._navigate("/config/integrations"));
    const update = this.shadowRoot.querySelector("[data-update]"); if (update) update.addEventListener("click", () => this._updatePanel());
    const dismiss = this.shadowRoot.querySelector("[data-update-dismiss]"); if (dismiss) dismiss.addEventListener("click", () => { this._update = null; this._render(); });
  }
}

customElements.define("ha-light-panel-sidebar", HaLightPanelSidebar);
