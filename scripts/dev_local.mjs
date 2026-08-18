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

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const children = [];
const start = (command, args, label) => {
  const child = spawn(command, args, { cwd: root, env: { ...process.env }, stdio: "inherit", shell: process.platform === "win32" });
  child.on("exit", (code, signal) => {
    if (code && !signal) console.error(`${label} 종료: ${code}`);
  });
  children.push(child);
  return child;
};

console.log(`KOSPI SSH bridge: ${process.env.FINVERSE_SSH_HOST || "ubuntu@44.206.56.75"}`);
console.log(`KOSPI PEM path: ${process.env.FINVERSE_SSH_KEY || "(미설정)"}`);
start(process.platform === "win32" ? "node" : process.execPath, [resolve(root, "scripts/kospi_bridge.mjs")], "KOSPI bridge");
start(npmCommand, ["run", "dev:app"], "web app");

function shutdown() {
  for (const child of children) if (!child.killed) child.kill("SIGTERM");
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
