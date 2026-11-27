const BRIDGE = `window.argus={send:function(text,options){parent.postMessage({argusWidget:"send",text:String(text),append:!!(options&&options.append)},"*")}};
addEventListener("click",function(e){var a=e.target.closest&&e.target.closest("a[href]");if(a){e.preventDefault();parent.postMessage({argusWidget:"open",url:a.href},"*")}},true);
addEventListener("DOMContentLoaded",function(){new ResizeObserver(function(){parent.postMessage({argusWidget:"height",height:Math.ceil(document.body.getBoundingClientRect().height)},"*")}).observe(document.body)});`;

// The frame inherits the chat's CSP, so scripts need its nonce. Its own policy then limits scripts to the CDN hosts
// and drops the chat's https images, which a widget could use to send data out.
export function widgetSrcdoc(html: string, nonce: string, scriptHosts: string[], cssVars: string, colorScheme: string): string {
  const policy = `default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline' ${scriptHosts.join(" ")}`;
  const style = `:root{${cssVars};color-scheme:${colorScheme}}body{margin:0;padding:8px;background:transparent;color:var(--vscode-foreground);font-family:var(--vscode-font-family);font-size:var(--vscode-font-size)}a{color:var(--vscode-textLink-foreground)}a:hover{color:var(--vscode-textLink-activeForeground)}`;
  const body = html.replace(/^\s*<!doctype[^>]*>/i, "").replace(/<script\b/gi, `<script nonce="${nonce}"`);
  return `<!DOCTYPE html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><style>${style}</style><script nonce="${nonce}">${BRIDGE}</script>${body}`;
}
