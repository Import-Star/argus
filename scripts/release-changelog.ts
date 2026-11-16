// Moves every changes/*.md entry into a new "## X.Y.Z" section at the top of CHANGELOG.md, then deletes them.
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const version = process.argv[2] ?? "";
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("usage: npm run changelog -- X.Y.Z");

const root = path.join(import.meta.dirname, "..");
const dir = path.join(root, "changes");
const files = readdirSync(dir).filter((file) => file.endsWith(".md") && file !== "README.md").sort();
if (!files.length) throw new Error("changes/ has no entries");

const entries = files.map((file) => readFileSync(path.join(dir, file), "utf8").trim()).join("\n");
const changelogPath = path.join(root, "CHANGELOG.md");
const changelog = readFileSync(changelogPath, "utf8");
const firstRelease = changelog.indexOf("\n## ");
writeFileSync(changelogPath, `${changelog.slice(0, firstRelease)}\n## ${version}\n\n${entries}\n${changelog.slice(firstRelease)}`);
for (const file of files) rmSync(path.join(dir, file));
