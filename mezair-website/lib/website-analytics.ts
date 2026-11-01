import posthog from "posthog-js";
import { publicAnalyticsUrl } from "./analytics-policy";

const CONSENT_KEY = "mezair:website-analytics";
export const ANALYTICS_CHANGED = "mezair:analytics-changed";
export const ANALYTICS_PREFERENCES = "mezair:analytics-preferences";
export type AnalyticsConsent = "accepted" | "declined" | null;
let initialized = false;

export function analyticsConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN && process.env.NEXT_PUBLIC_POSTHOG_HOST
  );
}

export function analyticsConsent(): AnalyticsConsent {
  try {
    const value = window.localStorage.getItem(CONSENT_KEY);
    return value === "accepted" || value === "declined" ? value : null;
  } catch {
    return null;
  }
}

export function analyticsAllowed(): boolean {
  return (
    analyticsConfigured() &&
    analyticsConsent() === "accepted" &&
    navigator.doNotTrack !== "1" &&
    !(navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl
  );
}

export function initializeWebsiteAnalytics(): void {
  if (!analyticsAllowed() || !publicAnalyticsUrl(window.location.href)) return;
  if (initialized) {
    // Also reconcile consent renewed in another tab or after a reload.
    if (posthog.has_opted_out_capturing()) posthog.opt_in_capturing({ captureEventName: false });
    return;
  }
  try {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN!, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST!,
      defaults: "2026-08-30",
      persistence: "memory",
      person_profiles: "never",
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_performance: false,
      capture_dead_clicks: false,
      disable_session_recording: true,
      disable_surveys: true,
      advanced_disable_flags: true,
      disable_external_dependency_loading: true,
      disable_capture_url_hashes: true,
      respect_dnt: true,
      ip: false,
      request_batching: false,
      before_send: (event) => {
        if (!event || !analyticsAllowed() || !publicAnalyticsUrl(window.location.href)) return null;
        if (event.event !== "$pageview" && event.event !== "download_clicked") return null;
        const url = publicAnalyticsUrl(String(event.properties.$current_url ?? ""));
        if (!url) return null;
        // SDK-added referrers, initial URLs, campaign values, page titles and
        // arbitrary properties cannot escape this fresh allowlist.
        event.properties = {
          token: event.properties.token,
          distinct_id: event.properties.distinct_id,
          $session_id: event.properties.$session_id,
          $current_url: url,
          $pathname: new URL(url).pathname,
          $host: new URL(url).host,
          $process_person_profile: false,
          $geoip_disable: true,
          surface: "website",
          ...(event.event === "download_clicked" ? { platform: event.properties.platform } : {})
        };
        return event;
      }
    });
    initialized = true;
    if (posthog.has_opted_out_capturing()) posthog.opt_in_capturing({ captureEventName: false });
  } catch {
    console.warn("[Analytics] Could not initialize website analytics.");
  }
}

export function saveAnalyticsConsent(consent: Exclude<AnalyticsConsent, null>): void {
  try {
    window.localStorage.setItem(CONSENT_KEY, consent);
  } catch {
    return;
  }
  if (initialized && consent === "declined") {
    posthog.opt_out_capturing();
    posthog.reset();
  } else if (initialized && consent === "accepted") {
    posthog.opt_in_capturing({ captureEventName: false });
  }
  window.dispatchEvent(new Event(ANALYTICS_CHANGED));
}

export function captureWebsiteEvent(
  event: "$pageview" | "download_clicked",
  platform?: string
): void {
  initializeWebsiteAnalytics();
  if (!initialized || !analyticsAllowed()) return;
  const url = publicAnalyticsUrl(window.location.href);
  if (url) posthog.capture(event, { $current_url: url, platform });
}
