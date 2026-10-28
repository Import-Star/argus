// Draws ```mermaid blocks (marked up by markdown.ts) as diagrams. Mermaid is a few MB, so its bundle loads the first
// time a diagram appears, with the same nonce as this script so the webview's CSP stays as strict as it is.
type Mermaid = {
  initialize(config: Record<string, unknown>): void;
  render(id: string, source: string): Promise<{ svg: string }>;
};

const self = document.currentScript as HTMLScriptElement | null;
const nonce = self?.nonce ?? "";
const bundleUrl = self?.src ? new URL("mermaid.js", self.src).href : "";

let loading: Promise<Mermaid> | undefined;
// Rendered diagrams by theme and source: transcript HTML is replaced as replies stream, so blocks are redrawn often.
const svgs = new Map<string, string>();
let count = 0;

function theme(): "dark" | "default" {
  const classes = document.body.classList;
  return classes.contains("vscode-dark") || (classes.contains("vscode-high-contrast") && !classes.contains("vscode-high-contrast-light")) ? "dark" : "default";
}

function load(): Promise<Mermaid> {
  loading ??= new Promise<Mermaid>((resolve, reject) => {
    const script = document.createElement("script");
    script.nonce = nonce;
    script.src = bundleUrl;
    script.onload = () => {
      const mermaid = (window as { argusMermaid?: Mermaid }).argusMermaid;
      if (mermaid) {
        resolve(mermaid);
      } else {
        reject(new Error("Mermaid didn't load."));
      }
    };
    script.onerror = () => reject(new Error("Mermaid didn't load."));
    document.head.appendChild(script);
  });
  return loading;
}

function part(block: HTMLElement, selector: string): HTMLElement | null {
  return block.querySelector(`:scope > ${selector}`);
}

function show(block: HTMLElement, svg: string): void {
  const diagram = part(block, ".mermaid-diagram");
  if (!diagram) {
    return;
  }
  // Mermaid's strict security level sanitises the SVG it returns.
  diagram.innerHTML = svg;
  diagram.hidden = false;
  part(block, ".code-block")?.setAttribute("hidden", "");
  const toggle = part(block, ".mermaid-toggle");
  if (toggle) {
    toggle.hidden = false;
  }
  block.dataset.state = "diagram";
}

async function draw(block: HTMLElement): Promise<void> {
  const source = block.dataset.source ?? "";
  const key = `${theme()}\n${source}`;
  const cached = svgs.get(key);
  if (cached) {
    show(block, cached);
    return;
  }
  block.dataset.state = "drawing";
  try {
    const mermaid = await load();
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: theme() });
    const { svg } = await mermaid.render(`argus-mermaid-${(count += 1)}`, source);
    svgs.set(key, svg);
    show(block, svg);
  } catch (error) {
    block.dataset.state = "error";
    const note = part(block, ".mermaid-error");
    if (note) {
      note.textContent = `Couldn't draw this diagram: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`;
      note.hidden = false;
    }
  }
}

function drawAll(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>(".mermaid-block:not([data-state])").forEach((block) => void draw(block));
}

// Rendered markdown is set through innerHTML in several places, so watch the page rather than each component.
export function startMermaid(): void {
  new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach((node) => {
        if (node instanceof HTMLElement) {
          if (node.matches(".mermaid-block:not([data-state])")) {
            void draw(node);
          }
          drawAll(node);
        }
      });
    }
  }).observe(document.body, { childList: true, subtree: true });
  drawAll(document);

  document.addEventListener("click", (event) => {
    const toggle = (event.target as HTMLElement | null)?.closest<HTMLElement>(".mermaid-toggle");
    const block = toggle?.parentElement;
    if (!toggle || !block) {
      return;
    }
    const diagram = part(block, ".mermaid-diagram");
    const code = part(block, ".code-block");
    if (!diagram || !code) {
      return;
    }
    const showSource = code.hidden;
    code.hidden = !showSource;
    diagram.hidden = showSource;
    toggle.textContent = showSource ? "Show diagram" : "Show source";
  });
}
