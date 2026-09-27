// Control Centre tab host. Defines window.argus.registerTab (see api/webview.d.ts), renders the top bar and the
// per-tab <section data-tab-root="id"> content areas (already present in the page from ControlCentre's HTML,
// one hidden section per registered tab), and routes messages between the extension and each tab's script.
(function () {
  const vscode = acquireVsCodeApi();

  /** @type {{id: string, title: string, badge?: number}[]} */
  const tabsMeta = window.__argusTabs || [];
  let activeTab = window.__argusActive || (tabsMeta[0] && tabsMeta[0].id);

  /** @type {Map<string, {mount: Function, onMessage?: Function, onShow?: Function, onHide?: Function}>} */
  const registered = new Map();
  const mounted = new Set();
  const badges = new Map(tabsMeta.map((tab) => [tab.id, tab.badge]));

  // Per-tab UI state, namespaced under one webview state object so a panel reload restores each tab's own state.
  const persisted = vscode.getState() || {};

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function elapsed(sinceMs) {
    const seconds = Math.max(0, Math.floor((Date.now() - sinceMs) / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ${minutes % 60}m`;
    return `${Math.floor(hours / 24)}d`;
  }

  function elapsedPrecise(sinceMs) {
    const seconds = Math.max(0, Math.floor((Date.now() - sinceMs) / 1000));
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes ? `${minutes}m ${String(seconds % 60).padStart(2, "0")}s` : `${seconds}s`;
    return elapsed(sinceMs);
  }

  function makeCtx(tabId) {
    return {
      post(message) {
        vscode.postMessage({ type: "tab", tab: tabId, message });
      },
      esc,
      elapsed,
      elapsedPrecise,
      openExternal(url) {
        if (typeof url === "string" && url.startsWith("https:")) {
          vscode.postMessage({ type: "openExternal", url });
        }
      },
      openSession(sessionId) {
        vscode.postMessage({ type: "openSession", sessionId });
      },
      getState() {
        return persisted[tabId];
      },
      setState(state) {
        persisted[tabId] = state;
        vscode.setState(persisted);
      }
    };
  }

  function renderTabBar() {
    const bar = document.getElementById("argus-tabs");
    if (!bar) return;
    bar.innerHTML = tabsMeta
      .map((tab) => {
        const badge = badges.get(tab.id);
        return `<button class="tab ${tab.id === activeTab ? "active" : ""}" data-tab="${esc(tab.id)}">${esc(tab.title)}${badge ? ` <span class="badge">${esc(badge)}</span>` : ""}</button>`;
      })
      .join("");
    for (const button of bar.querySelectorAll("[data-tab]")) {
      button.addEventListener("click", () => setActive(button.getAttribute("data-tab")));
    }
  }

  function renderSections() {
    for (const tab of tabsMeta) {
      const section = document.querySelector(`[data-tab-root="${cssEscape(tab.id)}"]`);
      if (!section) continue;
      section.hidden = tab.id !== activeTab;
    }
  }

  function cssEscape(value) {
    return window.CSS && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
  }

  function mountIfReady(tabId) {
    if (mounted.has(tabId)) return;
    const impl = registered.get(tabId);
    const section = document.querySelector(`[data-tab-root="${cssEscape(tabId)}"]`);
    if (!impl || !section) return;
    mounted.add(tabId);
    try {
      impl.mount(section, makeCtx(tabId));
    } catch (error) {
      section.innerHTML = `<div class="sync-error">Argus: this tab failed to load (${esc(error && error.message ? error.message : String(error))}).</div>`;
      console.error(`Argus: tab "${tabId}" mount() threw`, error);
    }
  }

  function setActive(tabId) {
    if (!tabId || tabId === activeTab) return;
    const previous = activeTab;
    activeTab = tabId;
    renderTabBar();
    renderSections();
    vscode.postMessage({ type: "activate", tab: tabId });
    const prevImpl = previous && registered.get(previous);
    try {
      prevImpl?.onHide?.();
    } catch (error) {
      console.error(`Argus: tab "${previous}" onHide() threw`, error);
    }
    mountIfReady(tabId);
    const impl = registered.get(tabId);
    try {
      impl?.onShow?.();
    } catch (error) {
      console.error(`Argus: tab "${tabId}" onShow() threw`, error);
    }
  }

  window.argus = {
    registerTab(id, tab) {
      registered.set(id, tab);
      if (id === activeTab) {
        mountIfReady(id);
      }
    }
  };

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || typeof message !== "object") return;
    if (message.type === "tab") {
      // A tab asks for full state when it mounts, so anything sent before that is safe to drop.
      if (!mounted.has(message.tab)) return;
      const impl = registered.get(message.tab);
      try {
        impl?.onMessage?.(message.message);
      } catch (error) {
        console.error(`Argus: tab "${message.tab}" onMessage() threw`, error);
      }
      return;
    }
    if (message.type === "badge") {
      badges.set(message.tab, message.count);
      renderTabBar();
      return;
    }
    if (message.type === "activate" && typeof message.tab === "string") {
      setActive(message.tab);
    }
  });

  renderTabBar();
  renderSections();
  mountIfReady(activeTab);

  // Live "since" timers and the spinner glyph, shared by every tab.
  setInterval(() => {
    for (const el of document.querySelectorAll(".t[data-since]")) {
      const since = Number(el.getAttribute("data-since"));
      el.textContent = el.getAttribute("data-precise") === "true" ? elapsedPrecise(since) : elapsed(since);
    }
  }, 1000);

  const SPINNER = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];
  let spinnerFrame = 0;
  setInterval(() => {
    spinnerFrame = (spinnerFrame + 1) % SPINNER.length;
    for (const el of document.querySelectorAll(".glyph.spin")) el.textContent = SPINNER[spinnerFrame];
  }, 120);
})();
