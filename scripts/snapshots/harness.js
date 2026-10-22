(() => {
  const now = window.__SNAPSHOT_NOW;
  const RealDate = Date;
  window.Date = class extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(now);
      else super(...args);
    }
    static now() {
      return now;
    }
  };

  const canned = { changes: [], fileDiff: [], taskOutput: [] };
  const deliver = (data) => window.dispatchEvent(new MessageEvent("message", { data: JSON.parse(JSON.stringify(data)) }));
  const same = (a, b) => Object.entries(b).every(([key, value]) => a[key] === value);

  function answer(request) {
    const key = { changes: ["sessionId", "scope"], fileDiff: ["sessionId", "scope", "path"], taskOutput: ["sessionId", "taskId"] }[request.type];
    if (!key) return;
    const wanted = Object.fromEntries(key.map((name) => [name, request[name]]));
    const found = canned[request.type].find((candidate) => same(request.type === "fileDiff" ? { ...candidate, path: candidate.diff.path } : candidate, wanted));
    if (found) Promise.resolve().then(() => deliver(found));
    else console.error(`snapshot harness: no canned response for ${JSON.stringify(request)}`);
  }

  window.__posted = [];
  window.acquireVsCodeApi = () => ({
    postMessage(message) {
      window.__posted.push(message);
      answer(message);
    },
    getState: () => window.__vscodeState,
    setState: (state) => {
      window.__vscodeState = state;
    }
  });

  window.__harness = {
    play(messages) {
      for (const message of messages) {
        if (message.type in canned) canned[message.type].push(message);
        else deliver(message);
      }
      return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
  };
})();
