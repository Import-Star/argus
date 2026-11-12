import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildSettingGroups } from "../src/services/settingsSchema.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "out", "snapshots");
const NOW = Date.UTC(2026, 9, 21, 10, 0, 0);
const TABS = [
  { id: "sessions", title: "Sessions" },
  { id: "settings", title: "Settings" }
];

const LIGHT_THEME = `:root { color-scheme: light; --vscode-editor-background: #ffffff; --vscode-editor-foreground: #3b3b3b; --vscode-foreground: #3b3b3b; --vscode-descriptionForeground: #717171; --vscode-disabledForeground: #a0a0a0; --vscode-errorForeground: #cd3131; --vscode-sideBar-background: #f8f8f8; --vscode-editorWidget-background: #f3f3f3; --vscode-widget-border: #c8c8c8; --vscode-panel-border: #e5e5e5; --vscode-input-background: #ffffff; --vscode-dropdown-background: #ffffff; --vscode-dropdown-foreground: #3b3b3b; --vscode-list-hoverBackground: #e8e8e8; --vscode-charts-green: #388a34; --vscode-charts-blue: #1a85ff; --vscode-charts-yellow: #bf8803; }`;

const fixture = (name) => resolveTimes(JSON.parse(readFileSync(path.join(root, "test", "fixtures", "snapshots", `${name}.json`), "utf8")));

function resolveTimes(value) {
  if (typeof value === "string") {
    const match = /^@now([+-]\d+)?$/.exec(value);
    return match ? NOW + Number(match[1] ?? 0) : value;
  }
  if (Array.isArray(value)) return value.map(resolveTimes);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveTimes(item)]));
  return value;
}

function settingsMessage() {
  const configuration = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).contributes.configuration;
  const { values } = fixture("settings");
  return { type: "tab", tab: "settings", message: { type: "settings", groups: buildSettingGroups(configuration, (id) => values[id] ?? {}) } };
}

async function openIn(page, label) {
  await page.getByRole("button", { name: label }).first().click();
}

async function reviewSteps(page, { then }) {
  // Changed files start folded.
  await page.locator(".det-fold > summary").first().click();
  await page.locator(".det-file").first().click();
  for (const [line, text] of [[5, "Should subtract reject NaN inputs like add does in the validator?"], [6, "Why not reuse add(a, -b) here?"]]) {
    const row = page.locator(`[data-line="src/math.ts:new:${line}"]`);
    await row.locator(".review-line").click();
    await row.locator("textarea").fill(text);
  }
  await page.keyboard.press("Meta+Enter");
  await page.evaluate((messages) => window.__harness.play(messages), then);
}

async function reviewMarkdownSteps(page) {
  await page.locator(".det-fold > summary").first().click();
  await page.locator(".det-file").first().click();
  await page.locator(".review-file", { hasText: "README.md" }).click();
  await page.getByRole("button", { name: "Show rendered" }).click();
  const table = page.locator('[data-line="README.md:new:5"]');
  await table.locator(".review-block").click();
  await table.locator("textarea").fill("Add a row for multiply once it lands?");
}

// Diagrams draw after Mermaid's bundle loads, so wait for both, and for the broken one to fall back to code.
async function mermaidSteps(page) {
  await page.locator(".mermaid-diagram:not([hidden]) svg").nth(1).waitFor();
  await page.locator(".mermaid-error:not([hidden])").waitFor();
}

