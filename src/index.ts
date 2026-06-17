import { runCli } from "./cli/run.js";

runCli().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`启动失败：${message}`);
  process.exitCode = 1;
});
