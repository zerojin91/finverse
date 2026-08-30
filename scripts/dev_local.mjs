import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function loadEnv() {
  const envPath = resolve(root, ".env");
  if (!existsSync(envPath)) return;
  for (const raw of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("export ") && !line.includes("=")) continue;
    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const separator = normalized.indexOf("=");
    if (separator < 1) continue;
    const key = normalized.slice(0, separator).trim();
    let value = normalized.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv();

const children = [];
const start = (command, args, label) => {
  const child = spawn(command, args, { cwd: root, env: { ...process.env }, stdio: "inherit", shell: process.platform === "win32" });
  child.on("exit", (code, signal) => {
    if (code && !signal) console.error(`${label} 종료: ${code}`);
  });
  children.push(child);
  return child;
};

start(process.platform === "win32" ? "node" : process.execPath, [resolve(root, "scripts/mirofish_gateway.mjs")], "MiroFish gateway");
if (process.env.FINVERSE_SIMULATION_TUNNEL_ENABLED === "1") {
  start(process.platform === "win32" ? "node" : process.execPath, [resolve(root, "scripts/simulation_api_tunnel.mjs")], "simulation API tunnel");
}
// 페이퍼 트레이딩 엔진. 예전에는 FinSimulation을 따로 띄워야 했다.
const paperPython = process.env.FINVERSE_PYTHON?.trim()
  || (existsSync(resolve(root, ".venv-paper/bin/python")) ? resolve(root, ".venv-paper/bin/python")
    : process.platform === "win32" && existsSync(resolve(root, ".venv", "Scripts", "python.exe"))
      ? resolve(root, ".venv", "Scripts", "python.exe")
      : "python3");
start(paperPython, ["-m", "services.paper_trading_api"], "paper trading engine");

// vinext dev currently fails while scanning the lazily loaded AI chat bundle,
// while the same Next application builds and runs normally.  Use Next's own
// development server so `npm run dev` remains the single reliable local entry.
start(process.platform === "win32" ? "node" : process.execPath, [resolve(root, "node_modules/next/dist/bin/next"), "dev", "-p", "3000"], "web app");

function shutdown() {
  for (const child of children) if (!child.killed) child.kill("SIGTERM");
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
