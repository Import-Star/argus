import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import "./highlight.css";

const LANGUAGES = { bash, css, diff, dockerfile, go, ini, java, javascript, json, markdown, python, rust, sql, typescript, xml, yaml };
for (const [name, definition] of Object.entries(LANGUAGES)) {
  hljs.registerLanguage(name, definition);
}
hljs.registerAliases(["sh", "shell", "zsh"], { languageName: "bash" });
hljs.registerAliases(["ts", "tsx"], { languageName: "typescript" });
hljs.registerAliases(["js", "jsx", "mjs", "cjs"], { languageName: "javascript" });
hljs.registerAliases(["yml"], { languageName: "yaml" });
hljs.registerAliases(["html", "svg"], { languageName: "xml" });
hljs.registerAliases(["py"], { languageName: "python" });
hljs.registerAliases(["rs"], { languageName: "rust" });
hljs.registerAliases(["md"], { languageName: "markdown" });
hljs.registerAliases(["toml", "conf"], { languageName: "ini" });
hljs.registerAliases(["patch"], { languageName: "diff" });
hljs.registerAliases(["jsonc", "json5"], { languageName: "json" });

const EXTENSIONS: Record<string, string> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  json: "json", jsonc: "json", sh: "bash", bash: "bash", zsh: "bash",
  py: "python", go: "go", sql: "sql", yml: "yaml", yaml: "yaml",
  css: "css", scss: "css", html: "xml", htm: "xml", xml: "xml", svg: "xml",
  md: "markdown", mdx: "markdown", diff: "diff", patch: "diff",
  toml: "ini", ini: "ini", cfg: "ini", java: "java", rs: "rust"
};
const FILENAMES: Record<string, string> = { Dockerfile: "dockerfile" };

const AUTO_MAX_CHARS = 4000;
const AUTO_MIN_RELEVANCE = 5;
const AUTO_SUBSET = ["typescript", "javascript", "json", "bash", "python", "go", "sql", "yaml", "css", "xml", "diff"];
const CONTROL = /<span class="hljs-keyword">(if|else|for|while|do|switch|case|default|break|continue|return|throw|try|catch|finally|import|from|export|await|yield|async|in|of|match|elif|except|raise|with|then|fi|done|esac)<\/span>/g;

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// hljs escapes all text itself; the only markup in the result is its own spans.
export function highlightCode(code: string, language?: string): string {
  try {
    let html: string | undefined;
    if (language && hljs.getLanguage(language)) {
      html = hljs.highlight(code, { language, ignoreIllegals: true }).value;
    } else if (!language && code.length <= AUTO_MAX_CHARS) {
      const result = hljs.highlightAuto(code, AUTO_SUBSET);
      html = result.relevance >= AUTO_MIN_RELEVANCE ? result.value : undefined;
    }
    return html === undefined ? escapeHtml(code) : html.replace(CONTROL, '<span class="hljs-keyword hljs-control">$1</span>');
  } catch {
    return escapeHtml(code);
  }
}

export function languageFor(path: string): string | undefined {
  const name = path.split(/[\\/]/).pop() ?? "";
  return FILENAMES[name] ?? EXTENSIONS[name.split(".").pop()!.toLowerCase()];
}
