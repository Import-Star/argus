// Run by VS Code as `node ./out/uninstall.js` after the extension is uninstalled (see package.json's
// "vscode:uninstall" script). No `vscode` module is available here.
import { removeHooks } from "./services/HookInstaller";

try {
  removeHooks();
} catch {
  // Uninstall must not fail the extension's removal.
}
