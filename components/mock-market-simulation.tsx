"use client";

import { useEffect, useState } from "react";

type MockMarketSimulationProps = {
  onOpenJournal: () => void;
  onOpenJudgement: () => void;
  onOpenLogin: () => void;
  hideHeader?: boolean;
};

type MockAction = "journal" | "judgement" | "login";

const bridgeScript = String.raw`<script>
  document.addEventListener("click", function (event) {
    var target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    var nav = target.closest('[data-page="twin"]');
    var judgement = target.closest('[data-custom-scenario]');
    var login = target.closest('[data-user]');
    if (!nav && !judgement && !login) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.parent.postMessage({ channel: "finverse-mock", action: nav ? "journal" : judgement ? "judgement" : "login" }, "*");
  }, true);
</script>`;

function extractMockDocument(source: string, hideHeader: boolean) {
  const container = document.createElement("template");
  container.innerHTML = source;
  const frame = container.content.querySelector("iframe");
  const srcDoc = frame?.getAttribute("srcdoc");
  if (!srcDoc) throw new Error("목업 문서를 읽지 못했습니다.");
  const sharedHeaderStyle = hideHeader
    ? "<style>#fv-nav-preview .fv-header{display:none!important}</style>"
    : "";
  return srcDoc.replace("</body>", `${sharedHeaderStyle}${bridgeScript}</body>`);
}

export function MockMarketSimulation({ onOpenJournal, onOpenJudgement, onOpenLogin, hideHeader = false }: MockMarketSimulationProps) {
  const [srcDoc, setSrcDoc] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/finverse-layout-preview%202.html")
      .then((response) => {
        if (!response.ok) throw new Error("목업 파일을 불러오지 못했습니다.");
        return response.text();
      })
      .then((source) => {
        if (active) setSrcDoc(extractMockDocument(source, hideHeader));
      })
      .catch(() => {
        if (active) setSrcDoc("");
      });
    return () => { active = false; };
  }, [hideHeader]);

  useEffect(() => {
    const receive = (event: MessageEvent<{ channel?: string; action?: MockAction }>) => {
      if (event.data?.channel !== "finverse-mock") return;
      if (event.data.action === "journal") onOpenJournal();
      if (event.data.action === "judgement") onOpenJudgement();
      if (event.data.action === "login") onOpenLogin();
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [onOpenJournal, onOpenJudgement, onOpenLogin]);

  if (srcDoc === null) return <main aria-busy="true" style={{ minHeight: "100vh", background: "#fff" }} />;
  if (!srcDoc) return <main role="alert">목업 화면을 불러오지 못했습니다.</main>;

  return <iframe className="mock-market-simulation-frame" title="FINVERSE 시장 시뮬레이션" srcDoc={srcDoc} />;
}
