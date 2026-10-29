// The Sessions tab: registered like any plugin tab through window.argus.registerTab. Ported from the old
// combined app.js; kanban-card-specific rendering is gone (a plugin now shows its own session chips instead).
(function () {
  const SESSION_COLUMNS = [
    ["needs-you", "Needs you"],
    ["working", "Working"],
    ["scheduled", "Scheduled"],
    ["idle", "Idle"],
    ["pr-open", "PR open"],
    ["archived", "Archived"]
  ];

  // Columns shown as a strip until clicked open, with the state key that remembers it.
  const RECOMMENDED = /\s*\(recommended\)\s*$/i;
  const FOLDED = { scheduled: "showScheduled", archived: "showArchived" };
  const TIMER_GLYPH = { wakeup: "⏰", cron: "⏰", command: "⧗", monitor: "⧗", agent: "⑂" };

  const isMac = /Mac/.test(navigator.platform || navigator.userAgent);

  window.argus.registerTab("sessions", {
    mount(root, ctx) {
      this.root = root;
      this.ctx = ctx;
      const saved = ctx.getState() || {};
      this.state = {
        cards: [],
        // Cards that share one board card: { id, members (session ids, first is the lead), column, summary }.
        groups: [],
        archiving: new Set(),
        refreshedAt: undefined,
        refreshing: false,
        tracking: "",
        query: saved.query || "",
        selected: undefined,
        // Sessions picked for a bulk action (ctrl/cmd-click, shift-click or x), and the last one picked.
        picked: new Set(),
        anchor: undefined,
        showArchived: Boolean(saved.showArchived),
        showScheduled: Boolean(saved.showScheduled),
        groupByRepo: Boolean(saved.groupByRepo),
        // Sessions whose merged and closed PRs are shown.
        showDonePrs: new Set(),
        // Sessions whose transcript matches the query, with a snippet. Filled by the extension.
        deep: {},
        // Whether Argus chat has loaded, and the answers picked for pending AskUserQuestion requests (key: session|request|question index).
        chat: false,
        multiAgent: false,
        answers: {}
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
        this.state.groups = Array.isArray(message.groups) ? message.groups : [];
        this.state.refreshedAt = message.refreshedAt;
        this.state.refreshing = Boolean(message.refreshing);
        this.state.archiving = new Set(message.archiving || []);
        this.state.chat = Boolean(message.chat);
        this.state.multiAgent = Boolean(message.multiAgent);
        this.state.tracking = typeof message.tracking === "string" ? message.tracking : "";
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
        this.openCard(selected);
      } else if (event.key === "x" && selected) {
        this.pick(selected, false);
      } else if (event.key === "e" && this.state.picked.size) {
        this.archivePicked();
      } else if (event.key === "e" && selected) {
        this.archiveCard(selected);
      }
    },

    // One entry per board card: a group's members share one, everything else stands alone.
    items() {
      const byId = new Map(this.state.cards.map((card) => [card.record.sessionId, card]));
      const grouped = new Set();
      const items = [];
      for (const group of this.state.groups) {
        const members = group.members.map((id) => byId.get(id)).filter(Boolean);
        if (members.length < 2) continue;
        members.forEach((member) => grouped.add(member.record.sessionId));
        const current = members.filter((member) => member.column === group.column);
        items.push({ lead: members[0], members, column: group.column, summary: group.summary, since: Math.min(...current.map((member) => member.record.stateSince)), latest: Math.max(...members.map(latestOf)) });
      }
      for (const card of this.state.cards) {
        if (!grouped.has(card.record.sessionId)) items.push({ lead: card, members: [card], column: card.column, since: card.record.stateSince, latest: latestOf(card) });
      }
      for (const item of items) item.repo = item.lead.repo;
      return items.sort((a, b) => b.latest - a.latest);
    },

    // The cards behind a row: all of a group's members, or just the card.
    membersOf(sessionId) {
      const group = this.state.groups.find((entry) => entry.members[0] === sessionId);
      const ids = group ? group.members : [sessionId];
      return this.state.cards.filter((card) => ids.includes(card.record.sessionId));
    },

    openCard(sessionId) {
      const group = this.state.groups.find((entry) => entry.members[0] === sessionId);
      const live = group ? this.membersOf(sessionId).filter((card) => card.column !== "archived").map((card) => card.record.sessionId) : [];
      const ids = live.length ? live : group ? group.members : [];
      if (this.state.multiAgent && ids.length > 1) {
        this.ctx.post({ type: "openGrid", sessionIds: ids, groupId: group.id });
      } else {
        this.ctx.openSession(ids[0] || sessionId);
      }
    },

    archiveCard(sessionId) {
      const sessionIds = this.membersOf(sessionId).filter((card) => card.column !== "archived" && !this.state.archiving.has(card.record.sessionId)).map((card) => card.record.sessionId);
      if (sessionIds.length) this.ctx.post({ type: "archiveSessions", sessionIds });
    },

    unarchiveCard(sessionId) {
      const sessionIds = this.membersOf(sessionId).filter((card) => card.column === "archived").map((card) => card.record.sessionId);
      if (sessionIds.length) this.ctx.post({ type: "unarchiveSessions", sessionIds });
    },

    readCard(sessionId) {
      for (const card of this.membersOf(sessionId)) {
        if (card.column === "needs-you" && card.record.state === "done") this.ctx.post({ type: "markSessionRead", sessionId: card.record.sessionId });
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
      const ids = new Set([...this.state.picked].flatMap((id) => this.membersOf(id).map((card) => card.record.sessionId)));
      return this.state.cards.filter((card) => ids.has(card.record.sessionId));
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
      this.ctx.setState({ query: this.state.query, showArchived: this.state.showArchived, showScheduled: this.state.showScheduled, groupByRepo: this.state.groupByRepo });
    },

    toggleGroupByRepo() {
      this.state.groupByRepo = !this.state.groupByRepo;
      this.persist();
      this.render();
    },

    itemVisible(item) {
      return item.members.some((member) => this.isVisible(member));
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

    timerChip(timer) {
      const { esc } = this.ctx;
      const when = timer.at && timer.at > Date.now()
        ? ` <span class="t" data-until="${esc(timer.at)}">${esc(this.ctx.remaining(timer.at))}</span>`
        : timer.schedule ? ` ${esc(timer.schedule)}` : "";
      const title = `${timer.kind}${timer.schedule ? ` (${timer.schedule})` : ""}: ${timer.label}`;
      return `<span class="chip timer" title="${esc(title)}">${TIMER_GLYPH[timer.kind] || "⧗"}${when} · ${esc(timer.label || timer.kind)}</span>`;
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

    promptFor(card) {
      const { esc } = this.ctx;
      const r = card.record;
      const pendingTool = r.state === "question" ? "AskUserQuestion" : (r.pending || "").split(" ")[0];
      const pendingArgs = r.state === "question" ? r.pending : (r.pending || "").slice(pendingTool.length + 1);
      if (card.pending && card.pending.length) return this.renderPending(card);
      return r.pending
        ? `<div class="prompt mono">${esc(pendingTool)}${r.state === "question" ? "" : `(${esc(pendingArgs)})`}<div class="q">${r.state === "question" ? esc(pendingArgs) : "Waiting for approval"}</div></div>`
        : "";
    },

    agentRow(card) {
      const { esc } = this.ctx;
      const r = card.record;
      const activity = card.column === "working" && r.lastTool ? r.lastTool : r.pending ? `waiting · ${r.pending.split(" ")[0]}` : this.stateLabel(card);
      return `<button class="agent col-${esc(card.column)}" data-action="open-session" data-session-id="${esc(r.sessionId)}" title="Open this agent">${this.glyphFor(card)}<span class="agent-title">${esc(r.title || "New chat")}</span><span class="agent-act mono">${esc(activity)}</span></button>`;
    },

    renderAgents(item) {
      const { esc } = this.ctx;
      const pending = item.members
        .map((member) => ({ member, prompt: this.promptFor(member) }))
        .filter((entry) => entry.prompt)
        .map(({ member, prompt }) => `<div class="agent-pending"><div class="agent-who mono">${esc(member.record.title || "New chat")}</div>${prompt}</div>`)
        .join("");
      return `<div class="agents"><div class="agents-head mono">${item.members.length} agents · ${esc(item.summary)}</div>${item.members.map((member) => this.agentRow(member)).join("")}</div>${pending}`;
    },

    renderCard(item) {
      const { esc } = this.ctx;
      const card = item.lead;
      const grouped = item.members.length > 1;
      const driver = item.members.find((member) => member.column === item.column) || card;
      const r = card.record;
      const id = esc(r.sessionId);
      const where = card.worktree ? `${card.repo} / ${card.worktree}` : card.repo;
      const working = item.column === "working";
      const archiving = item.members.some((member) => this.state.archiving.has(member.record.sessionId));
      const prompt = grouped ? "" : this.promptFor(card);
      const activity = !grouped && r.state === "working" && r.lastTool ? `<div class="activity mono">⎿ ${esc(r.lastTool)}</div>` : "";
      const agents = !grouped && card.open ? Object.values(r.subagents || {}) : [];
      const agentLine = agents.length ? `<div class="activity mono">⑂ ${agents.length} agent${agents.length > 1 ? "s" : ""} running · ${esc(countByType(agents))}</div>` : "";
      const hit = this.state.query.trim() ? this.state.deep[r.sessionId] : undefined;
      const last = hit
        ? `<div class="last hit">${esc(hit)}</div>`
        : !grouped && !r.pending && !working && r.lastMessage && card.column !== "archived" ? `<div class="last">${esc(r.lastMessage.replace(/\*\*|__|`|^#+\s*/g, ""))}</div>` : "";
      const prs = uniqueBy(item.members.flatMap((member) => member.prs), (pr) => pr.url);
      const done = prs.filter((pr) => pr.state === "MERGED" || pr.state === "CLOSED");
      const showDone = this.state.showDonePrs.has(r.sessionId);
      const chips = [
        ...prs.filter((pr) => showDone || !done.includes(pr)).map((pr) => this.prChip(pr)),
        done.length ? `<button class="chip" data-action="toggle-done-prs" data-session-id="${id}" title="Show or hide merged and closed PRs">${showDone ? "hide" : "+"} ${esc(doneLabel(done))}</button>` : "",
        ...uniqueBy(item.members.flatMap((member) => member.record.worktrees || []), (folder) => folder).map((folder) => `<button class="chip wt" data-action="open-worktree" data-folder="${esc(folder)}" title="Open ${esc(folder)}">⎇ ${esc(folder.split("/").pop())}</button>`),
        ...item.members.flatMap((member) => member.timers || []).map((timer) => this.timerChip(timer)),
        ...item.members.flatMap((member) => member.chips.map((chip, index) => `<button class="chip" data-action="chip" data-session-id="${esc(member.record.sessionId)}" data-index="${index}" title="${esc(chip.tooltip || chip.text)}">${esc(chip.text)}</button>`))
      ].join("");
      const unread = item.members.some((member) => member.column === "needs-you" && member.record.state === "done");
      const actions = [
        `<button data-action="open-card" data-session-id="${id}">open ↵</button>`,
        !grouped && this.state.multiAgent && card.column !== "archived" ? `<button data-action="add-to-grid" data-session-id="${id}" title="Show this chat in the side-by-side grid">add to grid</button>` : "",
        unread ? `<button data-action="read-session" data-session-id="${id}">read</button>` : "",
        item.column === "archived"
          ? `<button data-action="unarchive-session" data-session-id="${id}">unarchive</button>`
          : archiving
            ? `<button disabled><span class="spinner"></span>archiving…</button>`
            : `<button data-action="archive-session" data-session-id="${id}">archive e</button>`
      ].join("");
      const state = grouped ? SESSION_COLUMNS.find(([column]) => column === item.column)[1].toLowerCase() : this.stateLabel(card);
      return `
        <article class="row col-${esc(item.column)}${working ? " working" : ""}${grouped ? " group" : ""}${archiving ? " archiving" : ""}${this.state.selected === r.sessionId ? " selected" : ""}${this.state.picked.has(r.sessionId) ? " picked" : ""}" data-session-id="${id}">
          <div class="l1">${this.glyphFor(driver)}<span class="title" data-action="rename-session" data-session-id="${id}" title="Double-click to rename">${esc(r.title || "New chat")}</span><span class="t mono" data-since="${item.since}" data-precise="${working}">${esc(working ? this.ctx.elapsedPrecise(item.since) : this.ctx.elapsed(item.since))}</span></div>
          <div class="l2 mono"><span class="where"><span class="state">${esc(state)}</span> · ${esc(where)}${!grouped && card.name && card.open && card.name !== r.title ? ` · ${esc(card.name)}` : ""}</span><div class="actions">${actions}</div></div>
          ${grouped ? this.renderAgents(item) : prompt}${activity}${agentLine}${last}
          ${chips ? `<div class="chips mono">${chips}</div>` : ""}
          
        </article>`;
    },

    renderPending(card) {
      const { esc } = this.ctx;
      const sid = esc(card.record.sessionId);
      return card.pending.map((req) => {
        const ids = `data-session-id="${sid}" data-request-id="${esc(req.id)}"`;
        const open = `<button data-action="open-session" data-session-id="${sid}">Open chat</button>`;
        if (req.questions && req.questions.length) {
          const questions = req.questions.map((q, qi) => this.renderQuestion(card.record.sessionId, req.id, q, qi, req.questions.length)).join("");
          const ready = req.questions.every((q, qi) => this.pickedAnswer(card.record.sessionId, req.id, q, qi));
          return `<div class="pending question" ${ids}>${questions}<div class="pending-actions"><button class="primary" data-action="chat-answer" ${ids}${ready ? "" : " disabled"}>Send answer</button>${open}</div></div>`;
        }
        if (req.toolName === "ExitPlanMode") {
          return `<div class="pending"><div class="pending-title">Plan ready for approval</div><div class="pending-actions">${open}</div></div>`;
        }
        const always = req.alwaysLabel ? `<button data-action="chat-always" ${ids} title="${esc(`Remember ${req.alwaysLabel}`)}">Always allow</button>` : "";
        return `<div class="pending"><div class="pending-title">${esc(req.toolName)}</div>${req.summary ? `<div class="pending-code mono">${esc(req.summary)}</div>` : ""}
          <div class="pending-actions"><button class="primary" data-action="chat-allow" ${ids}>Allow once</button>${always}<button data-action="chat-deny" ${ids}>Deny</button>${open}</div></div>`;
      }).join("");
    },

    renderQuestion(sessionId, requestId, q, qi, total) {
      const { esc } = this.ctx;
      const key = `${sessionId}|${requestId}|${qi}`;
      const chosen = this.state.answers[key] || [];
      const type = q.multiSelect ? "checkbox" : "radio";
      const count = total > 1 ? `<span class="pending-count">${qi + 1} of ${total}</span>` : "";
      const options = q.options.map((option) => {
        const on = chosen.includes(option.label);
        const recommended = RECOMMENDED.test(option.label);
        const tag = recommended ? `<span class="pending-rec">Recommended</span>` : "";
        return `<label class="pending-opt${on ? " on" : ""}"${option.description ? ` title="${esc(option.description)}"` : ""}><input type="${type}" name="${esc(key)}" value="${esc(option.label)}" data-answer-key="${esc(key)}"${on ? " checked" : ""} />${esc(option.label.replace(RECOMMENDED, ""))}${tag}</label>`;
      }).join("");
      return `<fieldset class="pending-q"><legend>${esc(q.question)}${count}</legend><div class="pending-opts">${options}</div></fieldset>`;
    },

    pickedAnswer(sessionId, requestId, q, qi) {
      const chosen = this.state.answers[`${sessionId}|${requestId}|${qi}`] || [];
      return chosen.filter((label) => q.options.some((option) => option.label === label)).join(", ");
    },

    respond(sessionId, id, decision) {
      const card = this.state.cards.find((entry) => entry.record.sessionId === sessionId);
      const req = card && (card.pending || []).find((entry) => entry.id === id);
      if (!req) return;
      const message = { type: "chatRespond", sessionId, id, decision };
      if (decision === "allow" && req.questions && req.questions.length) {
        message.answers = {};
        for (const [qi, q] of req.questions.entries()) {
          const answer = this.pickedAnswer(sessionId, id, q, qi);
          if (!answer) return;
          message.answers[q.question] = answer;
        }
      }
      this.ctx.post(message);
    },

    // Grid sizes go in data attributes because the CSP blocks inline style attributes; applyGrid() sets them.
    renderBoard() {
      const { esc } = this.ctx;
      const searching = this.state.query.trim() !== "";
      const items = this.items();
      const columns = SESSION_COLUMNS.map(([id, name]) => {
        const cards = items.filter((item) => item.column === id && this.itemVisible(item));
        const hidden = id in FOLDED && !this.state[FOLDED[id]] && !(searching && cards.length > 0);
        return { id, name, cards, collapsed: cards.length === 0 || hidden };
      });
      const tracks = columns.map((col) => (col.collapsed ? "36px" : "minmax(0, 1fr)"));
      const rail = (col) => `<div class="rail${col.id in FOLDED ? " clickable" : ""}" data-rail="${esc(col.id)}">${esc(col.name)} · ${col.cards.length}</div>`;
      const heading = (col) =>
        `<h2>${esc(col.name)}${col.id in FOLDED && this.state[FOLDED[col.id]] ? ` <button class="link" data-rail="${esc(col.id)}">hide</button>` : ""}<span class="c mono">${col.cards.length}</span></h2>`;
      const rows = (cards, extra = "") => `<div class="rows${extra}">${cards.map((item) => this.renderCard(item)).join("")}</div>`;

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
          const cards = col.cards.filter((item) => item.repo === lane.repo);
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
      const items = this.items();
      const count = (column) => items.filter((item) => item.column === column).length;
      const waiting = items.filter((item) => item.column === "needs-you");
      const oldest = waiting.length ? Math.min(...waiting.map((item) => item.since)) : undefined;
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
          <button id="refresh-sessions" class="icon${this.state.refreshing ? " refreshing" : ""}" title="${this.state.refreshing ? "Refreshing PR states…" : "Refresh PR states"}" aria-busy="${this.state.refreshing}" ${this.state.refreshing ? "disabled" : ""}><span class="refresh-glyph">↻</span></button>
        </div>
        ${this.state.tracking ? `<div class="tracking-notice" role="status"><span>⚠ ${esc(this.state.tracking)}</span><button id="set-up-tracking" class="primary">Set Up Session Tracking</button></div>` : ""}
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
        "open-card": () => (sessionId) => this.openCard(sessionId),
        "read-session": () => (sessionId) => this.readCard(sessionId),
        "archive-session": () => (sessionId) => this.archiveCard(sessionId),
        "unarchive-session": () => (sessionId) => this.unarchiveCard(sessionId),
        "add-to-grid": () => (sessionId) => this.ctx.post({ type: "addToGrid", sessionId })
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
      const decisions = { "chat-allow": "allow", "chat-always": "always", "chat-deny": "deny" };
      for (const [action, decision] of Object.entries(decisions)) {
        for (const el of this.root.querySelectorAll(`[data-action='${action}']`)) {
          el.addEventListener("click", (event) => {
            event.stopPropagation();
            this.respond(el.getAttribute("data-session-id"), el.getAttribute("data-request-id"), decision);
          });
        }
      }
      for (const el of this.root.querySelectorAll("[data-action='chat-answer']")) {
        el.addEventListener("click", (event) => {
          event.stopPropagation();
          this.respond(el.getAttribute("data-session-id"), el.getAttribute("data-request-id"), "allow");
        });
      }
      for (const el of this.root.querySelectorAll("input[data-answer-key]")) {
        el.addEventListener("change", () => {
          const key = el.getAttribute("data-answer-key");
          const group = [...this.root.querySelectorAll("input[data-answer-key]")].filter((input) => input.getAttribute("data-answer-key") === key && input.checked);
          this.state.answers[key] = group.map((input) => input.value);
          const pending = el.closest(".pending");
          for (const label of pending.querySelectorAll(".pending-opt")) label.classList.toggle("on", label.querySelector("input").checked);
          const send = pending.querySelector("[data-action='chat-answer']");
          if (send) send.disabled = ![...pending.querySelectorAll(".pending-q")].every((set) => set.querySelector("input:checked"));
        });
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
          if (event.target.closest("button, .chip, .pending")) return;
          if (event.metaKey || event.ctrlKey || event.shiftKey || this.state.picked.size) {
            if (event.shiftKey) window.getSelection()?.removeAllRanges();
            this.state.selected = id;
            this.pick(id, event.shiftKey);
            return;
          }
          this.selectRow(id);
          if (event.target.closest(".title")) return;
          this.openCard(id);
        });
      }
      for (const el of this.root.querySelectorAll("[data-rail]")) {
        const key = FOLDED[el.getAttribute("data-rail")];
        if (!key) continue;
        el.addEventListener("click", () => {
          this.state[key] = !this.state[key];
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
      this.root.querySelector("#set-up-tracking")?.addEventListener("click", () => this.ctx.post({ type: "setUpTracking" }));
    }
  });

  // Repos with a card waiting on you first, then the most recently active.
  function laneOrder(items) {
    const lanes = new Map();
    for (const item of items) {
      const lane = lanes.get(item.repo) || { repo: item.repo, count: 0, rank: SESSION_COLUMNS.length, latest: 0 };
      lane.count += 1;
      lane.rank = Math.min(lane.rank, SESSION_COLUMNS.findIndex(([id]) => id === item.column));
      lane.latest = Math.max(lane.latest, item.latest);
      lanes.set(item.repo, lane);
    }
    return [...lanes.values()].sort((a, b) => a.rank - b.rank || b.latest - a.latest);
  }

  function latestOf(card) {
    return card.record.lastMessageAt || card.record.startedAt;
  }

  function uniqueBy(list, key) {
    const seen = new Set();
    return list.filter((entry) => !seen.has(key(entry)) && seen.add(key(entry)));
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

  function fitRow(row) {
    row.style.gridRowEnd = `span ${Math.ceil(row.offsetHeight) + 6}`;
  }

  function cssEscape(value) {
    return window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&");
  }
})();
