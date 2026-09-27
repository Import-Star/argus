(function () {
  const RUN_GLYPH = {
    success: '<span class="glyph ok">✓</span>',
    failure: '<span class="glyph bad">✗</span>',
    cancelled: '<span class="glyph">⊘</span>',
    skipped: '<span class="glyph">–</span>',
    timed_out: '<span class="glyph bad">⏱</span>',
    action_required: '<span class="glyph dot">⏸</span>'
  };

  const EVENT_LABEL = { workflow_dispatch: "manual", push: "push", pull_request: "PR", schedule: "schedule", workflow_run: "chained" };

  function runGlyph(run) {
    if (run.status === "waiting") return '<span class="glyph dot">⏸</span>';
    if (run.status === "in_progress") return '<span class="glyph spin">✻</span>';
    if (run.status === "queued" || run.status === "pending" || run.status === "requested") return '<span class="glyph">◌</span>';
    return RUN_GLYPH[run.conclusion] || '<span class="glyph">○</span>';
  }

  function runStateClass(run) {
    if (run.status === "waiting") return "r-waiting";
    if (run.status !== "completed") return "r-running";
    return `r-${run.conclusion || "done"}`;
  }

  window.argus.registerTab("actions", {
    mount(root, ctx) {
      this.root = root;
      this.ctx = ctx;
      root.setAttribute("data-tab-root", "actions");
      this.state = { repo: "", runs: [], approvals: [], workflows: [] };
      this.filter = "deploys";
      this.expanded = {};
      this.jobs = {};
      this.openWorkflow = undefined;
      this.forms = {};
      this.render();
      ctx.post({ type: "ready" });
    },

    onMessage(message) {
      if (!message || typeof message !== "object") {
        return;
      }
      if (message.type === "state") {
        this.state = message.state || this.state;
        this.render();
        return;
      }
      if (message.type === "jobs") {
        this.jobs[message.runId] = Array.isArray(message.jobs) ? message.jobs : [];
        this.render();
      }
    },

    onShow() {
      this.render();
    },

    send(type, payload) {
      this.ctx.post(Object.assign({ type }, payload || {}));
    },

    jobList(run) {
      const esc = this.ctx.esc;
      const jobs = this.jobs[run.id] || run.jobs;
      if (!jobs) return `<div class="a-jobs mono">loading jobs…</div>`;
      return `<div class="a-jobs mono">${jobs
        .map((job) => `<div class="a-job a-j-${esc(job.status === "completed" ? job.conclusion || "done" : job.status)}">${runGlyph(job)} ${esc(job.name)}</div>`)
        .join("")}</div>`;
    },

    renderRun(run) {
      const esc = this.ctx.esc;
      const running = run.status !== "completed";
      const since = Date.parse(running ? run.createdAt : run.updatedAt);
      const open = this.expanded[run.id];
      const actions = [
        `<button data-run-action="jobs" data-run-id="${run.id}">jobs ${open ? "▴" : "▾"}</button>`,
        `<button data-a-action="open-pr" data-url="${esc(run.url)}">github ↗</button>`,
        run.conclusion === "failure" ? `<button data-run-action="rerun" data-run-id="${run.id}">re-run failed</button>` : "",
        running ? `<button data-run-action="cancel" data-run-id="${run.id}">cancel</button>` : ""
      ].join("");
      const title = run.title && run.title !== run.name ? run.title : "";
      return `
        <article class="row a-run ${runStateClass(run)}" data-run-id="${run.id}">
          <div class="l1">${runGlyph(run)}<span class="title">${esc(run.name)}${run.app ? ` <span class="a-app mono">${esc(run.app)}</span>` : ""}</span><span class="t mono" data-since="${since}" data-precise="${running}">${esc(running ? this.ctx.elapsedPrecise(since) : this.ctx.elapsed(since))}</span></div>
          <div class="l2 mono">${esc(run.branch)} · ${esc(run.actor)} · ${esc(EVENT_LABEL[run.event] || run.event)}${run.attempt > 1 ? ` · attempt ${run.attempt}` : ""}${title ? ` · ${esc(title)}` : ""}</div>
          ${running && run.currentJob ? `<div class="activity mono">⎿ ${esc(run.currentJob)}</div>` : ""}
          ${open ? this.jobList(run) : ""}
          <div class="actions mono">${actions}</div>
        </article>`;
    },

    renderApproval(approval) {
      const esc = this.ctx.esc;
      const run = approval.run;
      const canApprove = approval.environments.some((env) => env.canApprove);
      const since = Date.parse(run.updatedAt);
      const envs = approval.environments
        .map((env) => `<span class="chip ${env.canApprove ? "a-env-can" : ""}" title="Reviewers: ${esc(env.reviewers.join(", "))}">${esc(env.name)}</span>`)
        .join("");
      return `
        <article class="row a-approval">
          <div class="l1"><span class="glyph dot">⏸</span><span class="title">${esc(run.name)}${run.app ? ` <span class="a-app mono">${esc(run.app)}</span>` : ""}</span><span class="t mono" data-since="${since}">${esc(this.ctx.elapsed(since))}</span></div>
          <div class="l2 mono">${esc(run.branch)} · ${esc(run.actor)}</div>
          ${approval.gates.map((gate) => `<div class="activity mono">⎿ ${esc(gate)}</div>`).join("")}
          <div class="chips mono">${envs}</div>
          <div class="a-approval-actions">
            ${canApprove
              ? `<button class="primary" data-review="approve" data-run-id="${run.id}">Approve</button><button data-review="reject" data-run-id="${run.id}">Reject</button>`
              : `<span class="muted mono">you're not a reviewer</span>`}
            <button data-a-action="open-pr" data-url="${esc(run.url)}">github ↗</button>
          </div>
        </article>`;
    },

    renderWorkflowForm(workflow) {
      const esc = this.ctx.esc;
      const form =
        this.forms[workflow.id] ||
        (this.forms[workflow.id] = {
          ref: "main",
          inputs: Object.fromEntries((workflow.inputs || []).map((i) => [i.name, i.default !== undefined ? i.default : i.type === "boolean" ? "false" : ""]))
        });
      const field = (input, index) => {
        const id = `wf-${workflow.id}-${index}`;
        const value = form.inputs[input.name] !== undefined ? form.inputs[input.name] : "";
        let control;
        if (input.type === "choice") {
          control = `<select id="${id}" data-wf="${workflow.id}" data-input="${esc(input.name)}">${(input.options || [])
            .map((o) => `<option ${o === value ? "selected" : ""}>${esc(o)}</option>`)
            .join("")}</select>`;
        } else if (input.type === "boolean") {
          control = `<input id="${id}" type="checkbox" data-wf="${workflow.id}" data-input="${esc(input.name)}" ${value === "true" ? "checked" : ""} />`;
        } else {
          control = `<input id="${id}" type="${input.type === "number" ? "number" : "text"}" data-wf="${workflow.id}" data-input="${esc(input.name)}" value="${esc(value)}" />`;
        }
        return `<label class="a-field ${input.type === "boolean" ? "a-inline" : ""}"><span class="a-fname mono">${esc(input.name)}${input.required ? " *" : ""}</span>${control}${input.description ? `<span class="a-fdesc">${esc(input.description)}</span>` : ""}</label>`;
      };
      const blocked = (workflow.inputs || []).some((i) => i.required && !form.inputs[i.name]);
      return `
        <div class="a-wf-form">
          <label class="a-field"><span class="a-fname mono">branch</span><input id="wf-${workflow.id}-ref" type="text" data-wf="${workflow.id}" data-input="__ref" value="${esc(form.ref)}" /></label>
          ${(workflow.inputs || []).map(field).join("")}
          <button class="primary" data-dispatch="${workflow.id}" ${blocked ? "disabled" : ""}>▶ Run ${esc(workflow.name)}</button>
        </div>`;
    },

    renderBoard() {
      const esc = this.ctx.esc;
      const a = this.state;
      const filters = {
        deploys: (r) => r.event === "workflow_dispatch",
        mine: (r) => r.actor === a.me,
        all: (r) => r.conclusion !== "skipped"
      };
      const runs = (a.runs || []).filter(filters[this.filter]).filter((r) => r.status !== "waiting").slice(0, 40);
      const chip = (id, label) => `<button class="a-fchip ${this.filter === id ? "on" : ""}" data-filter="${id}">${label}</button>`;
      const approvals = a.approvals || [];
      return `
        <section class="a-body">
          ${a.error ? `<div class="sync-error">${esc(a.error)}</div>` : ""}
          <section class="a-approvals">
            <h2>Awaiting approval <span class="a-c mono">${approvals.length}</span></h2>
            ${approvals.length ? `<div class="a-approval-grid">${approvals.map((x) => this.renderApproval(x)).join("")}</div>` : `<div class="empty-line mono">Nothing waiting for approval</div>`}
          </section>
          <div class="a-grid">
            <section class="a-runs-col">
              <h2>Runs <span class="a-filters">${chip("deploys", "Manual")}${chip("mine", "Mine")}${chip("all", "All")}</span><span class="a-c mono">${runs.length}</span></h2>
              <div class="a-run-list">${runs.map((r) => this.renderRun(r)).join("") || `<div class="empty-line mono">No runs</div>`}</div>
            </section>
            <aside class="a-wf-col">
              <h2>Run workflow</h2>
              ${(a.workflows || [])
                .map(
                  (w) => `
                <div class="a-wf ${this.openWorkflow === w.id ? "open" : ""}">
                  <button class="a-wf-head" data-open-wf="${w.id}"><span class="a-wf-name">${esc(w.name)}</span><span class="mono a-wf-file">${esc(w.file)}</span><span class="mono">${this.openWorkflow === w.id ? "▴" : "▸"}</span></button>
                  ${this.openWorkflow === w.id ? this.renderWorkflowForm(w) : ""}
                </div>`
                )
                .join("") || `<div class="empty-line mono">Loading workflows…</div>`}
            </aside>
          </div>
        </section>`;
    },

    statusLine() {
      const esc = this.ctx.esc;
      const a = this.state;
      const running = (a.runs || []).filter((r) => r.status === "in_progress" || r.status === "queued").length;
      const lastManual = (a.runs || []).find((r) => r.event === "workflow_dispatch" && r.status === "completed");
      const mine = (a.approvals || []).filter((x) => x.environments.some((e) => e.canApprove)).length;
      return `<div class="statusline mono"><span><span class="n">${mine}</span> awaiting your approval</span><span>${running} running</span>${
        lastManual
          ? `<span>last manual run ${esc(lastManual.app || lastManual.name)} ${lastManual.conclusion === "success" ? "✓" : "✗"} ${esc(this.ctx.elapsed(Date.parse(lastManual.updatedAt)))} ago</span>`
          : ""
      }<span class="right">${esc(a.repo || "")}${a.fetchedAt ? ` · updated <span class="t" data-since="${a.fetchedAt}">${esc(this.ctx.elapsed(a.fetchedAt))}</span> ago` : ""}</span></div>`;
    },

    render() {
      this.root.innerHTML = `
        <div class="a-toolbar">
          <span class="a-title">Actions</span>
          <button class="icon" id="a-refresh" title="Refresh">↻</button>
        </div>
        ${this.statusLine()}
        ${this.renderBoard()}
      `;
      this.bindEvents();
    },

    bindEvents() {
      const root = this.root;
      const send = (type, payload) => this.send(type, payload);

      root.querySelector("#a-refresh")?.addEventListener("click", () => send("actionsRefresh"));

      for (const el of root.querySelectorAll("[data-filter]")) {
        el.addEventListener("click", () => {
          this.filter = el.getAttribute("data-filter");
          this.render();
        });
      }

      for (const el of root.querySelectorAll("[data-run-action]")) {
        el.addEventListener("click", (event) => {
          event.stopPropagation();
          const runId = Number(el.getAttribute("data-run-id"));
          const action = el.getAttribute("data-run-action");
          if (action === "jobs") {
            this.expanded[runId] = !this.expanded[runId];
            if (this.expanded[runId]) send("loadJobs", { runId });
            this.render();
          } else if (action === "rerun") {
            send("rerunFailed", { runId });
          } else if (action === "cancel") {
            send("cancelRun", { runId });
          }
        });
      }

      for (const row of root.querySelectorAll(".a-run")) {
        row.addEventListener("click", (event) => {
          if (event.target.closest("button")) return;
          const runId = Number(row.getAttribute("data-run-id"));
          this.expanded[runId] = !this.expanded[runId];
          if (this.expanded[runId]) send("loadJobs", { runId });
          this.render();
        });
      }

      for (const el of root.querySelectorAll("[data-review]")) {
        el.addEventListener("click", () =>
          send("reviewRun", { runId: Number(el.getAttribute("data-run-id")), approve: el.getAttribute("data-review") === "approve" })
        );
      }

      for (const el of root.querySelectorAll("[data-open-wf]")) {
        el.addEventListener("click", () => {
          const id = Number(el.getAttribute("data-open-wf"));
          this.openWorkflow = this.openWorkflow === id ? undefined : id;
          this.render();
        });
      }

      for (const el of root.querySelectorAll("[data-wf][data-input]")) {
        el.addEventListener(el.tagName === "SELECT" || el.type === "checkbox" ? "change" : "input", () => {
          const form = this.forms[el.getAttribute("data-wf")];
          if (!form) return;
          const name = el.getAttribute("data-input");
          const value = el.type === "checkbox" ? String(el.checked) : el.value;
          if (name === "__ref") form.ref = value;
          else form.inputs[name] = value;
          this.render();
        });
      }

      for (const el of root.querySelectorAll("[data-dispatch]")) {
        el.addEventListener("click", () => {
          const id = Number(el.getAttribute("data-dispatch"));
          const form = this.forms[id];
          if (!form) return;
          send("dispatchWorkflow", { workflowId: id, ref: form.ref, inputs: form.inputs });
        });
      }

      for (const el of root.querySelectorAll("[data-a-action='open-pr']")) {
        el.addEventListener("click", () => this.ctx.openExternal(el.getAttribute("data-url")));
      }
    }
  });
})();
