import { context, build } from "esbuild";

const watch = process.argv.includes("--watch");

const host = {
  entryPoints: ["chat/host/index.ts"],
  outfile: "out/chat/host.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  sourcemap: true,
  logLevel: "warning",
  // The SDK is ESM and reads import.meta.url; the extension host loads CommonJS.
  define: { "import.meta.url": "__argusImportMetaUrl" },
  banner: { js: 'const __argusImportMetaUrl = require("url").pathToFileURL(__filename).href;' }
};

const webview = {
  entryPoints: ["chat/webview/index.tsx"],
  outfile: "out/chat/webview.js",
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2022",
  jsx: "automatic",
  jsxImportSource: "preact",
  sourcemap: true,
  logLevel: "warning"
};

// Mermaid is large, so it is its own bundle, loaded only when a reply contains a diagram.
const mermaid = {
  entryPoints: ["chat/webview/mermaidEntry.ts"],
  outfile: "out/chat/mermaid.js",
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2022",
  minify: true,
  logLevel: "warning"
};

if (watch) {
  await Promise.all([host, webview, mermaid].map(async (options) => (await context(options)).watch()));
} else {
  await Promise.all([build(host), build(webview), build(mermaid)]);
}
