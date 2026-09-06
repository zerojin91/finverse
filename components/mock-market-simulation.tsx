"use client";

import { useEffect, useState } from "react";

type MockMarketSimulationProps = {
  onOpenJournal: () => void;
  onOpenJudgement: () => void;
};

type MockAction = "journal" | "judgement";

const bridgeScript = String.raw`<script>
  document.addEventListener("click", function (event) {
    var target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    var nav = target.closest('[data-page="twin"]');
    var judgement = target.closest('[data-custom-scenario]');
    if (!nav && !judgement) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.parent.postMessage({ channel: "finverse-mock", action: nav ? "journal" : "judgement" }, "*");
  }, true);
</script>`;

function extractMockDocument(source: string) {
  const container = document.createElement("template");
  container.innerHTML = source;
  const frame = container.content.querySelector("iframe");
  const srcDoc = frame?.getAttribute("srcdoc");
  if (!srcDoc) throw new Error("목업 문서를 읽지 못했습니다.");
  return srcDoc.replace("</body>", `${bridgeScript}</body>`);
}

export function MockMarketSimulation({ onOpenJournal, onOpenJudgement }: MockMarketSimulationProps) {
  const [srcDoc, setSrcDoc] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/finverse-layout-preview%202.html")
      .then((response) => {
        if (!response.ok) throw new Error("목업 파일을 불러오지 못했습니다.");
        return response.text();
      })
      .then((source) => {
        if (active) setSrcDoc(extractMockDocument(source));
      })
      .catch(() => {
        if (active) setSrcDoc("");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const receive = (event: MessageEvent<{ channel?: string; action?: MockAction }>) => {
      if (event.data?.channel !== "finverse-mock") return;
      if (event.data.action === "journal") onOpenJournal();
      if (event.data.action === "judgement") onOpenJudgement();
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [onOpenJournal, onOpenJudgement]);

  if (srcDoc === null) return <main aria-busy="true" style={{ minHeight: "100vh", background: "#fff" }} />;
  if (!srcDoc) return <main role="alert">목업 화면을 불러오지 못했습니다.</main>;

  return <iframe title="FINVERSE 시장 시뮬레이션" srcDoc={srcDoc} style={{ display: "block", width: "100%", minHeight: "100vh", border: 0 }} />;
}
