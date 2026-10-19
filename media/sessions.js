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

  const isMac = /Mac/.test(navigator.platform || navigator.userAgent);

  window.argus.registerTab("sessions", {
    mount(root, ctx) {
      this.root = root;
      this.ctx = ctx;
      const saved = ctx.getState() || {};
      this.state = {
        cards: [],
        archiving: new Set(),
        refreshedAt: undefined,
        query: saved.query || "",
        selected: undefined,
        // Sessions picked for a bulk action (ctrl/cmd-click, shift-click or x), and the last one picked.
        picked: new Set(),
        anchor: undefined,
        showArchived: Boolean(saved.showArchived),
        groupByRepo: Boolean(saved.groupByRepo),
        // Sessions whose merged and closed PRs are shown.
        showDonePrs: new Set(),
        // Sessions whose transcript matches the query, with a snippet. Filled by the extension.
        deep: {}
      };
      this.active = false;
      this.keydown = (event) => this.onKeydown(event);
      this.masonry = new ResizeObserver((entries) => {
        for (const { target } of entries) fitRow(target);
      });
      this.render();
      ctx.post({ type: "ready" });
      this.requestSearch();
    },

    onMessage(message) {
      if (!message || typeof message !== "object") return;
      if (message.type === "sessions") {
        this.state.cards = Array.isArray(message.cards) ? message.cards : [];
        this.state.refreshedAt = message.refreshedAt;
        this.state.archiving = new Set(message.archiving || []);
        const ids = new Set(this.state.cards.map((card) => card.record.sessionId));
        for (const id of this.state.picked) if (!ids.has(id)) this.state.picked.delete(id);
        this.render();
      } else if (message.type === "searchResults" && message.query === this.state.query.trim()) {
        this.state.deep = message.matches || {};
        this.render();
      }
    },

    requestSearch() {
      clearTimeout(this.searchTimer);
      this.state.deep = {};
      const query = this.state.query.trim();
      if (query.length < 3) return;
      this.searchTimer = setTimeout(() => this.ctx.post({ type: "search", query }), 300);
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
      if (event.key === "Escape" && this.state.picked.size && !event.target.closest("input, textarea")) {
        this.clearPicked();
        return;
      }
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
      } else if (event.key === "g") {
        this.toggleGroupByRepo();
      } else if ((event.key === "j" || event.key === "ArrowDown") && rows.length) {
        event.preventDefault();
        this.selectRow(rows[Math.min(rows.length - 1, index + 1)].getAttribute("data-session-id"));
      } else if ((event.key === "k" || event.key === "ArrowUp") && rows.length) {
        event.preventDefault();
        this.selectRow(rows[Math.max(0, index - 1)].getAttribute("data-session-id"));
      } else if (event.key === "Enter" && selected) {
        this.ctx.openSession(selected);
      } else if (event.key === "x" && selected) {
        this.pick(selected, false);
      } else if (event.key === "e" && this.state.picked.size) {
        this.archivePicked();
      } else if (event.key === "e" && selected && !this.state.archiving.has(selected)) {
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

    // Toggles one session, or with range picks every visible row between the last pick and this one.
    pick(sessionId, range) {
      const ids = this.visibleRows().map((row) => row.getAttribute("data-session-id"));
      const from = ids.indexOf(this.state.anchor);
      const to = ids.indexOf(sessionId);
      if (range && from >= 0 && to >= 0) {
        for (const id of ids.slice(Math.min(from, to), Math.max(from, to) + 1)) this.state.picked.add(id);
      } else if (!this.state.picked.delete(sessionId)) {
        this.state.picked.add(sessionId);
      }
      this.state.anchor = sessionId;
      this.render();
    },

    clearPicked() {
      this.state.picked.clear();
      this.state.anchor = undefined;
      this.render();
    },

    pickedCards() {
      return this.state.cards.filter((card) => this.state.picked.has(card.record.sessionId));
    },

    archivePicked() {
      const sessionIds = this.pickedCards()
        .filter((card) => card.column !== "archived" && !this.state.archiving.has(card.record.sessionId))
        .map((card) => card.record.sessionId);
      if (sessionIds.length === 0) return;
      this.ctx.post({ type: "archiveSessions", sessionIds });
      this.clearPicked();
    },

    unarchivePicked() {
      const sessionIds = this.pickedCards().filter((card) => card.column === "archived").map((card) => card.record.sessionId);
      if (sessionIds.length === 0) return;
      this.ctx.post({ type: "unarchiveSessions", sessionIds });
      this.clearPicked();
    },

    bulkBar() {
      const picked = this.pickedCards();
      if (picked.length === 0) return "";
      const toArchive = picked.filter((card) => card.column !== "archived").length;
      const toUnarchive = picked.length - toArchive;
      return `<div class="bulk-bar"><span class="mono">${picked.length} selected</span>
        ${toArchive ? `<button id="bulk-archive" class="primary">Archive ${toArchive} <kbd>e</kbd></button>` : ""}
        ${toUnarchive ? `<button id="bulk-unarchive">Unarchive ${toUnarchive}</button>` : ""}
        <button id="bulk-all">Select all shown</button>
        <button id="bulk-clear">Clear <kbd>esc</kbd></button></div>`;
    },

    persist() {
      this.ctx.setState({ query: this.state.query, showArchived: this.state.showArchived, groupByRepo: this.state.groupByRepo });
    },

    toggleGroupByRepo() {
      this.state.groupByRepo = !this.state.groupByRepo;
      this.persist();
      this.render();
    },

    isVisible(card) {
      return this.matchesQuery(card) || (this.state.query.trim() !== "" && this.state.deep[card.record.sessionId] !== undefined);
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
      const agents = card.open ? Object.values(r.subagents || {}) : [];
      const agentLine = agents.length ? `<div class="activity mono">⑂ ${agents.length} agent${agents.length > 1 ? "s" : ""} running · ${esc(countByType(agents))}</div>` : "";
      const hit = this.state.query.trim() ? this.state.deep[r.sessionId] : undefined;
      const last = hit
        ? `<div class="last hit">${esc(hit)}</div>`
        : !r.pending && !working && r.lastMessage && card.column !== "archived" ? `<div class="last">${esc(r.lastMessage.replace(/\*\*|__|`|^#+\s*/g, ""))}</div>` : "";
      const u = card.usage;
      const usage = u && u.usedTokens
        ? `<div class="usage mono" title="${esc(`Context: size of the latest prompt. Used: new input, cache writes and output across the session and its sub-agents. Cache reads: ${tokens(u.cacheReadTokens)}.`)}">${u.contextTokens ? `ctx ${esc(tokens(u.contextTokens))} · ` : ""}${esc(tokens(u.usedTokens))} used${u.compactions ? ` · compacted ×${esc(u.compactions)}` : ""}</div>`
        : "";
      const done = card.prs.filter((pr) => pr.state === "MERGED" || pr.state === "CLOSED");
      const showDone = this.state.showDonePrs.has(r.sessionId);
      const chips = [
        ...card.prs.filter((pr) => showDone || !done.includes(pr)).map((pr) => this.prChip(pr)),
        done.length ? `<button class="chip" data-action="toggle-done-prs" data-session-id="${id}" title="Show or hide merged and closed PRs">${showDone ? "hide" : "+"} ${esc(doneLabel(done))}</button>` : "",
        ...(r.worktrees || []).map((folder) => `<button class="chip wt" data-action="open-worktree" data-folder="${esc(folder)}" title="Open ${esc(folder)}">⎇ ${esc(folder.split("/").pop())}</button>`),
        ...card.chips.map((chip, index) => `<button class="chip" data-action="chip" data-session-id="${id}" data-index="${index}" title="${esc(chip.tooltip || chip.text)}">${esc(chip.text)}</button>`)
      ].join("");
      const actions = [
        `<button data-action="open-session" data-session-id="${id}">open ↵</button>`,
        card.column === "needs-you" && r.state === "done" ? `<button data-action="read-session" data-session-id="${id}">read</button>` : "",
        card.column === "archived"
          ? `<button data-action="unarchive-session" data-session-id="${id}">unarchive</button>`
          : this.state.archiving.has(r.sessionId)
            ? `<button disabled><span class="spinner"></span>archiving…</button>`
            : `<button data-action="archive-session" data-session-id="${id}">archive e</button>`
      ].join("");
      return `
        <article class="row col-${esc(card.column)}${working ? " working" : ""}${this.state.archiving.has(r.sessionId) ? " archiving" : ""}${this.state.selected === r.sessionId ? " selected" : ""}${this.state.picked.has(r.sessionId) ? " picked" : ""}" data-session-id="${id}">
          <div class="l1">${this.glyphFor(card)}<span class="title" data-action="rename-session" data-session-id="${id}" title="Double-click to rename">${esc(r.title || "New chat")}</span><span class="t mono" data-since="${r.stateSince}" data-precise="${working}">${esc(working ? this.ctx.elapsedPrecise(r.stateSince) : this.ctx.elapsed(r.stateSince))}</span></div>
          <div class="l2 mono"><span class="where"><span class="state">${esc(this.stateLabel(card))}</span> · ${esc(where)}${card.name && card.open && card.name !== r.title ? ` · ${esc(card.name)}` : ""}</span><div class="actions">${actions}</div></div>
          ${prompt}${activity}${agentLine}${last}
          ${chips ? `<div class="chips mono">${chips}</div>` : ""}
          ${usage}
        </article>`;
    },

    // Grid sizes go in data attributes because the CSP blocks inline style attributes; applyGrid() sets them.
    renderBoard() {
      const { esc } = this.ctx;
      const searching = this.state.query.trim() !== "";
      const columns = SESSION_COLUMNS.map(([id, name]) => {
        const cards = this.state.cards.filter((card) => card.column === id && this.isVisible(card));
        const hidden = id === "archived" && !this.state.showArchived && !(searching && cards.length > 0);
        return { id, name, cards, collapsed: cards.length === 0 || hidden };
      });
      const tracks = columns.map((col) => (col.collapsed ? "36px" : `minmax(0, ${1 + Math.min(2, Math.floor(col.cards.length / 5))}fr)`));
      const rail = (col) => `<div class="rail${col.id === "archived" ? " clickable" : ""}" data-rail="${esc(col.id)}">${esc(col.name)} · ${col.cards.length}</div>`;
      const heading = (col) =>
        `<h2>${esc(col.name)}${col.id === "archived" && this.state.showArchived ? ' <button class="link" data-rail="archived">hide</button>' : ""}<span class="c mono">${col.cards.length}</span></h2>`;
      const rows = (cards, extra = "") => `<div class="rows${extra}">${cards.map((card) => this.renderCard(card)).join("")}</div>`;

      if (!this.state.groupByRepo) {
        const cells = columns.map((col) => (col.collapsed ? rail(col) : `<section class="scol col-${esc(col.id)}">${heading(col)}${rows(col.cards)}</section>`));
        return `<section class="sboard" data-columns="${esc(tracks.join(" "))}">${cells.join("")}</section>`;
      }

      const lanes = laneOrder(columns.filter((col) => !col.collapsed).flatMap((col) => col.cards));
      const cells = [];
      columns.forEach((col, index) => {
        const column = String(index + 2);
        if (col.collapsed) {
          cells.push(rail(col).replace("<div ", `<div data-col="${column}" data-row="1 / -1" `));
          return;
        }
        cells.push(`<section class="scol col-${esc(col.id)}" data-col="${column}" data-row="1">${heading(col)}</section>`);
        lanes.forEach((lane, laneIndex) => {
          const cards = col.cards.filter((card) => card.repo === lane.repo);
          cells.push(`<div class="scol" data-col="${column}" data-row="${laneIndex + 2}">${rows(cards, " lane")}</div>`);
        });
      });
      lanes.forEach((lane, laneIndex) => {
        cells.push(`<div class="lane-label" data-col="1" data-row="${laneIndex + 2}"><span>${esc(lane.repo)}</span><span class="c mono">${lane.count}</span></div>`);
      });
      const rowsTemplate = `repeat(${lanes.length + 1}, auto)`;
      return `<section class="sboard lanes" data-columns="${esc(["minmax(80px, 140px)", ...tracks].join(" "))}" data-rows="${esc(rowsTemplate)}">${cells.join("")}</section>`;
    },

    applyGrid() {
      for (const el of this.root.querySelectorAll("[data-columns]")) {
        el.style.gridTemplateColumns = el.getAttribute("data-columns");
        if (el.hasAttribute("data-rows")) el.style.gridTemplateRows = el.getAttribute("data-rows");
      }
      for (const el of this.root.querySelectorAll("[data-col]")) {
        el.style.gridColumn = el.getAttribute("data-col");
        el.style.gridRow = el.getAttribute("data-row");
      }
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
      const scrolls = [...this.root.querySelectorAll(".rows")].map((el) => el.scrollTop);
      const pageScroll = document.scrollingElement?.scrollTop ?? 0;

      this.root.innerHTML = `
        <div class="sessions-toolbar">
          <label class="search"><input id="session-search" type="search" placeholder="Search agents…" value="${esc(this.state.query)}" /><kbd>/</kbd></label>
          <button id="new-chat" class="primary">+ New chat</button>
          <button id="group-repo" class="icon${this.state.groupByRepo ? " on" : ""}" title="Group by repo (g)">⊞ by repo</button>
          <button id="refresh-sessions" class="icon" title="Refresh PR states">↻</button>
        </div>
        ${this.bulkBar()}
        ${this.statusLine()}
        ${this.renderBoard()}
        <footer class="keys"><kbd>/</kbd>search <kbd>j</kbd><kbd>k</kbd>move <kbd>↵</kbd>open <kbd>e</kbd>archive <kbd>x</kbd>select <kbd>${isMac ? "⌘" : "ctrl"}</kbd>+click multi-select <kbd>shift</kbd>+click range <kbd>esc</kbd>clear selection <kbd>n</kbd>new chat <kbd>g</kbd>group by repo</footer>
      `;

      this.applyGrid();
      // Size cards before restoring scroll, or the still-collapsed columns cap scrollTop near 0.
      this.root.querySelectorAll(".rows > .row").forEach(fitRow);
      this.root.querySelectorAll(".rows").forEach((el, i) => { el.scrollTop = scrolls[i] ?? 0; });
      if (document.scrollingElement) document.scrollingElement.scrollTop = pageScroll;
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
      for (const el of this.root.querySelectorAll("[data-action='rename-session']")) {
        el.addEventListener("dblclick", (event) => {
          event.stopPropagation();
          this.ctx.post({ type: "renameSession", sessionId: el.getAttribute("data-session-id") });
        });
      }
      for (const el of this.root.querySelectorAll("[data-action='open-pr']")) {
        el.addEventListener("click", (event) => {
          event.stopPropagation();
          this.ctx.openExternal(el.getAttribute("data-url"));
        });
      }
      for (const el of this.root.querySelectorAll("[data-action='toggle-done-prs']")) {
        el.addEventListener("click", (event) => {
          event.stopPropagation();
          const id = el.getAttribute("data-session-id");
          if (!this.state.showDonePrs.delete(id)) this.state.showDonePrs.add(id);
          this.render();
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
          if (event.target.closest("button, .chip")) return;
          if (event.metaKey || event.ctrlKey || event.shiftKey || this.state.picked.size) {
            if (event.shiftKey) window.getSelection()?.removeAllRanges();
            this.state.selected = id;
            this.pick(id, event.shiftKey);
            return;
          }
          this.selectRow(id);
          if (event.target.closest(".title")) return;
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
          this.requestSearch();
          this.render();
        });
      }
      this.root.querySelector("#new-chat")?.addEventListener("click", () => this.ctx.post({ type: "newChat" }));
      this.root.querySelector("#group-repo")?.addEventListener("click", () => this.toggleGroupByRepo());
      this.root.querySelector("#bulk-archive")?.addEventListener("click", () => this.archivePicked());
      this.root.querySelector("#bulk-unarchive")?.addEventListener("click", () => this.unarchivePicked());
      this.root.querySelector("#bulk-clear")?.addEventListener("click", () => this.clearPicked());
      this.root.querySelector("#bulk-all")?.addEventListener("click", () => {
        for (const row of this.visibleRows()) this.state.picked.add(row.getAttribute("data-session-id"));
        this.render();
      });
      this.root.querySelector("#refresh-sessions")?.addEventListener("click", () => this.ctx.post({ type: "refreshSessions" }));
    }
  });

  // Repos with a card waiting on you first, then the most recently active.
  function laneOrder(cards) {
    const lanes = new Map();
    for (const card of cards) {
      const lane = lanes.get(card.repo) || { repo: card.repo, count: 0, rank: SESSION_COLUMNS.length, latest: 0 };
      lane.count += 1;
      lane.rank = Math.min(lane.rank, SESSION_COLUMNS.findIndex(([id]) => id === card.column));
      lane.latest = Math.max(lane.latest, card.record.lastMessageAt || card.record.startedAt);
      lanes.set(card.repo, lane);
    }
    return [...lanes.values()].sort((a, b) => a.rank - b.rank || b.latest - a.latest);
  }

  function doneLabel(prs) {
    const merged = prs.filter((pr) => pr.state === "MERGED").length;
    const closed = prs.length - merged;
    return [merged ? `${merged} merged` : "", closed ? `${closed} closed` : ""].filter(Boolean).join(" · ");
  }

  function countByType(types) {
    const counts = new Map();
    for (const type of types) counts.set(type, (counts.get(type) || 0) + 1);
    return [...counts].map(([type, n]) => (n > 1 ? `${type} ×${n}` : type)).join(", ");
  }

  function tokens(n) {
    if (!n) return "0";
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
    return String(n);
  }

  function fitRow(row) {
    row.style.gridRowEnd = `span ${Math.ceil(row.offsetHeight) + 6}`;
  }

  function cssEscape(value) {
    return window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&");
  }
})();
