import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const settingsPath = process.env.CLAUDE_BEDROCK_SETTINGS_PATH
  || join(homedir(), ".claude-bedrock", "settings.json");
const settings = await readFile(settingsPath, "utf8")
  .then((raw) => JSON.parse(raw))
  .catch(() => null);
const envPath = join(process.cwd(), ".env.local");
const originalEnv = settings ? await readFile(envPath, "utf8").catch(() => "") : null;
const bedrockKeys = ["AWS_BEARER_TOKEN_BEDROCK", "AWS_REGION", "ANTHROPIC_DEFAULT_SONNET_MODEL"];
if (originalEnv !== null) {
  let runtimeEnv = originalEnv;
  for (const key of bedrockKeys) {
    const value = settings.env?.[key];
    if (!value || /[\r\n]/.test(value)) continue;
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    runtimeEnv = pattern.test(runtimeEnv) ? runtimeEnv.replace(pattern, line) : `${runtimeEnv.trimEnd()}\n${line}\n`;
  }
  await writeFile(envPath, runtimeEnv);
}
const executable = join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "vinext.cmd" : "vinext");
const child = spawn(executable, process.argv.slice(2), {
  stdio: "inherit",
  env: { ...process.env, ...(settings?.env ?? {}) },
  shell: process.platform === "win32",
});
child.on("exit", async (code) => {
  if (originalEnv !== null) await writeFile(envPath, originalEnv);
  process.exit(code ?? 1);
});
