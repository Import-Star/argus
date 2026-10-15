(function () {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById("app");
  const SCOPES = ["all", "committed", "staged", "unstaged"];
  const LARGE_FILE_ROWS = 400;

  const state = {
    result: null,
    error: null,
    draft: { comments: [], note: "" },
    canSend: false,
    selection: null, // { file, from, to } row indexes within one file
    pendingText: "",
    editing: null, // comment id
    expanded: new Set(),
    gaps: new Set(), // "<path>#<gap index>" expanded
    lines: new Map(), // path -> new-side file lines, loaded on first expand
    pendingGap: null,
    collapsed: new Set(),
    flash: ""
  };

  const esc = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  // Hunks plus the unchanged lines between them: a "gap" row until expanded, then context rows from the file.
  function rowsOf(file) {
    const rows = [];
    const lines = state.lines.get(file.path);
    const canExpand = file.status !== "deleted" && file.status !== "added";
    let nextNew = 1;
    file.hunks.forEach((hunk, h) => {
      const m = hunk.header.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)/);
      const start = Math.max(Number(m[2]), 1);
      const offset = Number(m[1]) - Number(m[2]);
      const open = addGap(rows, file, h, nextNew, start - 1, offset, lines, canExpand);
      hunk.lines.forEach((line, i) => rows.push({ ...line, hunk: i === 0 && !open ? hunk.header : null }));
      const last = [...hunk.lines].reverse().find((l) => l.new != null);
      nextNew = last ? last.new + 1 : start;
      if (h === file.hunks.length - 1) {
        const lastOld = [...hunk.lines].reverse().find((l) => l.old != null);
        const tailOffset = lastOld && last ? lastOld.old - last.new : offset;
        addGap(rows, file, h + 1, nextNew, lines ? lines.length : Infinity, tailOffset, lines, canExpand);
      }
    });
    return rows;
  }

  function addGap(rows, file, g, from, to, offset, lines, canExpand) {
    if (!canExpand || to < from) return false;
    if (lines && state.gaps.has(`${file.path}#${g}`)) {
      for (let n = from; n <= Math.min(to, lines.length); n++) rows.push({ type: "ctx", old: n + offset, new: n, text: lines[n - 1] });
      return true;
    }
    if (!lines || to <= lines.length) rows.push({ type: "gap", g, count: to === Infinity ? null : to - from + 1 });
    return false;
  }

  const anchorOf = (row) => (row.new != null ? { side: "new", line: row.new } : { side: "old", line: row.old });
  const highlighted = new Map();
  function languageOf(path) {
    const ext = path.split("/").pop().split(".").pop().toLowerCase();
    return window.hljs && window.hljs.getLanguage(ext) ? ext : null;
  }

  // Line by line, so a construct spanning lines (block comment, template string) is only coloured on its first line.
  function highlight(text, lang) {
    if (!lang) return esc(text);
    const key = `${lang}\0${text}`;
    if (!highlighted.has(key)) highlighted.set(key, window.hljs.highlight(text, { language: lang, ignoreIllegals: true }).value);
    return highlighted.get(key);
  }

  const keyOf = (path, side, line) => `${path}|${side}|${line}`;

  function saveDraft() {
    vscode.postMessage({ type: "saveDraft", comments: state.draft.comments, note: state.draft.note });
  }

  function isCollapsed(file, rows) {
    if (state.collapsed.has(file.path)) return true;
    return rows.length > LARGE_FILE_ROWS && !state.expanded.has(file.path);
  }

  function renderHeader() {
    const r = state.result;
    const scopes = SCOPES.map(
      (s) => `<button class="scope${r.scope === s ? " on" : ""}" data-action="scope" data-scope="${s}">${s}</button>`
    ).join("");
    if (r.pr) {
      return `
        <div class="where mono"><b>PR #${esc(r.pr.number)}</b> <span class="ptitle">${esc(r.pr.title)}</span>
          <span class="muted">${esc(r.branch)} → ${esc(r.base)}</span></div>
        <button data-action="clear-pr" title="Back to the worktree diff">× worktree</button>
        <button data-action="refresh" title="Refresh">⟳</button>`;
    }
    return `
      <div class="where mono"><b>${esc(r.branch)}</b> <span class="muted">vs</span>
        <input class="base mono" data-role="base" value="${esc(r.base)}" title="Base ref; press Enter to apply" spellcheck="false">
        <span class="muted">@ ${esc(r.mergeBase.slice(0, 8))}</span></div>
      <input class="base mono" data-role="pr" placeholder="PR # or URL" title="Review a GitHub PR; press Enter" spellcheck="false">
      <div class="scopes">${scopes}</div>
      <button data-action="refresh" title="Refresh">⟳</button>`;
  }

  function renderSide() {
    const r = state.result;
    const { comments, note } = state.draft;
    const visible = new Set();
    for (const file of r.files) for (const row of rowsOf(file).filter((row) => row.type !== "gap")) {
      const a = anchorOf(row);
      visible.add(keyOf(file.path, a.side, a.line));
    }
    const files = r.files
      .map((file, f) => {
        const count = comments.filter((c) => c.path === file.path).length;
        const tags = file.tags.map((t) => `<span class="tag tag-${esc(t)}" title="${esc(t)}">${esc(t[0].toUpperCase())}</span>`).join("");
        return `<button class="file-link" data-action="goto-file" data-file="${f}" title="${esc(file.path)}">
          <span class="st st-${file.status}">${file.status[0].toUpperCase()}</span>
          <span class="fname">${esc(file.path)}</span>
          ${count ? `<span class="badge">${count}</span>` : ""}${tags}
          <span class="counts mono"><span class="plus">+${file.additions}</span> <span class="minus">−${file.deletions}</span></span>
        </button>`;
      })
      .join("");
    const list = comments
      .map(
        (c) => `<button class="comment-link" data-action="goto-comment" data-id="${esc(c.id)}">
          <span class="mono">${esc(c.path.split("/").pop())}:${esc(c.label)}</span>${visible.has(keyOf(c.path, c.side, c.line)) ? "" : ' <span class="muted">(not in this view)</span>'}
          <span class="cbody">${esc(c.body)}</span></button>`
      )
      .join("");
    const total = comments.length + (note.trim() ? 1 : 0);
    return `
      <div class="side-h">Files <span class="muted">${r.files.length}</span></div>
      <div class="files">${files || '<div class="empty">No changes in this scope.</div>'}</div>
      <div class="side-h">Comments <span class="muted">${comments.length}</span></div>
      <div class="comments">${list || '<div class="muted hint">Click a line number to comment. Shift-click to select a range.</div>'}</div>
      <textarea class="note" data-role="note" placeholder="General comment (optional)">${esc(note)}</textarea>
      ${state.flash ? `<div class="flash">${esc(state.flash)}</div>` : ""}
      <button class="primary send" data-action="send" ${total ? "" : "disabled"}>${state.canSend ? "Send to agent" : "Copy review"} (${comments.length})</button>`;
  }

  function renderComment(c) {
    if (state.editing === c.id) {
      return `<div class="thread"><textarea class="cinput" data-role="edit" data-id="${esc(c.id)}">${esc(c.body)}</textarea>
        <div class="cbtns"><button class="primary" data-action="save-edit" data-id="${esc(c.id)}">Save</button><button data-action="cancel">Cancel</button></div></div>`;
    }
    return `<div class="thread" id="c-${esc(c.id)}"><div class="chead mono">${esc(c.label)}
      <span class="cact"><button class="link" data-action="edit" data-id="${esc(c.id)}">edit</button><button class="link" data-action="delete" data-id="${esc(c.id)}">delete</button></span></div>
      <div class="cbody">${esc(c.body)}</div></div>`;
  }

  function renderFile(file, f) {
    const rows = rowsOf(file);
    const lang = languageOf(file.path);
    const byAnchor = new Map();
    for (const c of state.draft.comments.filter((c) => c.path === file.path)) {
      const k = keyOf(c.path, c.side, c.line);
      byAnchor.set(k, [...(byAnchor.get(k) || []), c]);
    }
    const sel = state.selection && state.selection.file === f ? state.selection : null;
    const collapsed = isCollapsed(file, rows);
    let body = "";
    if (file.binary) {
      body = '<div class="empty">Binary or large file, not shown.</div>';
    } else if (rows.length === 0) {
      body = '<div class="empty">No content changes.</div>';
    } else if (collapsed) {
      body = `<button class="link expand" data-action="expand" data-file="${f}">Show ${rows.length} lines</button>`;
    } else {
      body = rows
        .map((row, i) => {
          if (row.type === "gap") {
            return `<button class="gap mono" data-action="gap" data-file="${f}" data-gap="${row.g}">↕ ${row.count == null ? "Show rest of file" : `Show ${row.count} hidden line${row.count === 1 ? "" : "s"}`}</button>`;
          }
          const a = anchorOf(row);
          const selected = sel && i >= sel.from && i <= sel.to;
          const hunk = row.hunk ? `<div class="hunk mono">${esc(row.hunk)}</div>` : "";
          const threads = (byAnchor.get(keyOf(file.path, a.side, a.line)) || []).map(renderComment).join("");
          const form =
            sel && i === sel.to
              ? `<div class="thread new"><textarea class="cinput" data-role="new" placeholder="Comment for the agent (⌘↵ to save, Esc to cancel)">${esc(state.pendingText)}</textarea>
                 <div class="cbtns"><button class="primary" data-action="save-new">Comment</button><button data-action="cancel">Cancel</button></div></div>`
              : "";
          const sign = row.type === "add" ? "+" : row.type === "del" ? "−" : " ";
          return `${hunk}<div class="line ${row.type}${selected ? " sel" : ""}" data-file="${f}" data-row="${i}">
            <span class="ln" data-action="select">${row.old ?? ""}</span><span class="ln" data-action="select">${row.new ?? ""}</span><span class="sign">${sign}</span><span class="code">${highlight(row.text, lang)}</span></div>${threads}${form}`;
        })
        .join("");
    }
    const rename = file.oldPath ? `<span class="muted">${esc(file.oldPath)} → </span>` : "";
    return `<section class="file" id="f-${f}">
      <div class="fhead"><button class="link fold" data-action="toggle" data-file="${f}">${collapsed ? "▸" : "▾"}</button>
        <span class="mono">${rename}${esc(file.path)}</span>
        <span class="counts mono"><span class="plus">+${file.additions}</span> <span class="minus">−${file.deletions}</span></span>
        ${file.status === "deleted" || state.result.pr ? "" : `<button class="link" data-action="open-file" data-file="${f}">open</button>`}</div>
      <div class="fbody mono">${body}</div></section>`;
  }

  function render() {
    if (state.error) {
      app.innerHTML = `<div class="empty error">${esc(state.error.folder)}<br>${esc(state.error.message)}</div>${
        state.error.pr ? '<div class="empty"><button data-action="clear-pr">Back to the worktree diff</button></div>' : ""
      }`;
      return;
    }
    if (!state.result) return;
    if (!app.querySelector("main")) {
      app.innerHTML = '<header></header><div class="body"><aside></aside><main></main></div>';
    }
    const main = app.querySelector("main");
    const scroll = main.scrollTop;
    app.querySelector("header").innerHTML = renderHeader();
    app.querySelector("aside").innerHTML = renderSide();
    main.innerHTML = state.result.files.map(renderFile).join("") || '<div class="empty">No changes against the base in this scope.</div>';
    main.scrollTop = scroll;
    const input = app.querySelector("[data-role='new'], [data-role='edit']");
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  function selectedRows() {
    const file = state.result.files[state.selection.file];
    return { file, rows: rowsOf(file).slice(state.selection.from, state.selection.to + 1).filter((row) => row.type !== "gap") };
  }

  function addComment() {
    const body = state.pendingText.trim();
    if (!body || !state.selection) return;
    const { file, rows } = selectedRows();
    const last = anchorOf(rows[rows.length - 1]);
    const news = rows.filter((r) => r.new != null).map((r) => r.new);
    const nums = news.length ? news : rows.map((r) => r.old);
    const lo = Math.min(...nums);
    const hi = Math.max(...nums);
    const label = `${news.length ? "" : "old "}L${lo}${hi !== lo ? `-${hi}` : ""}`;
    state.draft.comments.push({
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      path: file.path,
      side: last.side,
      line: last.line,
      label,
      excerpt: rows.map((r) => (r.type === "add" ? "+" : r.type === "del" ? "-" : " ") + r.text),
      body
    });
    state.selection = null;
    state.pendingText = "";
    saveDraft();
    render();
  }

  function saveEdit(id) {
    const input = app.querySelector(`[data-role='edit'][data-id='${CSS.escape(id)}']`);
    const comment = state.draft.comments.find((c) => c.id === id);
    if (input && comment && input.value.trim()) {
      comment.body = input.value.trim();
      saveDraft();
    }
    state.editing = null;
    render();
  }

  function cancel() {
    state.selection = null;
    state.pendingText = "";
    state.editing = null;
    render();
  }

  app.addEventListener("click", (event) => {
    const el = event.target.closest("[data-action]");
    if (!el) return;
    const action = el.getAttribute("data-action");
    const fileIdx = Number(el.getAttribute("data-file"));
    const id = el.getAttribute("data-id");
    switch (action) {
      case "scope":
        state.selection = null;
        vscode.postMessage({ type: "setScope", scope: el.getAttribute("data-scope") });
        break;
      case "clear-pr":
        vscode.postMessage({ type: "setPr", pr: "" });
        break;
      case "refresh":
        vscode.postMessage({ type: "refresh" });
        break;
      case "select": {
        const line = el.closest(".line");
        const f = Number(line.getAttribute("data-file"));
        const row = Number(line.getAttribute("data-row"));
        const sel = state.selection;
        state.selection =
          event.shiftKey && sel && sel.file === f ? { file: f, from: Math.min(sel.from, row), to: Math.max(sel.to, row) } : { file: f, from: row, to: row };
        state.editing = null;
        render();
        break;
      }
      case "gap": {
        const file = state.result.files[fileIdx];
        const key = `${file.path}#${el.getAttribute("data-gap")}`;
        if (state.lines.has(file.path)) {
          state.gaps.add(key);
          state.selection = null;
          render();
        } else {
          state.pendingGap = key;
          vscode.postMessage({ type: "fileLines", path: file.path });
        }
        break;
      }
      case "save-new":
        addComment();
        break;
      case "cancel":
        cancel();
        break;
      case "edit":
        state.editing = id;
        render();
        break;
      case "save-edit":
        saveEdit(id);
        break;
      case "delete":
        state.draft.comments = state.draft.comments.filter((c) => c.id !== id);
        saveDraft();
        render();
        break;
      case "expand":
        state.expanded.add(state.result.files[fileIdx].path);
        render();
        break;
      case "toggle": {
        const file = state.result.files[fileIdx];
        if (isCollapsed(file, rowsOf(file))) {
          state.collapsed.delete(file.path);
          state.expanded.add(file.path);
        } else {
          state.expanded.delete(file.path);
          state.collapsed.add(file.path);
        }
        render();
        break;
      }
      case "open-file": {
        const file = state.result.files[fileIdx];
        const first = file.hunks[0] && file.hunks[0].lines.find((l) => l.type !== "ctx");
        vscode.postMessage({ type: "openFile", path: file.path, line: first ? first.new ?? first.old : 1 });
        break;
      }
      case "goto-file":
        document.getElementById(`f-${fileIdx}`)?.scrollIntoView({ block: "start" });
        break;
      case "goto-comment": {
        const comment = state.draft.comments.find((c) => c.id === id);
        const target = document.getElementById(`c-${id}`) || document.getElementById(`f-${state.result.files.findIndex((f) => f.path === comment?.path)}`);
        target?.scrollIntoView({ block: "center" });
        break;
      }
      case "send":
        vscode.postMessage({ type: "send" });
        break;
    }
  });

  let noteTimer;
  app.addEventListener("input", (event) => {
    const role = event.target.getAttribute("data-role");
    if (role === "new") state.pendingText = event.target.value;
    if (role === "note") {
      state.draft.note = event.target.value;
      clearTimeout(noteTimer);
      noteTimer = setTimeout(() => {
        saveDraft();
        const send = app.querySelector(".send");
        if (send) send.disabled = !(state.draft.comments.length || state.draft.note.trim());
      }, 300);
    }
  });

  app.addEventListener("keydown", (event) => {
    const role = event.target.getAttribute("data-role");
    if (role === "pr" && event.key === "Enter" && event.target.value.trim()) {
      vscode.postMessage({ type: "setPr", pr: event.target.value });
    } else if (role === "base" && event.key === "Enter") {
      vscode.postMessage({ type: "setBase", base: event.target.value });
    } else if ((role === "new" || role === "edit") && event.key === "Escape") {
      cancel();
    } else if (role === "new" && event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      addComment();
    } else if (role === "edit" && event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      saveEdit(event.target.getAttribute("data-id"));
    }
  });

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.type === "state") {
      const changedScope = !state.result || state.result.scope !== msg.result.scope;
      state.result = msg.result;
      state.error = null;
      state.draft = msg.draft;
      state.canSend = msg.canSend;
      if (changedScope) {
        state.lines.clear();
        state.gaps.clear();
        state.selection = null;
      }
      render();
    } else if (msg.type === "fileLines") {
      state.lines.set(msg.path, msg.lines);
      if (state.pendingGap) state.gaps.add(state.pendingGap);
      state.pendingGap = null;
      state.selection = null;
      render();
    } else if (msg.type === "error") {
      state.error = msg;
      state.result = null;
      render();
    } else if (msg.type === "sent") {
      state.draft = { comments: [], note: "" };
      state.flash = "Review copied to the clipboard. Paste it into the Claude session.";
      render();
      setTimeout(() => {
        state.flash = "";
        render();
      }, 6000);
    }
  });

  vscode.postMessage({ type: "ready" });
})();
