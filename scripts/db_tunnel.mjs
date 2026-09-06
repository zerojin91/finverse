import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import net from "node:net";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const env = { ...process.env };
const envPath = resolve(root, ".env");

if (existsSync(envPath)) {
  for (const raw of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const separator = normalized.indexOf("=");
    if (separator < 1) continue;
    const key = normalized.slice(0, separator).trim();
    let value = normalized.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in env)) env[key] = value;
  }
}

const databaseUrl = env.FINVERSE_DATABASE_URL?.trim();
const keyPath = env.FINVERSE_SSH_KEY?.trim();
const sshHost = env.FINVERSE_SSH_HOST?.trim();
const localPort = env.FINVERSE_DATABASE_TUNNEL_PORT?.trim() || "15432";

if (env.FINVERSE_DATABASE_TUNNEL !== "1") {
  console.error("FINVERSE_DATABASE_TUNNEL=1 설정 후 SSH 터널을 실행할 수 있습니다.");
  process.exit(1);
}
if (!databaseUrl || !keyPath || !sshHost) {
  console.error("FINVERSE_DATABASE_URL, FINVERSE_SSH_KEY, FINVERSE_SSH_HOST 설정이 필요합니다.");
  process.exit(1);
}
if (!existsSync(keyPath)) {
  console.error("FINVERSE_SSH_KEY 경로에서 PEM 파일을 찾지 못했습니다.");
  process.exit(1);
}

const localPortOpen = await new Promise((resolvePort) => {
  const socket = net.createConnection({ host: "127.0.0.1", port: Number(localPort) });
  socket.once("connect", () => {
    socket.destroy();
    resolvePort(true);
  });
  socket.once("error", () => resolvePort(false));
});
if (localPortOpen) {
  console.log(`SSH DB 터널 포트 ${localPort}가 이미 열려 있습니다.`);
  process.exit(0);
}

const remote = new URL(databaseUrl);
const remotePort = remote.port || "5432";
const forward = `${localPort}:${remote.hostname}:${remotePort}`;
const child = spawn("ssh", [
  "-i", keyPath,
  "-o", "ExitOnForwardFailure=yes",
  "-o", "ServerAliveInterval=30",
  "-o", "ServerAliveCountMax=3",
  "-N",
  "-L", forward,
  sshHost,
], { cwd: root, stdio: "inherit" });

child.on("error", (error) => {
  console.error(`SSH 터널을 시작하지 못했습니다: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal !== "SIGINT" && signal !== "SIGTERM" && code !== 0) process.exitCode = code ?? 1;
});
