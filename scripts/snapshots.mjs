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
  await page.locator(".det-file").first().click();
  for (const [line, text] of [[5, "Should subtract reject NaN inputs like add does in the validator?"], [6, "Why not reuse add(a, -b) here?"]]) {
    const row = page.locator(`[data-line="src/math.ts:new:${line}"]`);
    await row.locator(".review-line").click();
    await row.locator("textarea").fill(text);
  }
  await page.keyboard.press("Meta+Enter");
  await page.evaluate((messages) => window.__harness.play(messages), then);
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

async function boardSteps(page) {
  await page.getByLabel("Expand then contract").check();
}

async function textOnlySteps(page) {
  await page.keyboard.press("Meta+Shift+T");
  await page.locator('.tr-pill[aria-pressed="true"]').waitFor();
}

async function reviewPrSteps(page) {
  await page.getByRole("button", { name: "Diff of #412" }).click();
  await page.locator(".review-diff .review-line").first().waitFor();
}

const CHAT_PAGE = { html: "chat.html" };
const CENTER_PAGE = { html: "center.html" };

const SCREENS = [
  { name: "chat", ...CHAT_PAGE, expect: { todos: ".tr-todos", diffCard: ".tr-diff", agent: ".tr-row strong", streaming: ".tr-cursor", cache: ".det-row[title=\"Prompt cache expires if idle\"]", effort: ".cmp-effort .on", details: ".det-section", agentsChip: ".hdr-agents", agentDots: ".hdr-agent-dots .hdr-dot" } },
  { name: "permission", ...CHAT_PAGE, expect: { permission: ".perm-card", command: ".perm-code", actions: ".perm-actions button" } },
  { name: "plan", ...CHAT_PAGE, steps: planSteps, expect: { planPane: ".plan-pane", planBlocks: ".plan-block", comment: ".plan-comment", approve: ".plan-foot button" } },
  { name: "review", ...CHAT_PAGE, steps: reviewSteps, expect: { overlay: ".review", threads: ".review-thread", answered: ".review-claude:not(.review-working)", inProgress: ".review-working", files: ".review-file" } },
  { name: "review-pr", ...CHAT_PAGE, messages: () => [...fixture("review").messages, ...fixture("review-pr").messages], steps: reviewPrSteps, expect: { overlay: ".review", prTab: '.review-tabs [aria-selected="true"]', files: ".review-file", deleted: ".review-k-del" } },
  { name: "grid", ...CHAT_PAGE, expect: { tiles: ".grid-tile", needsYou: ".grid-tile.needs", summary: ".grid-needs", groupName: ".grid-group", addAgent: ".grid-add-agent" } },
  { name: "board", ...CENTER_PAGE, height: 1200, tab: "sessions", messages: () => fixture("board").messages, steps: boardSteps, expect: { cards: ".row", permission: ".pending-code", question: ".pending-q", columns: ".scol", group: ".row.group", agents: ".row.group .agent", groupPending: ".row.group .agent-pending .pending-code" } },
  { name: "workflow", ...CHAT_PAGE, steps: workflowSteps, expect: { card: ".wf-card", pane: ".wf-pane", phases: ".wf-column", failed: ".wf-agent-failed", detail: ".wf-detail" } },
  { name: "text-only", ...CHAT_PAGE, steps: textOnlySteps, expect: { pill: '.tr-pill[aria-pressed="true"]', divider: ".tr-hidden", text: ".tr-text" } },
  { name: "working", ...CHAT_PAGE, expect: { working: ".tr-working", glyph: ".tr-working-glyph", meta: ".tr-working-meta" } },
  { name: "settings", ...CENTER_PAGE, tab: "settings", messages: () => [settingsMessage()], expect: { groups: ".setting-group", settings: ".setting" } }
];

async function shoot(browser, screen, errors) {
  const context = await browser.newContext({ viewport: { width: 1440, height: screen.height ?? 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const fail = (text) => errors.push(`${screen.name}: ${text}`);
  page.on("console", (message) => message.type() === "error" && fail(`console error: ${message.text()}`));
  page.on("pageerror", (error) => fail(`page error: ${error.message}`));
  page.on("requestfailed", (request) => fail(`request failed: ${request.url()}`));

  const tab = screen.tab;
  await page.addInitScript(`window.__SNAPSHOT_NOW = ${NOW};${tab ? `window.__argusTabs = ${JSON.stringify(TABS)}; window.__argusActive = ${JSON.stringify(tab)};` : ""}`);
  await page.goto(pathToFileURL(path.join(root, "scripts", "snapshots", screen.html)).href);
  const data = tab ? undefined : fixture(screen.name);
  if (tab) {
    const mark = readFileSync(path.join(root, "media", "logo-mono.svg"), "utf8").replace(/<title>.*?<\/title>/s, "").replace('width="24" height="24"', 'width="16" height="16"');
    await page.evaluate((svg) => (document.querySelector(".mark").innerHTML = `<span>${svg}</span>Argus`), mark);
  }
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
