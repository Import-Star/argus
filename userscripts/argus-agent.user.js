// ==UserScript==
// @name         Argus: start an agent from this page
// @namespace    https://github.com/Import-Star/argus
// @version      0.1.0
// @description  Pick parts of a web page, add a message and start an Argus chat in VS Code with them.
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  // Use "vscode-insiders" for VS Code Insiders.
  const SCHEME = "vscode";
  const HTML_LIMIT = 2000;
  const TEXT_LIMIT = 400;

  const host = document.createElement("div");
  host.id = "argus-agent-host";
  host.style.cssText = "all: initial; position: fixed; z-index: 2147483647; inset: auto 0 0 auto;";
  const root = host.attachShadow({ mode: "open" });
  document.documentElement.appendChild(host);

  // Sites with a strict Content-Security-Policy block a <style> tag; a constructed sheet still applies.
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
      :host { --bg: #ffffff; --fg: #1f1f1e; --muted: #6b6a68; --line: #e3e1db; --accent: #c96442; --chip: #f4f2ec; }
      @media (prefers-color-scheme: dark) {
        :host { --bg: #262624; --fg: #f0eee6; --muted: #a6a39b; --line: #3d3d3a; --accent: #d97757; --chip: #30302e; }
      }
      * { box-sizing: border-box; font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .fab { position: fixed; right: 16px; bottom: 16px; width: 40px; height: 40px; border-radius: 50%; border: 0;
        background: var(--accent); color: #fff; font-weight: 600; cursor: pointer; box-shadow: 0 2px 10px rgba(0,0,0,.25); }
      .panel { position: fixed; right: 16px; bottom: 68px; width: 340px; max-width: calc(100vw - 32px); padding: 12px;
        background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 12px;
        box-shadow: 0 8px 30px rgba(0,0,0,.2); display: none; flex-direction: column; gap: 10px; }
      .panel.open { display: flex; }
      .row { display: flex; align-items: center; gap: 8px; }
      .title { font-weight: 600; flex: 1; }
      .muted { color: var(--muted); font-size: 12px; }
      button.btn { border: 1px solid var(--line); background: var(--chip); color: var(--fg); border-radius: 8px;
        padding: 5px 10px; cursor: pointer; }
      button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
      button.icon { border: 0; background: none; color: var(--muted); cursor: pointer; padding: 0 4px; font-size: 15px; }
      textarea, input[type=text] { width: 100%; border: 1px solid var(--line); background: var(--bg); color: var(--fg);
        border-radius: 8px; padding: 7px 8px; resize: vertical; }
      textarea { min-height: 80px; }
      .chips { display: flex; flex-direction: column; gap: 4px; max-height: 140px; overflow: auto; }
      .chip { display: flex; align-items: center; gap: 6px; background: var(--chip); border-radius: 6px; padding: 3px 6px; }
      .chip code { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 12px ui-monospace, Menlo, monospace; }
      .url { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
      .box { position: fixed; pointer-events: none; border: 2px solid var(--accent); background: rgba(217,119,87,.12);
        border-radius: 3px; display: none; }
      .tag { position: fixed; pointer-events: none; background: var(--accent); color: #fff; font: 11px ui-monospace, Menlo, monospace;
        padding: 1px 5px; border-radius: 3px; display: none; white-space: nowrap; }
      .hint { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); background: var(--fg); color: var(--bg);
        padding: 6px 12px; border-radius: 8px; display: none; }
      .grow { flex: 1; }`);
  root.adoptedStyleSheets = [sheet];

  root.innerHTML = `
    <div class="box"></div><div class="tag"></div>
    <div class="hint">Click an element to add it · Esc to cancel</div>
    <div class="panel">
      <div class="row"><span class="title">Start an Argus agent</span><button class="icon close" title="Close">✕</button></div>
      <div class="row"><button class="btn pick">Select UI</button><span class="muted count"></span></div>
      <div class="chips"></div>
      <label><input type="checkbox" class="with-url" checked><span class="url"></span></label>
      <textarea class="message" placeholder="What should the agent do?"></textarea>
      <input type="text" class="cwd" placeholder="Folder (blank = VS Code window's first folder)">
      <div class="row"><span class="muted grow">⌘/Ctrl+Enter to send</span><button class="btn primary send">Send to Argus</button></div>
    </div>
    <button class="fab" title="Start an Argus agent (Alt+Shift+A)">A</button>`;

  const $ = (selector) => root.querySelector(selector);
  const panel = $(".panel");
  const box = $(".box");
  const tag = $(".tag");
  const hint = $(".hint");
  const chips = $(".chips");
  const message = $(".message");
  const cwd = $(".cwd");
  const picked = [];
  let picking = false;
  let hovered = null;

  cwd.value = GM_getValue("cwd", "");

  function toggle(open = !panel.classList.contains("open")) {
    panel.classList.toggle("open", open);
    if (open) {
      $(".url").textContent = location.href;
      message.focus();
    } else {
      stopPicking();
    }
  }

  function selectorFor(el) {
    const parts = [];
    for (let node = el; node && node.nodeType === 1 && node !== document.documentElement; node = node.parentElement) {
      if (node.id) {
        parts.unshift(`#${CSS.escape(node.id)}`);
        break;
      }
      let part = node.localName;
      const siblings = node.parentElement ? [...node.parentElement.children].filter((s) => s.localName === node.localName) : [];
      if (siblings.length > 1) {
        part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      }
      parts.unshift(part);
    }
    return parts.join(" > ");
  }

  function label(el) {
    const cls = [...el.classList].slice(0, 2).map((c) => `.${c}`).join("");
    return `${el.localName}${el.id ? `#${el.id}` : ""}${cls}`;
  }

  function renderChips() {
    chips.replaceChildren(...picked.map((el, index) => {
      const chip = document.createElement("div");
      chip.className = "chip";
      const code = document.createElement("code");
      code.textContent = label(el);
      code.title = selectorFor(el);
      const remove = document.createElement("button");
      remove.className = "icon";
      remove.textContent = "✕";
      remove.onclick = () => { picked.splice(index, 1); renderChips(); };
      chip.append(code, remove);
      return chip;
    }));
    $(".count").textContent = picked.length ? `${picked.length} selected` : "";
  }

  function highlight(el) {
    const rect = el.getBoundingClientRect();
    Object.assign(box.style, { display: "block", top: `${rect.top}px`, left: `${rect.left}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    tag.textContent = `${label(el)}  ${Math.round(rect.width)}×${Math.round(rect.height)}`;
    Object.assign(tag.style, { display: "block", top: `${Math.max(0, rect.top - 18)}px`, left: `${Math.max(0, rect.left)}px` });
  }

  function onMove(event) {
    const el = document.elementFromPoint(event.clientX, event.clientY);
    if (!el || el === host || el === hovered) {
      return;
    }
    hovered = el;
    highlight(el);
  }

  function onClick(event) {
    if (event.composedPath().includes(host)) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (hovered && !picked.includes(hovered)) {
      picked.push(hovered);
      renderChips();
    }
    stopPicking();
  }

  function onKey(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      stopPicking();
    }
  }

  function startPicking() {
    picking = true;
    hint.style.display = "block";
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
  }

  function stopPicking() {
    if (!picking) {
      return;
    }
    picking = false;
    hovered = null;
    box.style.display = tag.style.display = hint.style.display = "none";
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
  }

  function clip(text, limit) {
    return text.length > limit ? `${text.slice(0, limit)}… (cut, ${text.length} chars)` : text;
  }

  function buildPrompt() {
    const parts = [message.value.trim()];
    if ($(".with-url").checked) {
      parts.push(`Page: ${document.title}\nURL: ${location.href}`);
    }
    picked.forEach((el, index) => {
      const text = clip((el.innerText || "").replace(/\s+/g, " ").trim(), TEXT_LIMIT);
      parts.push([
        `Selected element ${index + 1}: ${selectorFor(el)}`,
        text && `Text: ${text}`,
        "HTML:",
        "```html",
        clip(el.outerHTML, HTML_LIMIT),
        "```"
      ].filter(Boolean).join("\n"));
    });
    return parts.filter(Boolean).join("\n\n");
  }

  function send() {
    const prompt = buildPrompt();
    if (!prompt) {
      message.focus();
      return;
    }
    GM_setValue("cwd", cwd.value.trim());
    // VS Code decodes the link once before Argus reads it, so encode twice or "&" and "+" in the text break it.
    const encode = (value) => encodeURIComponent(encodeURIComponent(value));
    const query = [`prompt=${encode(prompt)}`, cwd.value.trim() && `cwd=${encode(cwd.value.trim())}`].filter(Boolean).join("&");
    location.assign(`${SCHEME}://importstar.argus-control-center/new-agent?${query}`);
    message.value = "";
    picked.length = 0;
    renderChips();
    toggle(false);
  }

  $(".fab").onclick = () => toggle();
  $(".close").onclick = () => toggle(false);
  $(".pick").onclick = startPicking;
  $(".send").onclick = send;
  message.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      send();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.altKey && event.shiftKey && event.code === "KeyA") {
      event.preventDefault();
      toggle();
    }
  });
  GM_registerMenuCommand("Start an Argus agent", () => toggle(true));
})();
