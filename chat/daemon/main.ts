import { startDaemon } from "./server";

startDaemon().catch((error) => {
  console.error(error);
  process.exit(1);
});
