import { ThemeScript } from "@/components/ds/ThemeToggle";

/* Front-end package screens only. These stylesheets and the theme script load on
   /landing, /insights and /twin, so the existing app at / renders exactly as before.
   Order matters: app/globals.css comes from the root layout, these layer on top. */
import "@/styles/theme-dark.css";
import "@/styles/ui.css";
import "@/styles/theme-toggle.css";
import "@/styles/app-shell.css";
import "@/styles/landing.css";

export default function FinversePackageLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ThemeScript />
      {children}
    </>
  );
}
