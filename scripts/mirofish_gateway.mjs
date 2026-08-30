import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";

// Local MiroFish gateway only. FINVERSE database reads use
// FINVERSE_DATABASE_URL directly in Next.js routes and sync scripts.
const port = Number(process.env.FINVERSE_MIROFISH_GATEWAY_PORT || 5440);
const allowedOntologyPeriods = new Set(["7일", "30일", "3개월"]);
const ontologyEvidenceFiles = ["market-evidence.md", "economic-evidence.md", "external-event-evidence.md", "psychology-evidence.md"];
const ontologyEvidenceManifest = "evidence-manifest.json";
const ontologySessionCachePath = resolve(process.cwd(), "output", ".finverse-ontology-session-cache.json");
const sessionReuseWindowMs = 24 * 60 * 60 * 1000;

const ontologyEvent = (type, value = {}) => `${JSON.stringify({ type, ...value })}\n`;

async function appendRunLog(outputDir, event, fields = {}) {
  if (!outputDir) return;
  const entry = `${new Date().toISOString()} | BRIDGE | ${event} | ${JSON.stringify(fields)}\n`;
  try {
    await appendFile(resolve(outputDir, "run.log"), entry, "utf8");
  } catch (error) {
    console.warn("[ontology] unable to append durable run log", error);
  }
}

function koreaSnapshotDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function ontologyCacheKey({ query, period }) {
  const model = process.env.OPENROUTER_MODEL || "google/gemma-4-31b-it:free";
  const normalizedQuery = query.replace(/\s+/g, " ").trim().toLowerCase();
  return createHash("sha256").update(JSON.stringify({ normalizedQuery, period, model, snapshotDate: koreaSnapshotDate() })).digest("hex");
}

function ontologySessionKey({ query, period }) {
  const model = process.env.OPENROUTER_MODEL || "google/gemma-4-31b-it:free";
  const normalizedQuery = query.replace(/\s+/g, " ").trim().toLowerCase();
  return createHash("sha256").update(JSON.stringify({ normalizedQuery, period, model })).digest("hex");
}

async function readOntologySessionCache() {
  try {
    const data = JSON.parse(await readFile(ontologySessionCachePath, "utf8"));
    return data && typeof data === "object" ? { version: 2, entries: data.entries || {}, sessions: data.sessions || {} } : { version: 2, entries: {}, sessions: {} };
  } catch {
    return { version: 2, entries: {}, sessions: {} };
  }
}

async function readEvidenceDocuments(outputDir) {
  return Promise.all(ontologyEvidenceFiles.map(async (name) => {
    try {
      return { name, content: await readFile(resolve(outputDir, name), "utf8") };
    } catch {
      return { name, content: "" };
    }
  }));
}

async function readCompleteEvidenceBundle(outputDir) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(resolve(outputDir, ontologyEvidenceManifest), "utf8"));
  } catch {
    return null;
  }
  if (manifest?.version !== 1 || manifest?.status !== "complete" || !Array.isArray(manifest.documents)) return null;
  const items = await readEvidenceDocuments(outputDir);
  const metadata = new Map(manifest.documents.map((item) => [item?.name, item]));
  for (const item of items) {
    const expected = metadata.get(item.name);
    if (!item.content.trim() || !expected?.sha256) return null;
    const actualHash = createHash("sha256").update(Buffer.from(item.content, "utf8")).digest("hex");
    if (actualHash !== expected.sha256) return null;
  }
  if (metadata.size !== ontologyEvidenceFiles.length) return null;
  return { manifest, items };
}

function isReusableSessionEntry(entry) {
  if (!entry?.updatedAt) return false;
  const updatedAt = Date.parse(entry.updatedAt);
  return Number.isFinite(updatedAt) && Date.now() - updatedAt <= sessionReuseWindowMs;
}

