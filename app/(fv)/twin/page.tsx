import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import FinancialTwinScreen from "./FinancialTwinScreen";

export const metadata: Metadata = {
  title: "마이 금융 트윈 | FINVERSE",
  description: "선택한 시나리오를 내 보유 종목과 비중에 대입해 자산 경로를 확인하세요.",
};

export default function TwinPage() {
  return (
    <AppShell>
      <FinancialTwinScreen />
    </AppShell>
  );
}
