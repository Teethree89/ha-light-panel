// Home Assistant custom panel for HA Light Panel. The actual dashboard and
// visual builder continue to be served by the panel process; this lightweight
// shell gives them a stable, native-looking place in HA's sidebar.
const PANEL_BASE = "/api/ha_light_panel";

class HaLightPanelSidebar extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._tab = "overview";
    this._connection = "checking";
    this._connectionMessage = "Checking the HA Light Panel connection…";
  }

  set hass(_value) {}
  set narrow(_value) {}
  set panel(_value) {}

  set route(value) {
    // A bookmarked /ha-light-panel/builder route opens the builder tab. The
    // sidebar itself remains one HA panel, so both views retain native nav.
    const nextTab = value && String(value.path || "").replace(/^\//, "") === "builder"
      ? "builder"
      : "overview";
    const changed = nextTab !== this._tab;
    this._tab = nextTab;
    if (changed) {
      this._connection = "checking";
      this._connectionMessage = "Checking the HA Light Panel connection…";
    }
    this._render();
    if (changed && this.isConnected) this._checkPanel();
  }

  connectedCallback() {
    this._render();
    this._checkPanel();
  }

  _select(tab) {
    this._tab = tab;
    this._connection = "checking";
    this._connectionMessage = "Checking the HA Light Panel connection…";
    this._render();
    this._checkPanel();
  }

  async _checkPanel() {
    const tabAtStart = this._tab;
    const target = tabAtStart === "builder" ? `${PANEL_BASE}/builder` : `${PANEL_BASE}/`;
    try {
      // Check the exact page the iframe will use. /health can be 503 when HA
      // credentials are absent even though the offline YAML builder is useful.
      const response = await fetch(target, { cache: "no-store" });
      if (!response.ok) throw new Error(`The panel responded with ${response.status}`);
      if (tabAtStart !== this._tab) return;
      this._connection = "ready";
      this._connectionMessage = "";
    } catch (_error) {
      if (tabAtStart !== this._tab) return;
      this._connection = "unavailable";
      this._connectionMessage = "Home Assistant cannot reach the configured HA Light Panel service yet.";
    }
    this._render();
  }

  _navigate(path) {
    window.history.pushState(null, "", path);
    window.dispatchEvent(new CustomEvent("location-changed", {
      detail: { replace: false },
    }));
  }

  _render() {
    const builder = this._tab === "builder";
    const target = builder ? `${PANEL_BASE}/builder` : `${PANEL_BASE}/`;
    const title = builder ? "Card Builder" : "Panel Overview";
    const description = builder
      ? "Compose cards visually, import Lovelace YAML, then copy or download the result."
      : "Your lightweight Home Assistant panel, served through this integration.";

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; height: 100%; color: var(--primary-text-color); }
        .shell { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--primary-background-color); }
        header { display: flex; align-items: center; gap: 16px; min-height: 64px; padding: 8px 20px; border-bottom: 1px solid var(--divider-color); background: var(--card-background-color); }
        .identity { min-width: 0; margin-right: auto; }
        h1 { margin: 0; font-size: 18px; font-weight: 500; }
        p { margin: 2px 0 0; color: var(--secondary-text-color); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        nav { display: flex; gap: 4px; padding: 4px; border-radius: 9px; background: var(--secondary-background-color); }
        button, a { min-height: 36px; padding: 0 13px; border: 0; border-radius: 7px; color: var(--primary-text-color); background: transparent; font: inherit; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; }
        button.active { color: var(--text-primary-color, #fff); background: var(--primary-color); font-weight: 500; }
        a { border: 1px solid var(--divider-color); }
        a:hover, button:not(.active):hover { background: var(--secondary-background-color); }
        iframe { flex: 1; min-height: 0; width: 100%; border: 0; background: #071017; }
        .status { flex: 1; display: grid; place-items: center; padding: 24px; }
        .status-card { width: min(520px, 100%); padding: 28px; border: 1px solid var(--divider-color); border-radius: 14px; background: var(--card-background-color); box-shadow: var(--ha-card-box-shadow, none); }
        .status-card h2 { margin: 0 0 8px; font-size: 20px; font-weight: 500; }
        .status-card p { margin: 0 0 20px; white-space: normal; line-height: 1.5; }
        .actions { display: flex; gap: 8px; flex-wrap: wrap; }
        .actions button { background: var(--primary-color); color: var(--text-primary-color, #fff); font-weight: 500; }
        .actions button.secondary { color: var(--primary-text-color); background: var(--secondary-background-color); }
        @media (max-width: 700px) { header { gap: 9px; padding: 8px 12px; } .identity p { display: none; } h1 { font-size: 16px; } nav { margin-left: auto; } a span { display: none; } a { padding: 0 10px; } }
      </style>
      <section class="shell">
        <header>
          <div class="identity"><h1>${title}</h1><p>${description}</p></div>
          <nav aria-label="HA Light Panel pages">
            <button type="button" class="${builder ? "" : "active"}" data-tab="overview" aria-current="${builder ? "false" : "page"}">Overview</button>
            <button type="button" class="${builder ? "active" : ""}" data-tab="builder" aria-current="${builder ? "page" : "false"}">Builder</button>
          </nav>
          <a href="${target}" target="_blank" rel="noopener" title="Open this page in a new tab">↗ <span>New tab</span></a>
        </header>
        ${this._connection === "ready"
          ? `<iframe title="HA Light Panel ${title}" src="${target}" allow="clipboard-write"></iframe>`
          : `<div class="status"><div class="status-card"><h2>${this._connection === "checking" ? "Connecting…" : "Panel service unavailable"}</h2><p>${this._connectionMessage}</p>${this._connection === "unavailable" ? '<p>In <strong>Settings → Devices &amp; Services → HA Light Panel</strong>, add or repair the integration and point it at the running panel service (usually <code>http://127.0.0.1:8890</code>). Then restart Home Assistant.</p><div class="actions"><button type="button" data-retry>Retry</button><button type="button" class="secondary" data-integrations>Open Integrations</button></div>' : ""}</div></div>`}
      </section>`;
    this.shadowRoot.querySelectorAll("[data-tab]").forEach((button) => {
      button.addEventListener("click", () => this._select(button.dataset.tab));
    });
    const retry = this.shadowRoot.querySelector("[data-retry]");
    if (retry) retry.addEventListener("click", () => this._checkPanel());
    const integrations = this.shadowRoot.querySelector("[data-integrations]");
    if (integrations) integrations.addEventListener("click", () => this._navigate("/config/integrations"));
  }
}

customElements.define("ha-light-panel-sidebar", HaLightPanelSidebar);
