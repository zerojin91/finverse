"use client";

import * as React from "react";

/* FINVERSE design-system primitives.
   Every class name here comes from styles/finverse.css (the app's own component layer)
   or styles/ui.css (.fv-btn) — no new visual vocabulary is invented. */

/* ---------------------------------------------------------------- Button */

type ButtonVariant = "default" | "outline" | "secondary" | "ghost" | "destructive" | "link";
type ButtonSize = "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ variant = "default", size = "default", className = "", ...props }: ButtonProps) {
  const cls = ["fv-btn", `fv-btn-${variant}`, size !== "default" ? `fv-btn-${size}` : "", className]
    .filter(Boolean)
    .join(" ");
  return <button type="button" data-slot="button" data-variant={variant} data-size={size} className={cls} {...props} />;
}

/* ----------------------------------------------------------------- Panel */

export interface PanelProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  /** Uppercase English kicker above the title. */
  kicker?: string;
  title: React.ReactNode;
  /** Right side of the header row. */
  aside?: React.ReactNode;
}

export function Panel({ kicker, title, aside, children, className = "", ...props }: PanelProps) {
  return (
    <section className={`panel ${className}`.trim()} {...props}>
      <div className="panel-title">
        <div>
          {kicker ? <span>{kicker}</span> : null}
          <h2>{title}</h2>
        </div>
        {aside ?? null}
      </div>
      {children}
    </section>
  );
}

/* ----------------------------------------------------------- PageHeading */

export interface PageHeadingProps {
  kicker: string;
  title: React.ReactNode;
  stamp?: React.ReactNode;
  className?: string;
}

export function PageHeading({ kicker, title, stamp, className = "" }: PageHeadingProps) {
  return (
    <header className={`page-heading ${className}`.trim()}>
      <div>
        <span>{kicker}</span>
        <h1>{title}</h1>
      </div>
      {stamp ? <div className="market-stamp">{stamp}</div> : null}
    </header>
  );
}

/* ---------------------------------------------------------- ScenarioCard */

export interface ScenarioCardProps {
  title: React.ReactNode;
  tags?: string[];
  forecast: string;
  tone: "up" | "down";
  active?: boolean;
  icon?: React.ReactNode;
  onSelect?: () => void;
  onDetail?: () => void;
}

export function ScenarioCard({ title, tags = [], forecast, tone, active, icon, onSelect, onDetail }: ScenarioCardProps) {
  return (
    <article
      className={`scenario-card${active ? " active" : ""}`}
      role="button"
      tabIndex={0}
      aria-pressed={!!active}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect?.();
        }
      }}
    >
      <div className="scenario-card-main">
        <span className={`scenario-icon ${tone}`}>{icon}</span>
        <div>
          <h3>{title}</h3>
          <div className="scenario-tags">
            {tags.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
        </div>
      </div>
      <small>조건부 예상</small>
      <strong className={tone}>{forecast}</strong>
      {onDetail ? (
        <button
          className="scenario-card-detail-button"
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDetail();
          }}
        >
          상세 보기 ›
        </button>
      ) : null}
    </article>
  );
}

/* --------------------------------------------------------- EventTimeline */

export interface TimelineEvent {
  week: string;
  category: string;
  title: string;
  body: string;
  impact: string;
}

export function EventTimeline({ events }: { events: TimelineEvent[] }) {
  return (
    <div className="event-timeline">
      {events.map((e) => (
        <article key={e.title}>
          <div className="event-week">{e.week}</div>
          <div className="event-dot" />
          <div className="event-copy">
            <span>{e.category}</span>
            <h3>{e.title}</h3>
            <p>{e.body}</p>
            <div className="event-impact">
              <span>예상 영향</span>
              <strong className={e.impact.startsWith("+") ? "up" : "down"}>{e.impact}</strong>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ ChatMessage */

export interface ChatMessageProps {
  role?: "user" | "assistant";
  sources?: string[];
  children?: React.ReactNode;
}

export function ChatMessage({ role = "assistant", sources = [], children }: ChatMessageProps) {
  return (
    <div className={`scenario-chat-message ${role}`.trim()}>
      <div className={role === "user" ? "scenario-chat-user" : "scenario-chat-assistant"}>
        {children}
        {role === "assistant" && sources.length > 0 ? (
          <div className="scenario-chat-sources">
            {sources.map((s) => (
              <span key={s}>{s}</span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