async function findReusableOntologyRun({ query, period, sessionId }) {
  const cache = await readOntologySessionCache();
  const key = ontologyCacheKey({ query, period });
  const model = process.env.OPENROUTER_MODEL || "google/gemma-4-31b-it:free";
  const sessionEntry = sessionId ? cache.sessions?.[sessionId]?.[ontologySessionKey({ query, period })] : null;
  const candidates = [
    ...(sessionEntry && isReusableSessionEntry(sessionEntry) ? [{ entry: sessionEntry, source: "session" }] : []),
    ...(cache.entries?.[key] ? [{ entry: cache.entries[key], source: "daily" }] : []),
  ];
  for (const candidate of candidates) {
    if (!candidate.entry.outputDir || candidate.entry.model !== model) continue;
    const bundle = await readCompleteEvidenceBundle(candidate.entry.outputDir);
    if (bundle) return { key, entry: candidate.entry, items: bundle.items, manifest: bundle.manifest, source: candidate.source };
  }
  return null;
}

async function saveOntologySessionRun({ key, query, period, outputDir, sessionId }) {
  const cache = await readOntologySessionCache();
  const existing = cache.entries?.[key] || {};
  const sessionIds = new Set(Array.isArray(existing.sessionIds) ? existing.sessionIds : []);
  if (sessionId) sessionIds.add(sessionId);
  cache.entries = {
    ...(cache.entries || {}),
    [key]: {
      outputDir,
      query,
      period,
      model: process.env.OPENROUTER_MODEL || "google/gemma-4-31b-it:free",
      snapshotDate: koreaSnapshotDate(),
      createdAt: existing.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sessionIds: [...sessionIds].slice(-20),
    },
  };
  if (sessionId) {
    const sessionKey = ontologySessionKey({ query, period });
    cache.sessions = {
      ...(cache.sessions || {}),
      [sessionId]: {
        ...(cache.sessions?.[sessionId] || {}),
        [sessionKey]: {
          outputDir,
          query,
          period,
          model: process.env.OPENROUTER_MODEL || "google/gemma-4-31b-it:free",
          snapshotDate: koreaSnapshotDate(),
          createdAt: cache.sessions?.[sessionId]?.[sessionKey]?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
    };
  }
  await mkdir(resolve(process.cwd(), "output"), { recursive: true });
  await writeFile(ontologySessionCachePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

async function readMirofishManifest(outputDir) {
  try {
    return JSON.parse(await readFile(resolve(outputDir, "mirofish", "mirofish-manifest.json"), "utf8"));
  } catch {
    return null;
  }
}

async function readRemoteMirofishJobId(outputDir) {
  try {
    const remoteState = JSON.parse(await readFile(resolve(outputDir, "mirofish", "remote-simulation.json"), "utf8"));
    const jobId = String(remoteState.jobId || remoteState.result?.remote_job_id || "");
    if (jobId) return jobId;
  } catch { /* fall through to the reusable manifest */ }
  const manifest = await readMirofishManifest(outputDir);
  return String(manifest?.remote_job_id || "");
}

function simulationApiConfig() {
  const url = process.env.FINVERSE_SIMULATION_API_URL?.trim().replace(/\/$/, "");
  return url ? { url, token: process.env.FINVERSE_SIMULATION_API_TOKEN?.trim() || "" } : null;
}

async function simulationApiRequest(config, path, options = {}) {
  const response = await fetch(`${config.url}${path}`, {
    ...options,
    headers: {
      ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `원격 시뮬레이션 API 요청에 실패했습니다. (${response.status})`);
  return body;
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function runRemoteMirofishPipeline(response, { outputDir, query, period }, config) {
  const bundle = await readCompleteEvidenceBundle(outputDir);
  if (!bundle) throw new Error("이번 실행에서 완성된 Evidence 문서 4종을 확인할 수 없습니다.");
  const documents = bundle.items;
  await appendRunLog(outputDir, "remote_pipeline_start", { period, evidenceFiles: documents.map((document) => document.name) });
  response.write(ontologyEvent("mirofish_stage", { stage: 2, status: "running", message: "수집된 Evidence를 원격 Neo4j 시뮬레이션 API로 전달했습니다." }));
  let created;
  try {
    created = await simulationApiRequest(config, "/v1/scenario-jobs", {
      method: "POST",
      body: JSON.stringify({ query, period, evidence: documents }),
    });
  } catch (error) {
    await appendRunLog(outputDir, "remote_job_create_error", { message: error instanceof Error ? error.message : String(error) });
    throw error;
  }
  const jobId = created.job_id;
  await appendRunLog(outputDir, "remote_job_created", { jobId, status: created.status, reused: Boolean(created.reused) });
  let after = 0;
  let result = null;
  const stageEvents = {};
  let latestGraphSnapshot = null;
  for (;;) {
    const job = await simulationApiRequest(config, `/v1/scenario-jobs/${encodeURIComponent(jobId)}?after=${after}`);
    for (const event of job.events || []) {
      after = Math.max(after, Number(event.seq) || 0);
      await appendRunLog(outputDir, "remote_job_event", { jobId, event });
      if (event.type === "stage") {
        if (event.stage) stageEvents[event.stage] = event;
        response.write(ontologyEvent("mirofish_stage", event));
      }
      else if (event.type === "graph_snapshot") {
        latestGraphSnapshot = event;
        response.write(ontologyEvent("mirofish_graph_snapshot", event));
      }
      else if (event.type === "log") response.write(ontologyEvent("log", { source: event.source || "runtime", line: event.line || event.message || "" }));
      else if (event.type === "ready") {
        result = event;
        response.write(ontologyEvent("mirofish_ready", { ...event, remote_job_id: jobId }));
      } else if (event.type === "error") {
        throw new Error(event.message || "원격 시뮬레이션 준비 중 오류가 발생했습니다.");
      }
    }
    if (job.status === "ready" && result) {
      await mkdir(resolve(outputDir, "mirofish"), { recursive: true });
      const completed = {
        ...(job.result || result),
        remote_job_id: jobId,
        stage_events: stageEvents,
        graph_snapshot: latestGraphSnapshot,
      };
      await writeFile(resolve(outputDir, "mirofish", "remote-simulation.json"), `${JSON.stringify({ jobId, result: completed }, null, 2)}\n`, "utf8");
      // The reusable-run path reads the same manifest name for local and
      // remote execution.  Previously remote jobs never wrote this file, so
      // every click replayed ontology generation even after a completed job.
      await writeFile(resolve(outputDir, "mirofish", "mirofish-manifest.json"), `${JSON.stringify(completed, null, 2)}\n`, "utf8");
      await appendRunLog(outputDir, "remote_pipeline_complete", { jobId, result: completed });
      return completed;
    }
    if (job.status === "failed") {
      await appendRunLog(outputDir, "remote_pipeline_failed", { jobId, error: job.error || "unknown" });
      throw new Error(job.error || "원격 시뮬레이션 준비에 실패했습니다.");
    }
    await sleep(1_200);
  }
}

async function runMirofishPipeline(response, { outputDir, query, period }) {
  if (!await readCompleteEvidenceBundle(outputDir)) {
    throw new Error("Evidence 수집 완료 표시와 문서 해시가 일치하지 않아 MiroFish를 시작하지 않았습니다.");
  }
  const remoteApi = simulationApiConfig();
  if (remoteApi) return runRemoteMirofishPipeline(response, { outputDir, query, period }, remoteApi);
  const requirement = `${query}\n\n예측 기간: ${period}. 이 기간을 기준으로 근거·불확실성·확인 지표를 정리한다.`;
  await appendRunLog(outputDir, "local_pipeline_start", { period });
  response.write(ontologyEvent("mirofish_stage", { stage: 2, status: "running", message: "수집된 근거를 바탕으로 MiroFish 온톨로지 생성을 시작합니다." }));
  const child = spawn("uv", ["run", "--no-sync", "python", "-u", "-m", "agents.mirofish_pipeline", "--input-dir", outputDir, "--requirement", requirement, "--project-name", "FINVERSE 시장 시나리오"], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const pending = { stdout: "", stderr: "" };
  let result = null;
  const forward = (source, chunk) => {
    pending[source] += chunk.toString("utf8").replace(/\r/g, "");
    const lines = pending[source].split("\n");
    pending[source] = lines.pop() || "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      void appendRunLog(outputDir, "local_pipeline_output", { source, line });
      const marker = "mirofish_pipeline | ";
      if (line.startsWith(marker)) {
        try {
          const payload = JSON.parse(line.slice(marker.length));
          if (payload.event === "stage" || payload.event === "progress") {
            response.write(ontologyEvent("mirofish_stage", payload));
            continue;
          }
          if (payload.event === "graph_snapshot") {
            response.write(ontologyEvent("mirofish_graph_snapshot", payload));
            continue;
          }
          if (payload.event === "pipeline_complete") {
            result = payload;
            response.write(ontologyEvent("mirofish_ready", payload));
            continue;
          }
          if (payload.event === "pipeline_error") {
            response.write(ontologyEvent("mirofish_error", { message: payload.error || "MiroFish 준비 중 오류가 발생했습니다." }));
            continue;
          }
        } catch { /* keep the original line as a diagnostic log */ }
      }
      response.write(ontologyEvent("log", { source, line }));
    }
  };
  child.stdout.on("data", (chunk) => forward("stdout", chunk));
  child.stderr.on("data", (chunk) => forward("stderr", chunk));
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  for (const source of ["stdout", "stderr"]) if (pending[source].trim()) forward(source, Buffer.from(`${pending[source]}\n`, "utf8"));
  if (code !== 0 || !result) {
    throw new Error(`MiroFish Python 준비 작업이 종료되었습니다. (code ${code ?? "unknown"})`);
  }
  return result;
}

async function startMirofishSimulation(response, body) {
  const inputDir = typeof body.outputDir === "string" ? body.outputDir.trim() : "";
  const period = typeof body.period === "string" ? body.period : "";
  const rounds = { "7일": 168, "30일": 720, "3개월": 2160 }[period];
  if (!inputDir || !rounds) {
    response.writeHead(400, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "시뮬레이션 준비 결과 또는 예측 기간이 올바르지 않습니다." }));
    return;
  }
  const remoteApi = simulationApiConfig();
  if (remoteApi) {
    try {
      const jobId = await readRemoteMirofishJobId(inputDir);
      if (!jobId) throw new Error("원격 시뮬레이션 작업 ID가 없습니다.");
      const result = await simulationApiRequest(remoteApi, `/v1/scenario-jobs/${encodeURIComponent(jobId)}/start`, { method: "POST", body: "{}" });
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify(result));
    } catch (error) {
      response.writeHead(503, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "원격 MiroFish 시나리오를 시작하지 못했습니다." }));
    }
    return;
  }
  const child = spawn("uv", ["run", "--no-sync", "python", "-u", "-m", "agents.mirofish_start", "--input-dir", inputDir, "--max-rounds", String(rounds)], {
    cwd: process.cwd(), env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
  if (code !== 0) throw new Error(stderr.trim() || `MiroFish simulation exited with code ${code}`);
  response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(stdout.trim() || "{}");
}

async function getMirofishRuntime(response, body) {
  const inputDir = typeof body.outputDir === "string" ? body.outputDir.trim() : "";
  if (!inputDir) {
    response.writeHead(400, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "시뮬레이션 실행 폴더가 올바르지 않습니다." }));
    return;
  }
  const remoteApi = simulationApiConfig();
  if (!remoteApi) {
    response.writeHead(503, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "원격 시뮬레이션 API가 설정되지 않았습니다." }));
    return;
  }
  const jobId = await readRemoteMirofishJobId(inputDir);
  if (!jobId) throw new Error("원격 시뮬레이션 작업 ID가 없습니다.");
  const runtime = await simulationApiRequest(remoteApi, `/v1/scenario-jobs/${encodeURIComponent(jobId)}/runtime`);
  response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(runtime));
}

