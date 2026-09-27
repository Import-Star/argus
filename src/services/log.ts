import * as vscode from "vscode";

// A single shared output channel so every part of the extension (and archive cleanup / session chip
// providers registered by plugins) logs to the same place instead of creating their own "Argus" channel.
export const output = vscode.window.createOutputChannel("Argus");
