"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatedMark } from "@/components/site/animated-mark";

/**
 * Replays the painted mark's entrance the first time it scrolls into view.
 * Before then (and without JavaScript) the mark has already settled into its
 * canonical shape, so nothing depends on the observer firing. Remounting with a
 * new key restarts the CSS-only entrance; press-to-replay and reduced motion
 * stay with AnimatedMark itself.
 */
export function MarkOnView({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [take, setTake] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          setTake(1);
        }
      },
      { threshold: 0.6 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="inline-block">
      <AnimatedMark key={take} className={className} />
    </div>
  );
}