async function chatWithMirofish(response, body) {
  const inputDir = typeof body.outputDir === "string" ? body.outputDir.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!inputDir || !message || message.length > 2_000) {
    response.writeHead(400, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "실행 폴더 또는 대화 내용이 올바르지 않습니다." }));
    return;
  }
  const remoteApi = simulationApiConfig();
  if (!remoteApi) {
    response.writeHead(503, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "원격 시뮬레이션 API가 설정되지 않았습니다." }));
    return;
  }
  const jobId = await readRemoteMirofishJobId(inputDir);
  if (!jobId) throw new Error("원격 시뮬레이션 작업 ID가 없습니다.");
  const result = await simulationApiRequest(remoteApi, `/v1/scenario-jobs/${encodeURIComponent(jobId)}/chat`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
  response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(result));
}

async function runOntology(request, response, body) {
  const query = typeof body.query === "string" ? body.query.trim() : "";
  const period = typeof body.period === "string" ? body.period : "";
  const sessionId = typeof body.sessionId === "string" && /^[a-zA-Z0-9_-]{8,128}$/.test(body.sessionId) ? body.sessionId : "";
  if (query.length < 8 || query.length > 1_200 || !allowedOntologyPeriods.has(period)) {
    response.writeHead(400, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "질문 또는 예측 기간이 올바르지 않습니다." }));
    return;
  }

  response.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  response.flushHeaders?.();
  response.write(ontologyEvent("started", { query, period }));
  response.write(ontologyEvent("log", { source: "system", line: "시나리오 실행 정보를 확인하고 있습니다." }));
  console.info("[ontology] request received", { period, queryLength: query.length, sessionId: Boolean(sessionId) });
  const reusable = await findReusableOntologyRun({ query, period, sessionId });
  if (reusable) {
    console.info("[ontology] reusable evidence found", { outputDir: reusable.entry.outputDir, source: reusable.source });
    response.write(ontologyEvent("started", { query, period, reused: true, outputDir: reusable.entry.outputDir }));
    response.write(ontologyEvent("log", { source: "system", line: reusable.source === "session" ? "이 브라우저 세션에서 최근에 준비한 Evidence 문서를 불러왔습니다. 새 데이터 수집과 LLM 호출은 건너뜁니다." : "오늘 이미 완성한 Evidence 문서를 불러왔습니다. 새 데이터 수집과 LLM 호출은 건너뜁니다." }));
    response.write(ontologyEvent("documents", { outputDir: reusable.entry.outputDir, items: reusable.items }));
    const manifest = await readMirofishManifest(reusable.entry.outputDir);
    if (manifest?.simulation_id) {
      if (Array.isArray(manifest.entity_types) || Array.isArray(manifest.relation_types)) {
        response.write(ontologyEvent("mirofish_stage", { stage: 2, status: "complete", message: "이전 실행의 온톨로지를 불러왔습니다.", entity_types: manifest.entity_types || [], relation_types: manifest.relation_types || [] }));
      }
      if (manifest.graph_snapshot) response.write(ontologyEvent("mirofish_graph_snapshot", manifest.graph_snapshot));
      response.write(ontologyEvent("mirofish_stage", { stage: 3, status: "complete", message: "이전 실행의 Neo4j 지식그래프를 불러왔습니다.", nodes: manifest.node_count || 0, edges: manifest.edge_count || 0 }));
      for (const stage of [4, 5, 6]) response.write(ontologyEvent("mirofish_stage", { stage, status: "complete", message: stage === 6 ? "이전 세션의 MiroFish 준비 결과를 불러왔습니다." : "이전 실행 결과를 불러왔습니다." }));
      response.write(ontologyEvent("mirofish_ready", manifest));
      response.write(ontologyEvent("complete", { code: 0, reused: true, message: "기존 시뮬레이션 준비 결과를 재사용합니다." }));
      response.end();
      return;
    }
    try {
      await runMirofishPipeline(response, { outputDir: reusable.entry.outputDir, query, period });
      response.write(ontologyEvent("complete", { code: 0, reused: true, message: "기존 Evidence 문서로 MiroFish 준비를 완료했습니다." }));
    } catch (error) {
      response.write(ontologyEvent("mirofish_error", { message: error instanceof Error ? error.message : "MiroFish 준비를 완료하지 못했습니다." }));
      response.write(ontologyEvent("error", { code: 1, message: "기존 Evidence 문서는 불러왔지만 MiroFish 준비 단계에서 오류가 발생했습니다." }));
    }
    response.end();
    return;
  }

  const scenarioQuery = `${query}\n\n예측 기간: ${period}. 이 기간을 기준으로 근거·불확실성·확인 지표를 정리한다.`;
  // Data collection must start immediately. MiroFish's optional runtime is
  // installed separately, so it must not block Evidence-folder creation.
  const workerArgs = ["run", "--no-sync", "python", "-u", "-m", "agents.ontology_a2a", scenarioQuery];
  if (sessionId) workerArgs.push("--session-id", sessionId);
  const child = spawn("uv", workerArgs, {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  console.info("[ontology] python worker spawned", { pid: child.pid });
  response.write(ontologyEvent("log", { source: "system", line: "원격 시장 데이터를 수집하는 Python 작업을 시작했습니다." }));
  const pending = { stdout: "", stderr: "" };
  let stdoutRaw = "";
  let activeOutputDir = "";
  let documentPublish = Promise.resolve();
  let mirofishPreparation = null;
  const beginMirofishPreparation = (outputDir) => {
    if (mirofishPreparation) return mirofishPreparation;
    void appendRunLog(outputDir, "evidence_complete_start_pipeline", { query, period, sessionId: sessionId || null });
    response.write(ontologyEvent("log", { source: "system", line: "Evidence 문서 4종이 준비되어 온톨로지 생성 단계로 진행합니다." }));
    mirofishPreparation = runMirofishPipeline(response, { outputDir, query, period });
    // The collection worker can continue its final review after all four files
    // are ready. Attach a handler now so an early MiroFish failure is reported
    // at worker completion instead of becoming an unhandled rejection.
    mirofishPreparation.catch(() => {});
    return mirofishPreparation;
  };
  const publishDocuments = () => {
    if (!activeOutputDir) return;
    documentPublish = documentPublish.then(async () => {
      const items = await readEvidenceDocuments(activeOutputDir);
      response.write(ontologyEvent("documents", { outputDir: activeOutputDir, items }));
    }).catch(() => { /* a document can be read on the next completed save */ });
  };
  const processLine = (source, rawLine) => {
    const line = rawLine.trim();
    if (!line) return;
    if (source === "stdout") {
      try {
        const payload = JSON.parse(line);
        if ((payload.event === "started" || payload.event === "evidence_ready") && typeof payload.output_dir === "string") activeOutputDir = payload.output_dir;
      } catch { /* regular runtime log */ }
    }
    if (line.includes("evidence_saved") || line.includes("evidence_gap_saved")) publishDocuments();
    if (activeOutputDir) void appendRunLog(activeOutputDir, "collection_output", { source, line });
    response.write(ontologyEvent("log", { source, line }));
  };
  const forward = (source, chunk) => {
    if (source === "stdout") stdoutRaw += chunk.toString("utf8");
    pending[source] += chunk.toString("utf8").replace(/\r/g, "");
    const lines = pending[source].split("\n");
    pending[source] = lines.pop() || "";
    for (const line of lines) processLine(source, line);
  };
  child.stdout.on("data", (chunk) => forward("stdout", chunk));
  child.stderr.on("data", (chunk) => forward("stderr", chunk));
  child.on("error", (error) => {
    console.error("[ontology] python worker spawn error", error);
    response.write(ontologyEvent("error", { message: error.message }));
    response.end();
  });
  child.on("close", async (code) => {
    console.info("[ontology] python worker closed", { code });
    for (const source of ["stdout", "stderr"]) if (pending[source].trim()) processLine(source, pending[source]);
    await documentPublish;
    const outputLine = stdoutRaw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1);
    const outputDir = activeOutputDir || (() => { try { return JSON.parse(outputLine || "{}").output_dir; } catch { return ""; } })();
    if (typeof outputDir === "string" && outputDir) await appendRunLog(outputDir, "collection_worker_closed", { code });
    if (code !== 0 || !outputDir) {
      response.write(ontologyEvent("error", { code, message: code !== 0 ? `Evidence 수집 실행이 종료되었습니다. (code ${code})` : "Evidence 실행 폴더를 확인할 수 없습니다." }));
      response.end();
      return;
    }
    const bundle = await readCompleteEvidenceBundle(outputDir);
    if (!bundle) {
      response.write(ontologyEvent("error", { code: 1, message: "Evidence 문서가 모두 저장됐지만 이번 실행의 완료 표시 또는 문서 해시가 올바르지 않습니다." }));
      response.end();
      return;
    }
    response.write(ontologyEvent("documents", { outputDir, items: bundle.items }));
    await saveOntologySessionRun({ key: ontologyCacheKey({ query, period }), query, period, outputDir, sessionId });
    response.write(ontologyEvent("log", { source: "system", line: "이번 실행의 Evidence 문서 4종을 검증했습니다. 온톨로지 생성 단계로 진행합니다." }));
    try {
      await (mirofishPreparation ?? beginMirofishPreparation(outputDir));
    } catch (error) {
      response.write(ontologyEvent("mirofish_error", { message: error instanceof Error ? error.message : "MiroFish 준비를 완료하지 못했습니다." }));
      response.write(ontologyEvent("error", { code: 1, message: "Evidence 문서는 생성됐지만 MiroFish 준비 단계에서 오류가 발생했습니다." }));
      response.end();
      return;
    }
    response.write(ontologyEvent("complete", { code: 0, message: "MiroFish 시뮬레이션 준비가 완료되었습니다." }));
    response.end();
  });
  response.on("close", () => {
    // The agent writes durable output/run.log files. Keep it running even if a
    // browser refresh, proxy timeout, or client navigation closes this stream.
    // Previously this handler killed the worker around 30 seconds into data
    // collection, before the Evidence Markdown files could be saved.
    if (!child.killed && child.exitCode === null) {
      console.warn("Ontology client disconnected; continuing the background run.");
    }
  });
}

