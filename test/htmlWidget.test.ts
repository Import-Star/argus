import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { widgetSrcdoc } from "../chat/webview/htmlWidget.ts";

describe("widgetSrcdoc", () => {
  const doc = widgetSrcdoc('<!doctype html><SCRIPT src="https://cdn.jsdelivr.net/npm/x@1/x.js"></SCRIPT><script>go()</script>', "abc+/=", ["https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net"], "--vscode-foreground: #fff", "dark");

  it("gives every script the page nonce, so the inherited CSP lets it run", () => {
    assert.equal(doc.match(/<script\b/gi)?.length, 3);
    assert.equal(doc.match(/<script nonce="abc\+\/="/gi)?.length, 3);
  });

  it("limits scripts to the CDN hosts and images to data: before any widget script", () => {
    const policy = doc.indexOf(`content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net"`);
    assert.ok(policy > 0 && policy < doc.search(/<script/i));
  });

  it("keeps one doctype at the start", () => {
    assert.ok(doc.startsWith("<!DOCTYPE html>"));
    assert.equal(doc.match(/<!doctype/gi)?.length, 1);
  });
});
