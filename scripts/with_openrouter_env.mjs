import { spawn } from "node:child_process";
import { join } from "node:path";

const executable = join(
  process.cwd(),
  "node_modules",
  ".bin",
  process.platform === "win32" ? "vinext.cmd" : "vinext",
);
const child = spawn(executable, process.argv.slice(2), {
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});

child.on("exit", (code) => process.exit(code ?? 1));
