(function () {
  const PR_URL = /https?:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/\d+[^\s]*/g;

  window.argus.registerTab("kanban", {
    mount(root, ctx) {
      this.root = root;
      this.ctx = ctx;

      this.state = ctx.getState() || {
        phase: "loading", // "loading" | "noWorkspace" | "empty" | "board"
        boardPath: "",
        board: { version: 1, columns: [] },
        prByCardId: {},
        lastSyncError: "",
        syncing: false,
        prSyncedAt: undefined,
        sessions: []
      };

      // Tracks where a card drag will land.
      this.dragInsert = { columnId: null, index: null };

      // Bound once: root itself is never replaced (only its innerHTML), so these must not be re-added on
      // every render() or they would accumulate.
      root.addEventListener("dragover", (event) => {
        this.autoScrollState.x = event.clientX;
        this.autoScrollState.y = event.clientY;
      });
      root.addEventListener("drop", () => this.stopAutoScroll());
      root.addEventListener("dragend", () => this.stopAutoScroll());

      this.render();
      ctx.post({ type: "ready" });
    },

    onMessage(message) {
      if (!message || typeof message !== "object") {
        return;
      }

      if (message.type === "noWorkspace") {
        this.state.phase = "noWorkspace";
        this.save();
        this.render();
        return;
      }

      if (message.type === "empty") {
        this.state.phase = "empty";
        this.save();
        this.render();
        return;
      }

      if (message.type === "state") {
        this.state.phase = "board";
        this.state.boardPath = message.boardPath || "";
        this.state.board = message.board || { version: 1, columns: [] };
        this.state.prByCardId = message.prByCardId || {};
        this.state.lastSyncError = message.lastSyncError || "";
        this.state.prSyncedAt = message.prSyncedAt;
        this.state.syncing = Boolean(message.syncing);
        this.save();
        this.render();
        return;
      }

      if (message.type === "sessions") {
        this.state.sessions = Array.isArray(message.cards) ? message.cards : [];
        this.save();
        this.render();
        return;
      }

      if (message.type === "syncing") {
        this.state.syncing = Boolean(message.value);
        this.save();
        this.render();
        return;
      }

      if (message.type === "error") {
        this.state.lastSyncError = String(message.message || "Unknown error");
        this.save();
        this.render();
      }
    },

    save() {
      this.ctx.setState(this.state);
    },

    send(type, payload) {
      this.ctx.post(Object.assign({ type: type }, payload || {}));
    },

    // ── Rendering ─────────────────────────────────────────────────────────

    elapsed(since) {
      return this.ctx.elapsed(since);
    },

    sessionStateLabel(card) {
      const s = card.record.state;
      if (s === "permission") return "permission";
      if (s === "question") return "question";
      if (s === "done") return card.read ? "idle" : "finished";
      if (s === "working") return "Working…";
      return card.open ? "idle" : "tab closed";
    },

    linkedSessionsFor(cardId) {
      return this.state.sessions.filter((s) => s.record.links && s.record.links.kanban === cardId && s.column !== "archived");
    },

    prChip(pr) {
      const esc = this.ctx.esc;
      const state = pr.isDraft ? "draft" : String(pr.state || "").toLowerCase();
      const failed = (pr.checks || []).some((c) => c.conclusion && ["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED"].includes(c.conclusion));
      const checks = (pr.checks || []).length ? (failed ? " · ✗ checks" : " · ✓ checks") : "";
      const review = pr.reviewDecision === "APPROVED" ? " · approved" : pr.reviewDecision === "CHANGES_REQUESTED" ? " · changes" : "";
      const num = String(pr.key || "").split("#").pop();
      return `<button class="chip pr-${esc(state)}" data-action="open-pr" data-url="${esc(pr.url)}" title="${esc(pr.title || pr.key)}">#${esc(num)} ${esc(state)}${checks}${review}</button>`;
    },

    renderWorkCard(column, card) {
      const esc = this.ctx.esc;
      const prs = this.state.prByCardId[card.id] || [];
      const stripped = card.text.replace(PR_URL, "").trim();
      const text = stripped || prs.map((pr) => pr.title).filter(Boolean)[0] || card.text;
      const linked = this.linkedSessionsFor(card.id);
      const reviewers = prs.flatMap((pr) => pr.reviewers || []);
      const chips = [
        ...prs.map((pr) => this.prChip(pr)),
        ...reviewers.map(
          (r) =>
            `<span class="chip rv-${esc(String(r.state).toLowerCase())}">${esc(r.login)} ${
              r.state === "APPROVED" ? "✓" : r.state === "CHANGES_REQUESTED" ? "✗" : "…"
            }</span>`
        ),
        ...linked.map(
          (s) =>
            `<button class="chip agent col-${esc(s.column)}" data-action="open-session" data-session-id="${esc(
              s.record.sessionId
            )}" title="${esc(s.record.title || "")}">${
              s.record.state === "working" ? '<span class="glyph spin">✻</span>' : "⏺"
            } ${esc(this.sessionStateLabel(s))}</button>`
        )
      ].join("");
      const ids = `data-column-id="${esc(column.id)}" data-card-id="${esc(card.id)}"`;
      const hasError = prs.some((pr) => pr.error);
      return `
        <article class="card wcard${linked.length ? " has-agent" : ""}" draggable="true" ${ids} title="${esc(card.text)}">
          <div class="wtext">${esc(text)}</div>
          ${chips ? `<div class="chips mono">${chips}</div>` : ""}
          ${hasError ? `<div class="werr mono">PR sync failed</div>` : ""}
          <div class="wcard-actions mono">
            ${linked.length ? "" : `<button data-action="start-agent" data-card-id="${esc(card.id)}">▶ agent</button>`}
            <button data-action="edit-card" ${ids} data-card-text="${esc(card.text)}">edit</button>
            <button data-action="remove-card" ${ids}>delete</button>
          </div>
        </article>`;
    },

    workStatusLine() {
      const esc = this.ctx.esc;
      const cards = this.state.board.columns.flatMap((c) => c.cards);
      const prs = Object.values(this.state.prByCardId).flat();
      const open = prs.filter((pr) => pr.state === "OPEN").length;
      const approved = prs.filter((pr) => pr.reviewDecision === "APPROVED").length;
      const agents = cards.filter((c) => this.linkedSessionsFor(c.id).length > 0).length;
      const syncing = this.state.syncing ? "Syncing PRs..." : "";
      const right = syncing
        ? esc(syncing)
        : this.state.prSyncedAt
        ? `PRs updated <span class="t" data-since="${this.state.prSyncedAt}">${esc(this.elapsed(this.state.prSyncedAt))}</span> ago`
        : "";
      return `<div class="statusline mono"><span>${cards.length} cards</span><span><span class="n">${open}</span> PRs open</span><span>${approved} approved</span><span>${agents} with agents</span><span class="right">${right}</span></div>`;
    },

    renderBoard() {
      const esc = this.ctx.esc;
      const tracks = [];
      const columnsHtml = this.state.board.columns
        .map((column) => {
          tracks.push(`minmax(0, ${1 + Math.min(2, Math.floor(column.cards.length / 6))}fr)`);
          return `
            <section class="wcol">
              <h2>
                <span class="name">${esc(column.name)}</span>
                <span class="col-actions mono">
                  <button data-action="rename-column" data-column-id="${esc(column.id)}" data-column-name="${esc(column.name)}">rename</button>
                  <button data-action="remove-column" data-column-id="${esc(column.id)}">delete</button>
                </span>
                <span class="c mono">${column.cards.length}</span>
              </h2>
              <button class="add-card" data-action="add-card" data-column-id="${esc(column.id)}">+ Add card</button>
              <div class="cards" data-column-id="${esc(column.id)}">${column.cards.map((card) => this.renderWorkCard(column, card)).join("")}</div>
            </section>`;
        })
        .join("");

      const syncError = this.state.lastSyncError ? `<div class="sync-error">${esc(this.state.lastSyncError)}</div>` : "";

      return `
        ${this.workStatusLine()}${syncError}
        <section class="board-grid wboard" style="grid-template-columns:${tracks.join(" ")}">${columnsHtml}</section>`;
    },

    renderToolbar() {
      return `<button data-action="add-column">+ Column</button><button data-action="refresh-pr" class="icon" title="Refresh PR status">↻</button>`;
    },

    render() {
      const root = this.root;

      if (this.state.phase === "noWorkspace") {
        root.innerHTML = `
          <main class="kanban-root">
            <div class="empty-state">
              <p>Open a folder to use the Work board.</p>
            </div>
          </main>`;
        return;
      }

      if (this.state.phase === "empty") {
        root.innerHTML = `
          <main class="kanban-root">
            <div class="empty-state">
              <p>No Work board yet.</p>
              <button class="primary" data-action="create-board">Create board</button>
            </div>
          </main>`;
        this.bindCreateBoard();
        return;
      }

      if (this.state.phase !== "board") {
        root.innerHTML = `<main class="kanban-root"><div class="empty-state"><p class="muted">Loading…</p></div></main>`;
        return;
      }

      root.innerHTML = `
        <main class="kanban-root">
          <header class="kanban-toolbar">${this.renderToolbar()}</header>
          ${this.renderBoard()}
        </main>`;

      this.bindEvents();
    },

    bindCreateBoard() {
      const button = this.root.querySelector("[data-action='create-board']");
      if (button) {
        button.addEventListener("click", () => this.send("createBoard"));
      }
    },

    bindEvents() {
      const root = this.root;

      const addColumnButton = root.querySelector("[data-action='add-column']");
      if (addColumnButton) {
        addColumnButton.addEventListener("click", () => this.send("addColumn"));
      }

      const refreshButton = root.querySelector("[data-action='refresh-pr']");
      if (refreshButton) {
        refreshButton.addEventListener("click", () => this.send("refreshPr"));
      }

      for (const button of root.querySelectorAll("[data-action='rename-column']")) {
        button.addEventListener("click", () => {
          const columnId = button.getAttribute("data-column-id");
          const currentName = button.getAttribute("data-column-name") || "";
          if (!columnId) return;
          this.send("renameColumn", { columnId, currentName });
        });
      }

      for (const button of root.querySelectorAll("[data-action='remove-column']")) {
        button.addEventListener("click", () => {
          const columnId = button.getAttribute("data-column-id");
          if (!columnId) return;
          this.send("removeColumn", { columnId });
        });
      }

      for (const button of root.querySelectorAll("[data-action='add-card']")) {
        button.addEventListener("click", () => {
          const columnId = button.getAttribute("data-column-id");
          if (!columnId) return;
          this.send("addCard", { columnId });
        });
      }

      for (const button of root.querySelectorAll("[data-action='remove-card']")) {
        button.addEventListener("click", () => {
          const columnId = button.getAttribute("data-column-id");
          const cardId = button.getAttribute("data-card-id");
          if (!columnId || !cardId) return;
          this.send("removeCard", { columnId, cardId });
        });
      }

      for (const button of root.querySelectorAll("[data-action='edit-card']")) {
        button.addEventListener("click", () => {
          const columnId = button.getAttribute("data-column-id");
          const cardId = button.getAttribute("data-card-id");
          const currentText = button.getAttribute("data-card-text") || "";
          if (!columnId || !cardId) return;
          this.send("updateCard", { columnId, cardId, currentText });
        });
      }

      for (const button of root.querySelectorAll("[data-action='start-agent']")) {
        button.addEventListener("click", () => {
          const cardId = button.getAttribute("data-card-id");
          if (!cardId) return;
          this.send("startAgent", { cardId });
        });
      }

      for (const link of root.querySelectorAll("[data-action='open-pr']")) {
        link.addEventListener("click", (event) => {
          event.stopPropagation();
          const url = link.getAttribute("data-url");
          if (url) this.ctx.openExternal(url);
        });
      }

      for (const chip of root.querySelectorAll("[data-action='open-session']")) {
        chip.addEventListener("click", (event) => {
          event.stopPropagation();
          const sessionId = chip.getAttribute("data-session-id");
          if (sessionId) this.ctx.openSession(sessionId);
        });
      }

      for (const card of root.querySelectorAll(".card")) {
        card.addEventListener("dragstart", (event) => {
          const cardId = card.getAttribute("data-card-id");
          const fromColumnId = card.getAttribute("data-column-id");
          if (!cardId || !fromColumnId) return;
          const payload = JSON.stringify({ cardId, fromColumnId });
          event.dataTransfer.setData("application/x-argus-card", payload);
          event.dataTransfer.setData("text/plain", payload);
          event.dataTransfer.effectAllowed = "move";
          card.classList.add("dragging");
          this.startAutoScroll();
        });

        card.addEventListener("dragend", () => {
          card.classList.remove("dragging");
          this.stopAutoScroll();
        });

        this.bindCardDropTarget(card);
      }

      for (const container of root.querySelectorAll(".cards[data-column-id]")) {
        this.bindColumnDropTarget(container);
      }
    },

    // ── Drag/drop with auto-scroll ────────────────────────────────────────

    autoScrollRaf: null,
    autoScrollState: { x: 0, y: 0 },

    startAutoScroll() {
      if (this.autoScrollRaf !== null) return;

      const tick = () => {
        const EDGE = 60;
        const SPEED = 10;

        for (const col of this.root.querySelectorAll(".cards")) {
          const rect = col.getBoundingClientRect();
          const inX = this.autoScrollState.x >= rect.left && this.autoScrollState.x <= rect.right;
          if (!inX) continue;
          if (this.autoScrollState.y < rect.top + EDGE) {
            col.scrollTop -= SPEED;
          } else if (this.autoScrollState.y > rect.bottom - EDGE) {
            col.scrollTop += SPEED;
          }
        }

        const grid = this.root.querySelector(".board-grid");
        if (grid) {
          const r = grid.getBoundingClientRect();
          if (this.autoScrollState.x < r.left + EDGE) {
            grid.scrollLeft -= SPEED;
          } else if (this.autoScrollState.x > r.right - EDGE) {
            grid.scrollLeft += SPEED;
          }
        }

        this.autoScrollRaf = requestAnimationFrame(tick);
      };

      this.autoScrollRaf = requestAnimationFrame(tick);
    },

    stopAutoScroll() {
      if (this.autoScrollRaf !== null) {
        cancelAnimationFrame(this.autoScrollRaf);
        this.autoScrollRaf = null;
      }
    },

    clearDropIndicators() {
      for (const el of this.root.querySelectorAll(".drop-before, .drop-after")) {
        el.classList.remove("drop-before", "drop-after");
      }
    },

    moveCard(cardId, fromColumnId, toColumnId, targetIndex) {
      this.send("moveCard", { cardId, fromColumnId, toColumnId, targetIndex });
    },

    bindCardDropTarget(card) {
      card.addEventListener("dragover", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.clearDropIndicators();

        const rect = card.getBoundingClientRect();
        const isAbove = event.clientY < rect.top + rect.height / 2;
        card.classList.add(isAbove ? "drop-before" : "drop-after");

        const columnId = card.getAttribute("data-column-id");
        const cardId = card.getAttribute("data-card-id");
        const siblings = [...this.root.querySelectorAll(`.card[data-column-id="${columnId}"]`)];
        const pos = siblings.findIndex((c) => c.getAttribute("data-card-id") === cardId);
        this.dragInsert = { columnId, index: isAbove ? pos : pos + 1 };
      });

      card.addEventListener("dragleave", (event) => {
        if (!card.contains(event.relatedTarget)) {
          card.classList.remove("drop-before", "drop-after");
        }
      });

      card.addEventListener("drop", (event) => {
        event.preventDefault();
        event.stopPropagation();
        card.classList.remove("drop-before", "drop-after");

        const payload = event.dataTransfer && event.dataTransfer.getData("application/x-argus-card");
        if (!payload || this.dragInsert.columnId === null) return;

        try {
          const parsed = JSON.parse(payload);
          this.moveCard(parsed.cardId, parsed.fromColumnId, this.dragInsert.columnId, this.dragInsert.index);
        } catch {
          // Ignore invalid payloads.
        }
        this.dragInsert = { columnId: null, index: null };
      });
    },

    bindColumnDropTarget(container) {
      const columnId = container.getAttribute("data-column-id");
      if (!columnId) return;

      container.addEventListener("dragover", (event) => {
        if (event.target.closest(".card")) return;
        event.preventDefault();
        this.clearDropIndicators();
        container.classList.add("col-drop-active");
        const cardCount = container.querySelectorAll(".card").length;
        this.dragInsert = { columnId, index: cardCount };
      });

      container.addEventListener("dragleave", (event) => {
        if (!container.contains(event.relatedTarget)) {
          container.classList.remove("col-drop-active");
        }
      });

      container.addEventListener("drop", (event) => {
        if (event.target.closest(".card")) {
          container.classList.remove("col-drop-active");
          return;
        }
        event.preventDefault();
        container.classList.remove("col-drop-active");

        const payload = event.dataTransfer && event.dataTransfer.getData("application/x-argus-card");
        if (!payload || this.dragInsert.columnId === null) return;

        try {
          const parsed = JSON.parse(payload);
          this.moveCard(parsed.cardId, parsed.fromColumnId, this.dragInsert.columnId, this.dragInsert.index);
        } catch {
          // Ignore invalid payloads.
        }
        this.dragInsert = { columnId: null, index: null };
      });
    }
  });
})();
