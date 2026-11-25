// Argus search overlay, shared by the Control Center (a script tag) and Argus chat (bundled into its webview).
// The page calls init(post) once and hands host messages to onMessage; the overlay posts "search" and "searchOpen".
(function () {
  let post = () => {};
  let root;
  let input;
  let list;
  let results = [];
  let selected = 0;
  let pending = false;
  let timer;
  let returnFocus;

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function terms() {
    return input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  }

  // split() with a capturing group puts the matched terms at the odd indexes.
  function highlight(text, words) {
    const pattern = new RegExp(`(${words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
    return String(text)
      .split(pattern)
      .map((part, index) => (index % 2 ? `<mark>${esc(part)}</mark>` : esc(part)))
      .join("");
  }

  function build() {
    root = document.createElement("div");
    root.className = "argus-search";
    root.hidden = true;
    root.innerHTML = `<div class="argus-search-box" role="dialog" aria-label="Search"><input type="text" placeholder="Search chats and plugins…" spellcheck="false" /><div class="argus-search-results" role="listbox"></div></div>`;
    document.body.appendChild(root);
    input = root.querySelector("input");
    list = root.querySelector(".argus-search-results");
    root.addEventListener("mousedown", (event) => {
      if (event.target === root) close();
    });
    input.addEventListener("input", () => {
      clearTimeout(timer);
      pending = terms().length > 0;
      timer = setTimeout(request, 150);
    });
    input.addEventListener("keydown", onKeydown);
    list.addEventListener("click", (event) => {
      const row = event.target.closest("[data-index]");
      if (row) pick(Number(row.getAttribute("data-index")));
    });
  }

  function request() {
    const query = input.value.trim();
    if (query) {
      post({ type: "search", query });
    } else {
      results = [];
      render();
    }
  }

  function render() {
    const words = terms();
    if (!words.length || (pending && !results.length)) {
      list.innerHTML = `<div class="argus-search-note">${words.length ? "Searching…" : "Search chats and plugin items"}</div>`;
      return;
    }
    if (!results.length) {
      list.innerHTML = `<div class="argus-search-note">No matches</div>`;
      return;
    }
    let group;
    list.innerHTML = results
      .map((result, index) => {
        const count = results.filter((other) => other.group === result.group).length;
        const heading = result.group !== group ? `<div class="argus-search-group"><span>${esc(result.group)}</span><span>${count}</span></div>` : "";
        group = result.group;
        const detail = result.detail ? `<span class="argus-search-detail">${esc(result.detail)}</span>` : "";
        const snippet = result.snippet ? `<div class="argus-search-snippet">${highlight(result.snippet, words)}</div>` : "";
        return `${heading}<div class="argus-search-row${index === selected ? " selected" : ""}" role="option" data-index="${index}"><div class="argus-search-l1"><span class="argus-search-title">${highlight(result.title, words)}</span>${detail}</div>${snippet}</div>`;
      })
      .join("");
    list.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
  }

  function onKeydown(event) {
    if (event.key === "ArrowDown" || (event.ctrlKey && event.key === "n")) {
      selected = results.length ? (selected + 1) % results.length : 0;
      render();
    } else if (event.key === "ArrowUp" || (event.ctrlKey && event.key === "p")) {
      selected = results.length ? (selected - 1 + results.length) % results.length : 0;
      render();
    } else if (event.key === "Enter") {
      pick(selected);
    } else if (event.key === "Escape") {
      close();
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  function pick(index) {
    const result = results[index];
    if (!result) return;
    close();
    post({ type: "searchOpen", source: result.source, id: result.id });
  }

  function open() {
    if (!root) build();
    if (root.hidden) returnFocus = document.activeElement;
    root.hidden = false;
    input.focus();
    input.select();
    pending = terms().length > 0;
    render();
    request();
  }

  function close() {
    root.hidden = true;
    returnFocus?.focus?.();
  }

  window.argusSearch = {
    init(postMessage) {
      post = postMessage;
      // Capture phase, stopped here: VS Code listens on window, and its Cmd+K chords (ours or another extension's) would take the key.
      document.addEventListener(
        "keydown",
        (event) => {
          const mod = /Mac/.test(navigator.platform) ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
          if (!mod || event.shiftKey || event.altKey || event.key.toLowerCase() !== "k") return;
          event.preventDefault();
          event.stopPropagation();
          open();
        },
        true
      );
    },
    // True when the message was the overlay's.
    onMessage(message) {
      if (message.type === "searchShow") {
        open();
        return true;
      }
      if (message.type !== "searchResults") return false;
      if (root && message.query === input.value.trim()) {
        results = message.results;
        selected = 0;
        pending = false;
        render();
      }
      return true;
    }
  };
})();
