"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { downloadPlatform, publicAnalyticsUrl } from "@/lib/analytics-policy";
import {
  ANALYTICS_CHANGED,
  ANALYTICS_PREFERENCES,
  analyticsConfigured,
  analyticsConsent,
  captureWebsiteEvent,
  saveAnalyticsConsent
} from "@/lib/website-analytics";

function subscribe(listener: () => void) {
  window.addEventListener(ANALYTICS_CHANGED, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(ANALYTICS_CHANGED, listener);
    window.removeEventListener("storage", listener);
  };
}

export function AnalyticsPreferencesButton() {
  if (!analyticsConfigured()) return null;
  return (
    <button
      type="button"
      className="hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      onClick={() => window.dispatchEvent(new Event(ANALYTICS_PREFERENCES))}
    >
      Analytics preferences
    </button>
  );
}

export function PrivateAnalytics() {
  const pathname = usePathname();
  const consent = useSyncExternalStore(subscribe, analyticsConsent, () => null);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const lastPage = useRef<string | null>(null);

  useEffect(() => {
    const open = () => setPreferencesOpen(true);
    window.addEventListener(ANALYTICS_PREFERENCES, open);
    return () => window.removeEventListener(ANALYTICS_PREFERENCES, open);
  }, []);

  useEffect(() => {
    if (consent !== "accepted") {
      lastPage.current = null;
      return;
    }
    const url = publicAnalyticsUrl(window.location.href);
    if (url !== lastPage.current) {
      if (url) captureWebsiteEvent("$pageview");
      lastPage.current = url;
    }
    const click = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement)) return;
      const platform = downloadPlatform(link.href);
      if (platform) captureWebsiteEvent("download_clicked", platform);
    };
    document.addEventListener("click", click);
    return () => document.removeEventListener("click", click);
  }, [pathname, consent]);

  if (
    !analyticsConfigured() ||
    !publicAnalyticsUrl(`https://mezair.invalid${pathname}`) ||
    (consent !== null && !preferencesOpen)
  )
    return null;
  const choose = (choice: "accepted" | "declined") => {
    saveAnalyticsConsent(choice);
    setPreferencesOpen(false);
  };
  return (
    <section
      aria-label="Website analytics preferences"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-2xl rounded-xl border border-border bg-background p-5 text-foreground shadow-lg"
    >
      <p className="text-sm font-semibold">Help improve the website</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Allow anonymous page views and download click counts through PostHog in the EU? No session
        recordings, account details, shared artifacts, or URL queries are collected. Your choice is
        saved on this browser.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => choose("accepted")}
          className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Allow analytics
        </button>
        <button
          type="button"
          onClick={() => choose("declined")}
          className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Decline analytics
        </button>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Change this any time using Analytics preferences in the footer. Do Not Track and Global
        Privacy Control are respected.
      </p>
    </section>
  );
}
