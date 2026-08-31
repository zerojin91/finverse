"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, BrainCircuit, ChevronRight, CircleHelp, UserRound } from "lucide-react";
import { ThemeToggle } from "./ds/ThemeToggle";

const tabs = [
  { href: "/insights", label: "시장 인사이트", icon: BarChart3 },
  { href: "/twin", label: "마이 금융 트윈", icon: UserRound },
];

/** Sidebar + mobile chrome shared by the two app screens. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="finverse-app">
      <header className="mobile-header">
        <Link className="sidebar-brand" href="/">
          <span className="brand-mark">F</span>
          <span>FINVERSE</span>
        </Link>
        <ThemeToggle />
      </header>
      <div className="app-layout">
        <aside className="sidebar" aria-label="FINVERSE 탐색">
          <Link className="sidebar-brand" href="/">
            <span className="brand-mark">F</span>
            <span>FINVERSE</span>
          </Link>
          <div className="sidebar-label">
            <BrainCircuit size={19} />
            <div>
              <span>AI DECISION LAB</span>
              <strong>금융 판단 실험실</strong>
            </div>
          </div>
          <nav className="side-tabs">
            {tabs.map(({ href, label, icon: Icon }) => (
              <Link key={href} className={isActive(href) ? "active" : undefined} href={href}>
                <Icon size={18} />
                {label}
              </Link>
            ))}
          </nav>
          <ThemeToggle />
          <button className="sidebar-help" type="button">
            <CircleHelp size={20} />
            <span>도움말</span>
            <ChevronRight size={17} />
          </button>
        </aside>
        <main className="main-content">{children}</main>
      </div>
      <nav className="mobile-tabs" aria-label="모바일 주요 메뉴">
        {tabs.map(({ href, label, icon: Icon }) => (
          <Link key={href} className={isActive(href) ? "active" : undefined} href={href}>
            <Icon size={18} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