async function planSteps(page) {
  await openIn(page, "Open plan");
  await page.locator(".plan-pane").waitFor();
  await page.evaluate(() => {
    const target = [...document.querySelectorAll(".plan-block li")].find((el) => el.textContent.includes("Totals can shift"));
    const range = document.createRange();
    range.selectNodeContents(target);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.querySelector(".plan-body").dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.locator(".plan-add").click();
  await page.getByLabel("Comment", { exact: true }).fill("Is a one-cent shift acceptable for refunds too?");
  await page.getByRole("button", { name: "Save" }).click();
}

async function workflowSteps(page) {
  await openIn(page, "View workflow");
  await page.locator(".wf-agent-failed").click();
  await page.locator(".wf-output").filter({ hasText: "timed out" }).waitFor();
}

async function workflowConversationSteps(page) {
  await workflowSteps(page);
  await page.getByRole("button", { name: "Open conversation" }).click();
  await page.locator(".wf-conversation .tr-bash-cmd").waitFor();
}

async function boardSteps(page) {
  await page.getByLabel("Expand then contract").check();
  await page.locator(".pending-opt.on").waitFor();
}

async function findingsSteps(page) {
  await page.locator(".tr-finding .tr-fold").first().click();
  await page.locator(".tr-finding-rows dt").first().waitFor();
}

async function textOnlySteps(page) {
  await page.keyboard.press("Meta+Shift+T");
  await page.locator('.tr-pill[aria-pressed="true"]').waitFor();
}

async function reviewPrSteps(page) {
  await page.getByRole("button", { name: "Diff of #412" }).click();
  await page.locator(".review-diff .review-line").first().waitFor();
  await page.locator(".review-gap").nth(1).getByRole("button").click();
}

async function detailsSteps(page) {
  await page.getByRole("button", { name: "Show output of yarn workspace api dev" }).click();
  await page.locator(".det-bg-output").filter({ hasText: "listening" }).waitFor();
  await page.getByRole("button", { name: /Show 1 finished/ }).click();
}

async function slashSteps(page) {
  await page.getByLabel("Message Claude").first().pressSequentially("/re");
  await page.locator(".cmp-command").first().waitFor();
}

async function agentSteps(page) {
  await page.getByLabel("Message Claude").first().pressSequentially("ask #ch");
  await page.locator('.cmp-suggest[aria-label="Agents"]').waitFor();
}

async function pasteSteps(page) {
  await page.evaluate(() => {
    const box = document.querySelector(".cmp-input");
    const paste = (fill) => {
      const data = new DataTransfer();
      fill(data);
      box.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    };
    paste((data) => data.setData("text/uri-list", "file:///work/orders/src/math.ts"));
    paste((data) => data.items.add(new File(["# Notes\nsubtract must reject NaN\n"], "notes.md", { type: "text/markdown" })));
    paste((data) => data.items.add(new File(["x"], "archive.zip", { type: "application/zip" })));
  });
  await page.locator(".cmp-note").waitFor();
}

async function asideSteps(page, data) {
  const sessionId = fixture("chat").messages.find((message) => message.type === "layout").sessionIds[0];
  await page.getByRole("button", { name: "Ask aside" }).click();
  for (const ask of data.asks) {
    await page.getByLabel("Side question", { exact: true }).last().fill(ask.question);
    await page.keyboard.press("Enter");
    const posted = await page.evaluate(() => window.__posted.filter((message) => message.type === "aside").at(-1));
    await page.evaluate((messages) => window.__harness.play(messages), [{ type: "aside", sessionId, askId: posted.askId, text: ask.text, status: ask.status }]);
  }
}

async function queueSteps(page) {
  await page.getByRole("button", { name: "Edit queued message 3" }).click();
  await page.locator(".q-edit").waitFor();
}

async function historySteps(page) {
  const second = page.locator(".tr-item", { has: page.locator(".tr-user", { hasText: "multiply" }) });
  await second.hover();
  await second.getByRole("button", { name: "Rewind to here" }).click();
  await second.getByRole("button", { name: "Fork from here" }).click();
  const sent = await page.evaluate(() => window.__posted.filter((message) => message.type === "rewind" || message.type === "fork"));
  const [rewind, fork] = sent;
  if (rewind?.type !== "rewind" || rewind.text !== "Now add a multiply helper the same way." || fork?.type !== "fork" || fork.before !== true || fork.messageId !== rewind.userMessageId) {
    throw new Error(`unexpected rewind/fork messages: ${JSON.stringify(sent)}`);
  }
  await page.locator(".tr-item", { has: page.locator(".tr-user", { hasText: "subtract helper" }) }).locator(".tr-actions").waitFor({ state: "detached" });
  await page.locator(".tr-item", { has: page.locator(".tr-text", { hasText: "multiply" }) }).hover();
}

async function searchSteps(page) {
  await page.keyboard.press("Meta+f");
  await page.getByLabel("Search conversation").fill("rejects NaN");
  await page.locator(".tr-output").waitFor();
  await page.locator(".tr-search-count", { hasText: "1 of 1" }).waitFor();
  await page.getByLabel("Search conversation").fill("subtract");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.locator(".tr-search-count", { hasText: "3 of" }).waitFor();
}

async function questionSteps(page) {
  await page.locator(".perm-card.question").focus();
  await page.keyboard.press("1");
  await page.locator(".q-row", { hasText: "Use a dev vault" }).waitFor();
  await page.keyboard.press("1");
  await page.getByRole("button", { name: "+ Add a note to this answer" }).click();
  await page.getByLabel("Note for PRs").fill("stack PR2 on PR1");
  await page.keyboard.press("Enter");
  const sent = await page.evaluate(() => window.__posted.filter((message) => message.type === "permission").at(-1));
  const input = sent?.decision?.updatedInput;
  if (input?.answers?.["Should the PRs be opened when done?"] !== "Draft PRs, no Slack (Recommended)" || input?.annotations?.["Should the PRs be opened when done?"]?.notes !== "stack PR2 on PR1" || Object.keys(input.answers).length !== 2) {
    throw new Error(`unexpected question answer: ${JSON.stringify(sent)}`);
  }
}

const SESSION_ID = "11111111-0000-4000-8000-000000000001";
const panelMessage = (name) => ({ type: "panel", sessionId: SESSION_ID, panel: fixture("panels").panels[name] });
const panelBase = (name) => () => [...fixture("panels").base, panelMessage(name)];

async function actions(page) {
  return page.evaluate(() => window.__posted.filter((message) => message.type === "panelAction").map(({ kind, action, payload }) => ({ kind, action, payload })));
}

async function expectActions(page, expected) {
  const sent = await actions(page);
  if (JSON.stringify(sent) !== JSON.stringify(expected)) throw new Error(`unexpected panelAction messages: ${JSON.stringify(sent)} (wanted ${JSON.stringify(expected)})`);
}

const row = (page, name) => page.locator(".mcp-row", { has: page.locator(".mcp-name", { hasText: name }) });

async function mcpSteps(page) {
  await row(page, "acme-docs").getByRole("button", { name: "Reconnect" }).click();
  await row(page, "example-issues").getByRole("button", { name: "Authenticate" }).click();
  await row(page, "acme-search").getByRole("button", { name: "Disable" }).click();
  await row(page, "jane-notes").getByRole("button", { name: "Enable" }).click();
  await row(page, "acme-search").locator("summary").click();
  const signIn = row(page, "example-metrics");
  await signIn.getByRole("button", { name: "Open sign-in page again" }).click();
  await signIn.locator(".mcp-callback summary").click();
  await signIn.locator(".mcp-callback input").fill("http://localhost:4567/callback?code=abc&state=xyz");
  await signIn.getByRole("button", { name: "Submit" }).click();
  await page.getByRole("button", { name: "Refresh" }).click();
  await expectActions(page, [
    { kind: "mcp", action: "reconnect", payload: "acme-docs" },
    { kind: "mcp", action: "authenticate", payload: "example-issues" },
    { kind: "mcp", action: "disable", payload: "acme-search" },
    { kind: "mcp", action: "enable", payload: "jane-notes" },
    { kind: "mcp", action: "openSignIn" },
    { kind: "mcp", action: "submitCallback", payload: "http://localhost:4567/callback?code=abc&state=xyz" },
    { kind: "mcp", action: "refresh" }
  ]);
}

async function permissionsSteps(page) {
  await page.getByRole("tab", { name: /^Deny/ }).click();
  await page.getByRole("button", { name: "Remove" }).click();
  await page.getByRole("tab", { name: /^Allow/ }).click();
  await page.getByPlaceholder("Bash(npm test:*)").fill("Bash(npm run lint:*)");
  if (!(await page.locator(".setp-add option", { hasText: "Project" }).isDisabled())) throw new Error("a settings file with invalid JSON can be picked for a new rule");
  await page.locator(".setp-add select").selectOption({ label: "User" });
  await page.locator(".setp-add").getByRole("button", { name: "Add" }).click();
  await page.getByRole("tab", { name: /^Folders/ }).click();
  await page.getByRole("button", { name: "Open file" }).first().click();
  await page.getByRole("tab", { name: /^Allow/ }).click();
  await expectActions(page, [
    { kind: "permissions", action: "remove", payload: { list: "deny", text: "Read(./.env)", file: "/work/orders/.claude/settings.json" } },
    { kind: "permissions", action: "add", payload: { list: "allow", text: "Bash(npm run lint:*)", file: "/Users/jane/.claude/settings.json" } },
    { kind: "permissions", action: "open", payload: { list: "folders", file: "/Users/jane/.claude/settings.json" } }
  ]);
  if ((await page.getByPlaceholder("Bash(npm test:*)").inputValue()) !== "") throw new Error("add box was not cleared");
}

async function hooksSteps(page) {
  await page.getByRole("button", { name: "Open file" }).first().click();
  await expectActions(page, [{ kind: "hooks", action: "open", payload: { file: "/work/orders/.claude/settings.json", event: "PreToolUse" } }]);
}

async function closeSteps(page) {
  await page.getByRole("button", { name: "Close" }).click();
  await page.locator(".cmdp").waitFor({ state: "detached" });
  // A refresh must not reopen a closed panel.
  await page.evaluate((messages) => window.__harness.play(messages), [{ ...panelMessage("loops-session"), refresh: true }]);
  if (await page.locator(".cmdp").count()) throw new Error("a refresh reopened a closed panel");
}

async function contextSteps(page) {
  await page.getByRole("button", { name: "Refresh" }).click();
  await expectActions(page, [{ kind: "context", action: "refresh" }]);
}

async function configSteps(page) {
  await page.locator(".cfg-row", { hasText: "autoCompactEnabled" }).getByRole("button", { name: "Off" }).click();
  await page.locator(".cfg-row", { hasText: "theme" }).locator("select").selectOption("light");
  await page.locator(".cfg-row", { hasText: "preferredNotifChannel" }).getByRole("button", { name: "Set" }).waitFor();
  await page.locator(".cfg-row", { hasText: "editorMode" }).locator("select").selectOption("vim");
  await page.getByPlaceholder("Search settings").fill("zzz");
  await page.locator(".cmdp-empty", { hasText: "No settings match" }).waitFor();
  await page.getByPlaceholder("Search settings").fill("");
  await expectActions(page, [
    { kind: "config", action: "set", payload: { key: "autoCompactEnabled", value: "false" } },
    { kind: "config", action: "set", payload: { key: "theme", value: "light" } },
    { kind: "config", action: "set", payload: { key: "editorMode", value: "vim" } }
  ]);
}

async function loopsSteps(page) {
  await page.getByRole("button", { name: "New loop" }).click();
  await page.getByRole("button", { name: "Delete" }).first().click();
  await expectActions(page, [
    { kind: "loops", action: "new" },
    { kind: "loops", action: "delete", payload: "a1b2c3d4" }
  ]);
  // The turn that deletes a loop ends with a refresh of the open panel.
  await page.evaluate((messages) => window.__harness.play(messages), [{ ...panelMessage("loops-session"), refresh: true }]);
  await page.getByText("Remind me to rebase the branch").waitFor();
}

async function daemonSteps(page) {
  await page.getByRole("button", { name: "Logs" }).click();
  await page.getByRole("button", { name: "Open config" }).click();
  await page.getByRole("button", { name: "Stop" }).click();
  await expectActions(page, [
    { kind: "daemon", action: "logs" },
    { kind: "daemon", action: "open-config" },
    { kind: "daemon", action: "stop" }
  ]);
}

async function headerSteps(page) {
  await page.locator(".hdr-mcp").click();
  await page.locator(".hdr-context").click();
  const sent = await page.evaluate(() => window.__posted.filter((message) => message.type === "send").map((message) => message.text));
  if (JSON.stringify(sent) !== JSON.stringify(["/mcp", "/context"])) throw new Error(`unexpected header sends: ${JSON.stringify(sent)}`);
}

const CHAT_PAGE = { html: "chat.html" };
const CENTER_PAGE = { html: "center.html" };

const SCREENS = [
  { name: "chat", ...CHAT_PAGE, expect: { todos: ".tr-todos", diffCard: ".tr-diff", agent: ".tr-row strong", streaming: ".tr-cursor", cache: ".det-row[title=\"Prompt cache expires if idle\"]", effort: ".cmp-effort .on", details: ".det-section", agentsChip: ".hdr-agents", agentDots: ".hdr-agent-dots .hdr-dot" } },
  { name: "chat-narrow", ...CHAT_PAGE, width: 900, fixture: "chat", expect: { agentsChip: ".hdr-agents", header: ".chat-header" } },
  { name: "permission", ...CHAT_PAGE, expect: { permission: ".perm-card", command: ".perm-code", actions: ".perm-actions button" } },
  { name: "question", ...CHAT_PAGE, steps: questionSteps, expect: { card: ".perm-card.question", answered: ".q-row", options: ".q-option", recommended: ".q-badge", receipt: ".tr-answer-list dd" } },
  { name: "plan", ...CHAT_PAGE, steps: planSteps, expect: { planPane: ".plan-pane", planBlocks: ".plan-block", comment: ".plan-comment", approve: ".plan-foot button" } },
  { name: "review", ...CHAT_PAGE, steps: reviewSteps, expect: { overlay: ".review", threads: ".review-thread", answered: ".review-claude:not(.review-working)", inProgress: ".review-working", files: ".review-file" } },
  { name: "review-markdown", ...CHAT_PAGE, fixture: "review", steps: reviewMarkdownSteps, expect: { overlay: ".review", rendered: ".review-rendered table", changed: ".review-block-add", thread: ".review-rendered .review-thread" } },
  { name: "review-pr", ...CHAT_PAGE, messages: () => [...fixture("review").messages, ...fixture("review-pr").messages], steps: reviewPrSteps, expect: { overlay: ".review", prTab: '.review-tabs [aria-selected="true"]', files: ".review-file", deleted: ".review-k-del", gapCollapsed: ".review-gap", gapExpanded: ".review-line.review-k-ctx" } },
  { name: "grid", ...CHAT_PAGE, expect: { tiles: ".grid-tile", needsYou: ".grid-tile.needs", summary: ".grid-needs", groupName: ".grid-group", addAgent: ".add-agent.split" } },
  { name: "board", ...CENTER_PAGE, height: 1200, tab: "sessions", messages: () => fixture("board").messages, steps: boardSteps, expect: { cards: ".row", permission: ".pending-code", question: ".pending-q", columns: ".scol", group: ".row.group", agents: ".row.group .agent", groupPending: ".row.group .agent-pending .pending-code" } },
  { name: "workflow", ...CHAT_PAGE, steps: workflowSteps, expect: { card: ".wf-card", pane: ".wf-pane", phases: ".wf-column", failed: ".wf-agent-failed", detail: ".wf-detail" } },
  { name: "workflow-conversation", ...CHAT_PAGE, fixture: "workflow", steps: workflowConversationSteps, expect: { conversation: ".wf-conversation", user: ".wf-conversation .tr-user", bash: ".wf-conversation .tr-bash-cmd" } },
  { name: "findings", ...CHAT_PAGE, steps: findingsSteps, expect: { card: ".tr-finding", file: ".tr-finding-file", severity: ".tr-sev", rows: ".tr-finding-rows dt", actions: ".tr-finding-actions button" } },
  { name: "text-only", ...CHAT_PAGE, steps: textOnlySteps, expect: { pill: '.tr-pill[aria-pressed="true"]', divider: ".tr-hidden", text: ".tr-text" } },
  { name: "details", ...CHAT_PAGE, steps: detailsSteps, expect: { limits: ".det-limit", warn: ".det-meter.warn", background: ".det-bg", output: ".det-bg-output", stop: ".det-bg-actions button[aria-label^=Stop]", finished: '.det-bg svg[aria-label="done"]' } },
  { name: "history", ...CHAT_PAGE, steps: historySteps, expect: { actions: ".tr-actions", usage: ".tr-usage", user: ".tr-user" } },
  { name: "history-search", ...CHAT_PAGE, messages: () => fixture("history").messages, steps: searchSteps, expect: { search: ".tr-search", count: ".tr-search-count", output: ".tr-output", thinking: ".tr-thinking-body" } },
  { name: "working", ...CHAT_PAGE, expect: { working: ".tr-working", glyph: ".tr-working-glyph", meta: ".tr-working-meta" } },
  { name: "queue", ...CHAT_PAGE, messages: () => [...fixture("working").messages, ...fixture("queue").messages], steps: queueSteps, expect: { queue: ".q", rows: ".q-row", sent: ".q-sent .q-warn", editor: ".q-edit", sendNow: ".q-now" } },
  { name: "slash", ...CHAT_PAGE, steps: slashSteps, expect: { popup: '.cmp-suggest[aria-label="Commands"]', commands: ".cmp-command", hint: ".cmp-hint" } },
  { name: "agents", ...CHAT_PAGE, fixture: "slash", steps: agentSteps, expect: { popup: '.cmp-suggest[aria-label="Agents"]', agents: ".cmp-option" } },
  { name: "paste", ...CHAT_PAGE, steps: pasteSteps, expect: { chips: ".cmp-chip.mono", note: ".cmp-note" } },
  { name: "aside", ...CHAT_PAGE, messages: () => fixture("chat").messages, steps: asideSteps, expect: { panel: ".aside-panel", questions: ".aside-question", answer: ".aside-answer pre", streaming: ".aside-answer[aria-busy=\"true\"]", form: ".aside-form button" } },
  { name: "panel-mcp", ...CHAT_PAGE, fixture: "panels", messages: panelBase("mcp"), steps: mcpSteps, expect: { panel: ".cmdp", failed: ".mcp-dot-failed", needsAuth: ".mcp-dot-needs-auth", error: ".mcp-error", tools: ".mcp-tools li", destructive: ".mcp-badge-destructive", disabled: ".mcp-dot-disabled", signIn: ".mcp-signin" } },
  { name: "panel-mcp-narrow", ...CHAT_PAGE, width: 900, fixture: "panels", messages: panelBase("mcp"), expect: { panel: ".cmdp", failed: ".mcp-dot-failed", error: ".mcp-error" } },
  { name: "panel-mcp-light", ...CHAT_PAGE, theme: "light", fixture: "panels", messages: panelBase("mcp"), expect: { panel: ".cmdp", failed: ".mcp-dot-failed" } },
  { name: "panel-mcp-empty", ...CHAT_PAGE, fixture: "panels", messages: panelBase("mcp-empty"), expect: { panel: ".cmdp", empty: ".cmdp-empty" } },
  { name: "panel-closed", ...CHAT_PAGE, fixture: "panels", messages: panelBase("mcp-empty"), steps: closeSteps, expect: { details: ".det-section" } },
  { name: "panel-permissions", ...CHAT_PAGE, fixture: "panels", messages: panelBase("permissions"), steps: permissionsSteps, expect: { panel: ".cmdp", tabs: ".setp-tab", error: ".setp-error", rows: ".setp-row", add: ".setp-add input", files: ".setp-h" } },
  { name: "panel-permissions-narrow", ...CHAT_PAGE, width: 900, fixture: "panels", messages: panelBase("permissions"), expect: { panel: ".cmdp", tabs: ".setp-tab", error: ".setp-error", add: ".setp-add input" } },
  { name: "panel-hooks", ...CHAT_PAGE, fixture: "panels", messages: panelBase("hooks"), steps: hooksSteps, expect: { error: ".setp-error", rows: ".setp-row", heading: ".setp-h" } },
  { name: "panel-context", ...CHAT_PAGE, fixture: "panels", messages: panelBase("context"), steps: contextSteps, expect: { panel: ".cmdp", total: ".up-total", stack: ".up-stack > div", legend: ".up-legend li", sub: ".up-sub" } },
  { name: "panel-usage", ...CHAT_PAGE, fixture: "panels", messages: panelBase("usage"), expect: { panel: ".cmdp", windows: ".up-window", warn: ".up-track.warn", danger: ".up-track.danger", session: ".up-legend li", shares: ".up-share", periods: ".up-sub" } },
  { name: "panel-usage-narrow", ...CHAT_PAGE, width: 900, fixture: "panels", messages: panelBase("usage"), expect: { panel: ".cmdp", windows: ".up-window" } },
  { name: "panel-usage-basic", ...CHAT_PAGE, fixture: "panels", messages: panelBase("usage-basic"), expect: { panel: ".cmdp", note: ".cmdp-empty" } },
  { name: "panel-config", ...CHAT_PAGE, fixture: "panels", messages: panelBase("config"), steps: configSteps, expect: { panel: ".cmdp", search: ".cfg-search", rows: ".cfg-row", on: ".cfg-on", select: "select.cfg-input" } },
  { name: "panel-skills", ...CHAT_PAGE, fixture: "panels", messages: panelBase("skills"), expect: { panel: ".cmdp", skills: ".up-skills li", tokens: ".up-skill-head .up-num" } },
  { name: "panel-skills-notokens", ...CHAT_PAGE, fixture: "panels", messages: panelBase("skills-notokens"), expect: { note: ".up-note", skills: ".up-skills li" } },
  { name: "panel-loops", ...CHAT_PAGE, fixture: "panels", messages: panelBase("loops"), steps: loopsSteps, expect: { panel: ".cmdp", rows: ".loops-row", unknown: ".cmdp-empty" } },
  { name: "panel-loops-session", ...CHAT_PAGE, fixture: "panels", messages: panelBase("loops-session"), expect: { rows: ".loops-row", none: ".cmdp-empty" } },
  { name: "panel-daemon", ...CHAT_PAGE, fixture: "panels", messages: panelBase("daemon"), steps: daemonSteps, expect: { state: ".daemon-dot.on", fields: ".daemon-fields dt", raw: ".daemon-raw", actions: ".daemon-actions button", configured: ".daemon-title" } },
  { name: "panel-daemon-off", ...CHAT_PAGE, fixture: "panels", messages: panelBase("daemon-off"), expect: { state: ".daemon-dot", raw: ".daemon-raw", actions: ".daemon-actions button" } },
  { name: "header-chips", ...CHAT_PAGE, fixture: "panels", messages: () => fixture("panels").header, steps: headerSteps, expect: { header: ".chat-header", mcp: ".hdr-mcp", context: ".hdr-context", remote: ".hdr-pr" } },
  { name: "command-output", ...CHAT_PAGE, fixture: "panels", messages: () => fixture("panels").cmdout, expect: { table: "pre.tr-cmdout", markdown: ".tr-text table" } },
  { name: "mermaid", html: "mermaid.html", steps: mermaidSteps, expect: { diagrams: ".mermaid-diagram:not([hidden]) svg", toggle: ".mermaid-toggle:not([hidden])", error: ".mermaid-error:not([hidden])", fallback: ".mermaid-block[data-state=error] .code-block" } },
  { name: "settings", ...CENTER_PAGE, tab: "settings", messages: () => [settingsMessage()], expect: { groups: ".setting-group", settings: ".setting" } }
];

async function shoot(browser, screen, errors) {
  const context = await browser.newContext({ viewport: { width: screen.width ?? 1440, height: screen.height ?? 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const fail = (text) => errors.push(`${screen.name}: ${text}`);
  page.on("console", (message) => message.type() === "error" && fail(`console error: ${message.text()}`));
  page.on("pageerror", (error) => fail(`page error: ${error.message}`));
  page.on("requestfailed", (request) => fail(`request failed: ${request.url()}`));

  const tab = screen.tab;
  await page.addInitScript(`window.__SNAPSHOT_NOW = ${NOW};${tab ? `window.__argusTabs = ${JSON.stringify(TABS)}; window.__argusActive = ${JSON.stringify(tab)};` : ""}`);
  await page.goto(pathToFileURL(path.join(root, "scripts", "snapshots", screen.html)).href);
  const data = tab ? undefined : fixture(screen.fixture ?? screen.name);
  if (tab) {
    const mark = readFileSync(path.join(root, "media", "logo-mono.svg"), "utf8").replace(/<title>.*?<\/title>/s, "").replace('width="24" height="24"', 'width="16" height="16"');
    await page.evaluate((svg) => (document.querySelector(".mark").innerHTML = `<span>${svg}</span>Argus`), mark);
  }
  if (screen.theme === "light") await page.addStyleTag({ content: LIGHT_THEME });
  await page.evaluate((messages) => window.__harness.play(messages), screen.messages ? screen.messages() : data.messages);
  await screen.steps?.(page, data);
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);

  const counts = {};
  for (const [label, selector] of Object.entries(screen.expect)) {
    counts[label] = await page.locator(selector).count();
    if (counts[label] === 0) fail(`missing ${label} (${selector})`);
  }
  const loading = await page.evaluate(() => /Loading/.test(document.body.innerText));
  if (loading) fail("a loading placeholder is visible");

  const file = path.join(outDir, `${screen.name}.png`);
  await page.screenshot({ path: file, animations: "disabled", caret: "hide" });
  console.log(`${screen.name.padEnd(10)} ${Object.entries(counts).map(([label, count]) => `${label}=${count}`).join(" ")} -> ${path.relative(root, file)}`);
  await context.close();
}

if (!existsSync(path.join(root, "out", "chat", "webview.js"))) {
  console.error("out/chat/webview.js is missing: run `node scripts/build-chat.mjs` first.");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const errors = [];
try {
  for (const screen of SCREENS) {
    await shoot(browser, screen, errors).catch((error) => errors.push(`${screen.name}: ${error.message.split("\n")[0]}`));
  }
} finally {
  await browser.close();
}
if (errors.length > 0) {
  console.error(`\n${errors.length} problem(s):\n${errors.map((line) => `  ${line}`).join("\n")}`);
  process.exit(1);
}
