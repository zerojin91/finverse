import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import MarketInsightScreen from "./MarketInsightScreen";

export const metadata: Metadata = {
  title: "시장 인사이트 | FINVERSE",
  description: "오늘의 KOSPI를 만든 조건을 분해하고, 조건부 경로와 발생 가능 이벤트를 확인하세요.",
};

export default function InsightsPage() {
  return (
    <AppShell>
      <MarketInsightScreen />
    </AppShell>
  );
}
