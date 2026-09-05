"use client";

import * as React from "react";

/** Adds the reveal class and observes [data-reveal] children, with a failsafe so content can never stay hidden. */
export function Reveal({ children }: { children: React.ReactNode }) {
  const root = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    document.documentElement.classList.add("js-reveal");
    const items = Array.from(root.current?.querySelectorAll<HTMLElement>("[data-reveal]") ?? []);
    const revealAll = () => items.forEach((n) => n.classList.add("in"));

    items.forEach((n) => {
      if (n.getBoundingClientRect().top < window.innerHeight) n.classList.add("in");
    });
    const timer = window.setTimeout(revealAll, 1500);
    window.addEventListener("scroll", revealAll, { once: true });
    window.addEventListener("resize", revealAll, { once: true });

    let io: IntersectionObserver | undefined;
    if ("IntersectionObserver" in window) {
      io = new IntersectionObserver(
        (entries) =>
          entries.forEach((e) => {
            if (e.isIntersecting) {
              e.target.classList.add("in");
              io?.unobserve(e.target);
            }
          }),
        { threshold: 0 }
      );
      items.forEach((n) => io?.observe(n));
    } else {
      revealAll();
    }

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("scroll", revealAll);
      window.removeEventListener("resize", revealAll);
      io?.disconnect();
      document.documentElement.classList.remove("js-reveal");
    };
  }, []);

  return <div ref={root}>{children}</div>;
}
