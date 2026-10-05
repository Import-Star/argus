// The Sessions tab: registered like any plugin tab through window.argus.registerTab. Ported from the old
// combined app.js; kanban-card-specific rendering is gone (a plugin now shows its own session chips instead).
(function () {
  const SESSION_COLUMNS = [
    ["needs-you", "Needs you"],
    ["working", "Working"],
    ["idle", "Idle"],
    ["pr-open", "PR open"],
    ["archived", "Archived"]
  ];

  window.argus.registerTab("sessions", {
    mount(root, ctx) {
      this.root = root;
      this.ctx = ctx;
      const saved = ctx.getState() || {};
      this.state = {
        cards: [],
        refreshedAt: undefined,
        query: saved.query || "",
        selected: undefined,
        showArchived: Boolean(saved.showArchived)
      };
      this.active = false;
      this.keydown = (event) => this.onKeydown(event);
      this.masonry = new ResizeObserver((entries) => {
        for (const { target } of entries) target.style.gridRowEnd = `span ${Math.ceil(target.offsetHeight) + 6}`;
      });
      this.render();
      ctx.post({ type: "ready" });
    },

    onMessage(message) {
      if (!message || typeof message !== "object") return;
      if (message.type === "sessions") {
        this.state.cards = Array.isArray(message.cards) ? message.cards : [];
        this.state.refreshedAt = message.refreshedAt;
        this.render();
      }
    },

    onShow() {
      this.active = true;
      document.addEventListener("keydown", this.keydown);
    },

    onHide() {
      this.active = false;
      document.removeEventListener("keydown", this.keydown);
    },

    onKeydown(event) {
      if (!this.active || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target.closest("input, textarea")) {
        if (event.key === "Escape") event.target.blur();
        return;
      }
      const rows = this.visibleRows();
      const index = rows.findIndex((row) => row.getAttribute("data-session-id") === this.state.selected);
      const selected = index >= 0 ? this.state.selected : undefined;
      if (event.key === "/") {
        event.preventDefault();
        this.root.querySelector("#session-search")?.focus();
      } else if (event.key === "n") {
        this.ctx.post({ type: "newChat" });
      } else if ((event.key === "j" || event.key === "ArrowDown") && rows.length) {
        event.preventDefault();
        this.selectRow(rows[Math.min(rows.length - 1, index + 1)].getAttribute("data-session-id"));
      } else if ((event.key === "k" || event.key === "ArrowUp") && rows.length) {
        event.preventDefault();
        this.selectRow(rows[Math.max(0, index - 1)].getAttribute("data-session-id"));
      } else if (event.key === "Enter" && selected) {
        this.ctx.openSession(selected);
      } else if (event.key === "e" && selected) {
        this.ctx.post({ type: "archiveSession", sessionId: selected });
      }
    },

    visibleRows() {
      return [...this.root.querySelectorAll(".row[data-session-id]")];
    },

    selectRow(sessionId) {
      this.state.selected = sessionId;
      for (const row of this.visibleRows()) row.classList.toggle("selected", row.getAttribute("data-session-id") === sessionId);
      this.root.querySelector(`.row[data-session-id="${cssEscape(sessionId)}"]`)?.scrollIntoView({ block: "nearest" });
    },

    persist() {
      this.ctx.setState({ query: this.state.query, showArchived: this.state.showArchived });
    },

    matchesQuery(card) {
      const terms = this.state.query.toLowerCase().split(/\s+/).filter(Boolean);
      if (terms.length === 0) return true;
      const r = card.record;
      const haystack = [
        r.title,
        r.lastPrompt,
        r.lastMessage,
        r.pending,
        r.lastTool,
        card.repo,
        card.worktree,
        card.name,
        ...(r.worktrees || []),
        ...r.prs,
        ...card.prs.map((pr) => `${pr.key} ${pr.title || ""}`),
        ...card.chips.map((chip) => chip.text)
      ]
        .join(" ")
        .toLowerCase();
      return terms.every((term) => haystack.includes(term));
    },

    stateLabel(card) {
      const s = card.record.state;
      if (card.interrupted) return "interrupted";
      if (s === "permission") return "permission";
      if (s === "question") return "question";
      if (s === "done") return card.read ? "idle" : "finished";
      if (card.column === "working") return "Working…";
      return card.open ? "idle" : "tab closed";
    },

    glyphFor(card) {
      if (card.interrupted) return `<span class="glyph dot">⏸</span>`;
      if (card.column === "working") return `<span class="glyph spin">✻</span>`;
      if (card.column === "needs-you") return card.record.state === "done" ? `<span class="glyph ok">✓</span>` : `<span class="glyph dot">⏺</span>`;
      return `<span class="glyph">○</span>`;
    },

    prChip(pr) {
      const { esc } = this.ctx;
      const state = pr.isDraft ? "draft" : String(pr.state || "").toLowerCase();
      const failed = (pr.checks || []).some((c) => c.conclusion && !["SUCCESS", "SKIPPED", "NEUTRAL"].includes(c.conclusion));
      const checks = (pr.checks || []).length ? (failed ? " · ✗ checks" : " · ✓ checks") : "";
      const review = pr.reviewDecision === "APPROVED" ? " · approved" : pr.reviewDecision === "CHANGES_REQUESTED" ? " · changes" : "";
      const num = String(pr.key || "").split("#").pop();
      return `<button class="chip pr-${esc(state)}" data-action="open-pr" data-url="${esc(pr.url)}" title="${esc(pr.title || pr.key)}">#${esc(num)} ${esc(state)}${checks}${review}</button>`;
    },

    renderCard(card) {
      const { esc } = this.ctx;
      const r = card.record;
      const id = esc(r.sessionId);
      const where = card.worktree ? `${card.repo} / ${card.worktree}` : card.repo;
      const working = card.column === "working";
      const pendingTool = r.state === "question" ? "AskUserQuestion" : (r.pending || "").split(" ")[0];
      const pendingArgs = r.state === "question" ? r.pending : (r.pending || "").slice(pendingTool.length + 1);
      const prompt = r.pending
        ? `<div class="prompt mono">${esc(pendingTool)}${r.state === "question" ? "" : `(${esc(pendingArgs)})`}<div class="q">${r.state === "question" ? esc(pendingArgs) : "Waiting for approval"}</div></div>`
        : "";
      const activity = r.state === "working" && r.lastTool ? `<div class="activity mono">⎿ ${esc(r.lastTool)}</div>` : "";
      const last = !r.pending && !working && r.lastMessage && card.column !== "archived" ? `<div class="last">${esc(r.lastMessage.replace(/\*\*|__|`|^#+\s*/g, ""))}</div>` : "";
      const chips = [
        ...card.prs.map((pr) => this.prChip(pr)),
        ...(r.worktrees || []).map((folder) => `<button class="chip wt" data-action="open-worktree" data-folder="${esc(folder)}" title="Open ${esc(folder)}">⎇ ${esc(folder.split("/").pop())}</button>`),
        ...card.chips.map((chip, index) => `<button class="chip" data-action="chip" data-session-id="${id}" data-index="${index}" title="${esc(chip.tooltip || chip.text)}">${esc(chip.text)}</button>`)
      ].join("");
      const actions = [
        `<button data-action="open-session" data-session-id="${id}">open ↵</button>`,
        card.column === "needs-you" && r.state === "done" ? `<button data-action="read-session" data-session-id="${id}">read</button>` : "",
        card.column === "archived"
          ? `<button data-action="unarchive-session" data-session-id="${id}">unarchive</button>`
          : `<button data-action="archive-session" data-session-id="${id}">archive e</button>`
      ].join("");
      return `
        <article class="row col-${esc(card.column)}${working ? " working" : ""}${this.state.selected === r.sessionId ? " selected" : ""}" data-session-id="${id}">
          <div class="l1">${this.glyphFor(card)}<span class="title">${esc(r.title || "New chat")}</span><span class="t mono" data-since="${r.stateSince}" data-precise="${working}">${esc(working ? this.ctx.elapsedPrecise(r.stateSince) : this.ctx.elapsed(r.stateSince))}</span><div class="actions mono">${actions}</div></div>
          <div class="l2 mono"><span class="state">${esc(this.stateLabel(card))}</span> · ${esc(where)}${card.name && card.open && card.name !== r.title ? ` · ${esc(card.name)}` : ""}</div>
          ${prompt}${activity}${last}
          ${chips ? `<div class="chips mono">${chips}</div>` : ""}
        </article>`;
    },

    renderBoard() {
      const { esc } = this.ctx;
      const tracks = [];
      const columns = SESSION_COLUMNS.map(([id, name]) => {
        const cards = this.state.cards.filter((card) => card.column === id && this.matchesQuery(card));
        const collapsed = cards.length === 0 || (id === "archived" && !this.state.showArchived);
        tracks.push(collapsed ? "36px" : `minmax(0, ${1 + Math.min(2, Math.floor(cards.length / 5))}fr)`);
        if (collapsed) {
          return `<div class="rail${id === "archived" ? " clickable" : ""}" data-rail="${esc(id)}">${esc(name)} · ${cards.length}</div>`;
        }
        return `
          <section class="scol col-${esc(id)}">
            <h2>${esc(name)}${id === "archived" ? ' <button class="link" data-rail="archived">hide</button>' : ""}<span class="c mono">${cards.length}</span></h2>
            <div class="rows">${cards.map((card) => this.renderCard(card)).join("")}</div>
          </section>`;
      }).join("");
      return `<section class="sboard" style="grid-template-columns:${tracks.join(" ")}">${columns}</section>`;
    },

    statusLine() {
      const { esc, elapsed } = this.ctx;
      const count = (column) => this.state.cards.filter((c) => c.column === column).length;
      const waiting = this.state.cards.filter((c) => c.column === "needs-you");
      const oldest = waiting.length ? Math.min(...waiting.map((c) => c.record.stateSince)) : undefined;
      return `<div class="statusline mono"><span><span class="n">${count("needs-you")}</span> need you</span><span>${count("working")} working</span><span>${count("pr-open")} PR open</span><span>${count("idle")} idle</span>${oldest ? `<span class="right">oldest wait ${esc(elapsed(oldest))}</span>` : ""}</div>`;
    },

    render() {
      const { esc } = this.ctx;
      const focused = document.activeElement && document.activeElement.id && this.root.contains(document.activeElement)
        ? { id: document.activeElement.id, start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd }
        : undefined;

      this.root.innerHTML = `
        <div class="sessions-toolbar">
          <label class="search"><input id="session-search" type="search" placeholder="Search agents…" value="${esc(this.state.query)}" /><kbd>/</kbd></label>
          <button id="new-chat" class="primary">+ New chat</button>
          <button id="refresh-sessions" class="icon" title="Refresh PR states">↻</button>
        </div>
        ${this.statusLine()}
        ${this.renderBoard()}
        <footer class="keys"><kbd>/</kbd>search <kbd>j</kbd><kbd>k</kbd>move <kbd>↵</kbd>open <kbd>e</kbd>archive <kbd>n</kbd>new chat</footer>
      `;

      this.bindEvents();
      this.masonry.disconnect();
      this.root.querySelectorAll(".rows > .row").forEach((row) => this.masonry.observe(row));

      if (focused) {
        const el = this.root.querySelector(`#${cssEscape(focused.id)}`);
        if (el) {
          el.focus();
          if (typeof focused.start === "number" && el.setSelectionRange) {
            try {
              el.setSelectionRange(focused.start, focused.end);
            } catch {
              /* number inputs don't support selection */
            }
          }
        }
      }
    },

    bindEvents() {
      const actions = {
        "open-session": () => (sessionId) => this.ctx.openSession(sessionId),
        "read-session": () => (sessionId) => this.ctx.post({ type: "markSessionRead", sessionId }),
        "archive-session": () => (sessionId) => this.ctx.post({ type: "archiveSession", sessionId }),
        "unarchive-session": () => (sessionId) => this.ctx.post({ type: "unarchiveSession", sessionId })
      };
      for (const [action, makeHandler] of Object.entries(actions)) {
        const handler = makeHandler();
        for (const el of this.root.querySelectorAll(`[data-action='${action}']`)) {
          el.addEventListener("click", (event) => {
            event.stopPropagation();
            handler(el.getAttribute("data-session-id"));
          });
        }
      }
      for (const el of this.root.querySelectorAll("[data-action='open-pr']")) {
        el.addEventListener("click", (event) => {
          event.stopPropagation();
          this.ctx.openExternal(el.getAttribute("data-url"));
        });
      }
      for (const el of this.root.querySelectorAll("[data-action='open-worktree']")) {
        el.addEventListener("click", (event) => {
          event.stopPropagation();
          this.ctx.post({ type: "openWorktree", folder: el.getAttribute("data-folder") });
        });
      }
      for (const el of this.root.querySelectorAll("[data-action='chip']")) {
        el.addEventListener("click", (event) => {
          event.stopPropagation();
          this.ctx.post({ type: "chipClick", sessionId: el.getAttribute("data-session-id"), index: Number(el.getAttribute("data-index")) });
        });
      }
      for (const row of this.root.querySelectorAll(".row[data-session-id]")) {
        row.addEventListener("click", (event) => {
          const id = row.getAttribute("data-session-id");
          this.selectRow(id);
          if (event.target.closest("button, .title, .chip")) return;
          this.ctx.openSession(id);
        });
      }
      for (const el of this.root.querySelectorAll("[data-rail='archived']")) {
        el.addEventListener("click", () => {
          this.state.showArchived = !this.state.showArchived;
          this.persist();
          this.render();
        });
      }
      const search = this.root.querySelector("#session-search");
      if (search) {
        search.addEventListener("input", () => {
          this.state.query = search.value;
          this.persist();
          this.render();
        });
      }
      this.root.querySelector("#new-chat")?.addEventListener("click", () => this.ctx.post({ type: "newChat" }));
      this.root.querySelector("#refresh-sessions")?.addEventListener("click", () => this.ctx.post({ type: "refreshSessions" }));
    }
  });

  function cssEscape(value) {
    return window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&");
  }
})();
