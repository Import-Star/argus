const BRIDGE = `window.argus={send:function(text){parent.postMessage({argusWidget:"send",text:String(text)},"*")}};
addEventListener("DOMContentLoaded",function(){new ResizeObserver(function(){parent.postMessage({argusWidget:"height",height:Math.ceil(document.body.getBoundingClientRect().height)},"*")}).observe(document.body)});`;

// The frame inherits the chat's nonce-only CSP, so scripts need the nonce; its own policy then limits where they load from.
export function widgetSrcdoc(html: string, nonce: string, scriptHosts: string[], cssVars: string, colorScheme: string): string {
  const policy = `script-src 'unsafe-inline' ${scriptHosts.join(" ")}`;
  const style = `:root{${cssVars};color-scheme:${colorScheme}}body{margin:0;padding:8px;background:transparent;color:var(--vscode-foreground);font-family:var(--vscode-font-family);font-size:var(--vscode-font-size)}`;
  const body = html.replace(/^\s*<!doctype[^>]*>/i, "").replace(/<script\b/gi, `<script nonce="${nonce}"`);
  return `<!DOCTYPE html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><style>${style}</style><script nonce="${nonce}">${BRIDGE}</script>${body}`;
}
