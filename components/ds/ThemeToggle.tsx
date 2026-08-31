"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";

const KEY = "finverse-theme";

/** Light/dark toggle. Pair with <ThemeScript /> in the layout head to avoid a flash. */
const subscribe = (onChange: () => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
};
const isDark = () => document.documentElement.getAttribute("data-theme") === "dark";

export function ThemeToggle({ className = "" }: { className?: string }) {
  /* The theme lives on <html>, written by ThemeScript before paint. Reading it through
     useSyncExternalStore keeps the button in step without a setState-in-effect round trip. */
  const dark = React.useSyncExternalStore(subscribe, isDark, () => false);

  const toggle = () => {
    const next = !dark;
    if (next) document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
    try {
      localStorage.setItem(KEY, next ? "dark" : "light");
    } catch {
      /* storage unavailable */
    }
  };

  return (
    <button className={`fv-theme-toggle ${className}`.trim()} type="button" onClick={toggle} aria-pressed={dark} aria-label="라이트/다크 모드 전환">
      {dark ? <Sun size={14} /> : <Moon size={14} />}
      <span>{dark ? "라이트" : "다크"}</span>
    </button>
  );
}

/** Inline script that applies the stored theme before first paint.
 *  Opt-in only: no OS `prefers-color-scheme` fallback, so the light-only screens
 *  outside this package are never switched to dark without an explicit toggle. */
export function ThemeScript() {
  const code = `(function(){try{var m=localStorage.getItem('${KEY}');if(m==='dark'){document.documentElement.setAttribute('data-theme','dark')}}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
