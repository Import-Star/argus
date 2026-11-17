import * as os from "os";
import * as path from "path";

export function daemonPaths(): { socket: string; info: string; log: string } {
  const dir = path.join(os.homedir(), ".claude", "argus");
  return {
    socket: process.platform === "win32" ? `\\\\.\\pipe\\argus-chat-${os.userInfo().username}` : path.join(dir, "chat.sock"),
    info: path.join(dir, "chat-daemon.json"),
    log: path.join(dir, "chat-daemon.log")
  };
}