const server = createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/ontology/run") {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      try {
        void runOntology(request, response, JSON.parse(body)).catch((error) => {
          response.writeHead(500, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : "온톨로지 실행을 시작하지 못했습니다." }));
        });
      } catch {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "요청 형식이 올바르지 않습니다." }));
      }
    });
    return;
  }
  if (request.method === "POST" && request.url === "/mirofish/start") {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "요청 형식이 올바르지 않습니다." }));
        return;
      }
      Promise.resolve(startMirofishSimulation(response, parsed)).catch((error) => {
        response.writeHead(503, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: error instanceof Error ? error.message : "MiroFish 시뮬레이션을 시작하지 못했습니다." }));
      });
    });
    return;
  }
  if (request.method === "POST" && request.url === "/mirofish/runtime") {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      try {
        Promise.resolve(getMirofishRuntime(response, JSON.parse(body))).catch((error) => {
          response.writeHead(503, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : "시뮬레이션 상태를 불러오지 못했습니다." }));
        });
      } catch {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "요청 형식이 올바르지 않습니다." }));
      }
    });
    return;
  }
  if (request.method === "POST" && request.url === "/mirofish/chat") {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      try {
        Promise.resolve(chatWithMirofish(response, JSON.parse(body))).catch((error) => {
          response.writeHead(503, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : "시뮬레이션 대화를 완료하지 못했습니다." }));
        });
      } catch {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "요청 형식이 올바르지 않습니다." }));
      }
    });
    return;
  }
  response.writeHead(404, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ error: "Not found" }));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`FINVERSE MiroFish gateway listening on http://127.0.0.1:${port}`);
});
