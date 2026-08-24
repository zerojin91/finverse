import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
for (const raw of existsSync(resolve(root, ".env")) ? readFileSync(resolve(root, ".env"), "utf8").split(/\r?\n/) : []) {
  const line = raw.trim();
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const [key, ...rest] = line.split("=");
  if (!(key.trim() in process.env)) process.env[key.trim()] = rest.join("=").trim().replace(/^(["'])(.*)\1$/, "$2");
}

const keyPath = process.env.FINVERSE_SSH_KEY?.trim();
const host = process.env.FINVERSE_SSH_HOST?.trim();
const localPort = process.env.FINVERSE_SIMULATION_TUNNEL_PORT?.trim() || "8010";
const remotePort = process.env.FINVERSE_SIMULATION_REMOTE_PORT?.trim() || "8010";
if (!keyPath || !host) throw new Error("FINVERSE_SSH_KEY와 FINVERSE_SSH_HOST를 설정해주세요.");

const child = spawn("ssh", [
  "-N",
  "-o", "BatchMode=yes",
  "-o", "ExitOnForwardFailure=yes",
  "-o", "ServerAliveInterval=30",
  "-o", "ServerAliveCountMax=3",
  "-o", "StrictHostKeyChecking=accept-new",
  "-i", keyPath,
  "-L", `${localPort}:127.0.0.1:${remotePort}`,
  host,
], { stdio: "inherit", windowsHide: true });

child.on("exit", (code, signal) => {
  if (code && !signal) console.error(`원격 시뮬레이션 API 터널 종료: ${code}`);
  process.exitCode = code ?? 0;
});
process.on("SIGINT", () => child.kill("SIGTERM"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
