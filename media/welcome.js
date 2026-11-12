// Welcome and What's New pages: buttons and links carry the command to run (data-command) or the link to open (data-url).
(function () {
  const vscode = acquireVsCodeApi();
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("button, a[data-url]") : null;
    if (!target) {
      return;
    }
    event.preventDefault();
    if (target.dataset.command) {
      target.disabled = true;
      vscode.postMessage({ type: "command", command: target.dataset.command });
    } else if (target.dataset.url) {
      vscode.postMessage({ type: "openExternal", url: target.dataset.url });
    }
  });
})();
