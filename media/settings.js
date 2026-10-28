(function () {
  window.argus.registerTab("settings", {
    mount(root, ctx) {
      this.root = root;
      this.ctx = ctx;
      this.groups = [];
      this.query = "";
      this.render();
      ctx.post({ type: "ready" });
    },

    onMessage(message) {
      if (!message || message.type !== "settings") return;
      this.groups = Array.isArray(message.groups) ? message.groups : [];
      this.render();
    },

    // Escapes first, so the only markup is the <code> and <strong> added for `code` and **bold** spans.
    describe(text) {
      return this.ctx.esc(text).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    },

    control(field) {
      const id = this.ctx.esc(field.id);
      if (field.kind === "boolean") {
        return `<label class="toggle"><input type="checkbox" data-id="${id}"${field.value ? " checked" : ""} /> ${field.value ? "On" : "Off"}</label>`;
      }
      if (field.kind === "enum") {
        const options = (field.enum || []).map((option) => `<option value="${this.ctx.esc(option)}"${option === field.value ? " selected" : ""}>${this.ctx.esc(option)}</option>`).join("");
        return `<select data-id="${id}">${options}</select><div class="setting-note muted" data-enum-note></div>`;
      }
      if (field.kind === "number") {
        const min = field.minimum === undefined ? "" : ` min="${this.ctx.esc(field.minimum)}"`;
        const max = field.maximum === undefined ? "" : ` max="${this.ctx.esc(field.maximum)}"`;
        return `<input type="number" step="any" data-id="${id}"${min}${max} value="${this.ctx.esc(field.value)}" />`;
      }
      if (field.kind === "string") {
        return `<input type="text" data-id="${id}" value="${this.ctx.esc(field.value)}" placeholder="${this.ctx.esc(field.default)}" />`;
      }
      return `<button data-json>Edit in settings.json</button>`;
    },

    renderField(field) {
      return `
        <div class="setting" data-field="${this.ctx.esc(field.id)}">
          <div class="setting-head">
            <span class="title">${this.ctx.esc(field.title)}</span>
            <span class="mono muted">${this.ctx.esc(field.id)}</span>
            ${field.userSet ? `<button class="link" data-reset="${this.ctx.esc(field.id)}">Reset</button>` : ""}
          </div>
          <div class="setting-desc muted">${this.describe(field.description)}</div>
          <div class="setting-control">${this.control(field)}</div>
          ${field.workspaceSet ? `<div class="setting-note muted">Workspace setting overrides this</div>` : ""}
        </div>`;
    },

    render() {
      const scroll = document.scrollingElement?.scrollTop ?? 0;
      const sections = this.groups
        .map(
          (group) => `
          <section class="setting-group">
            <h2>${this.ctx.esc(group.title)}</h2>
            ${group.fields.map((field) => this.renderField(field)).join("")}
          </section>`
        )
        .join("");
      this.root.innerHTML = `
        <div class="sessions-toolbar">
          <span class="title">Argus settings</span>
          <label class="search"><span class="sr-only">Search settings</span><input id="settings-search" type="search" placeholder="Search settings" value="${this.ctx.esc(this.query)}" /></label>
          <button id="open-settings" class="primary">Open in VS Code Settings</button>
        </div>
        <div class="settings-body">${sections || `<div class="empty-line">No settings found.</div>`}<div class="empty-line" id="settings-none" hidden>No settings match.</div></div>`;
      this.bind();
      this.filter();
      if (document.scrollingElement) document.scrollingElement.scrollTop = scroll;
    },

    // Hides non-matching settings in place, so typing keeps focus in the search box.
    filter() {
      const words = this.query.toLowerCase().split(/\s+/).filter(Boolean);
      const fields = new Map(this.groups.flatMap((group) => group.fields.map((field) => [field.id, `${group.title} ${field.title} ${field.id} ${field.description || ""}`.toLowerCase()])));
      let shown = 0;
      for (const section of this.root.querySelectorAll(".setting-group")) {
        let any = false;
        for (const row of section.querySelectorAll("[data-field]")) {
          const match = words.every((word) => (fields.get(row.getAttribute("data-field")) || "").includes(word));
          row.hidden = !match;
          any = any || match;
          shown += match ? 1 : 0;
        }
        section.hidden = !any;
      }
      const none = this.root.querySelector("#settings-none");
      if (none) none.hidden = shown > 0 || !this.groups.length;
    },

    bind() {
      const fields = new Map(this.groups.flatMap((group) => group.fields).map((field) => [field.id, field]));
      const post = (id, value) => this.ctx.post({ type: "set", id, value });
      this.root.querySelector("#open-settings").addEventListener("click", () => this.ctx.post({ type: "openSettings" }));
      this.root.querySelector("#settings-search").addEventListener("input", (event) => {
        this.query = event.target.value;
        this.filter();
      });
      for (const button of this.root.querySelectorAll("[data-json]")) button.addEventListener("click", () => this.ctx.post({ type: "openJson" }));
      for (const button of this.root.querySelectorAll("[data-reset]")) {
        button.addEventListener("click", () => this.ctx.post({ type: "reset", id: button.getAttribute("data-reset") }));
      }
      for (const input of this.root.querySelectorAll("[data-id]")) {
        const field = fields.get(input.getAttribute("data-id"));
        if (!field) continue;
        if (field.kind === "boolean") {
          input.addEventListener("change", () => post(field.id, input.checked));
        } else if (field.kind === "enum") {
          const note = input.parentElement.querySelector("[data-enum-note]");
          const showNote = () => {
            const index = (field.enum || []).indexOf(input.value);
            note.innerHTML = this.describe((field.enumDescriptions || [])[index] || "");
          };
          showNote();
          input.addEventListener("change", () => {
            showNote();
            post(field.id, input.value);
          });
        } else if (field.kind === "number") {
          input.addEventListener("change", () => {
            let value = input.value.trim() === "" ? NaN : Number(input.value);
            if (Number.isNaN(value)) return this.render();
            if (field.minimum !== undefined) value = Math.max(field.minimum, value);
            if (field.maximum !== undefined) value = Math.min(field.maximum, value);
            post(field.id, value);
          });
        } else {
          input.addEventListener("change", () => post(field.id, input.value));
        }
      }
    }
  });
})();
