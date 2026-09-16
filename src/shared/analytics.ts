import posthog from "posthog-js";
import type { PostHogConfig } from "posthog-js";

// Customizer analytics (PostHog, cookie-based). The overlay does NOT use this
// module — it uses the lightweight, cookieless analyticsOverlay.ts instead, so
// posthog-js is never bundled into the OBS overlay.

type Props = Record<string, string | number | boolean>;

// Every custom event name is prefixed with this so that when several sites share
// ONE PostHog project you can tell them apart at a glance and filter cleanly
// (e.g. `statcmd_command_copied`). The same value is also registered as a `site`
// super property (see below) so that PostHog's *autocaptured* events — whose
// names are fixed by PostHog (`$autocapture`, `$pageview`, …) and cannot be
// renamed — are still attributable to this site. Override per deployment with
// VITE_POSTHOG_EVENT_PREFIX; defaults to "statcmd".
const EVENT_PREFIX: string =
  import.meta.env.VITE_POSTHOG_EVENT_PREFIX || "statcmd";

// PostHog project key + host, injected by Vite at build time. Empty key = no
// analytics at all (forks / local dev without their own project). This key is a
// PUBLIC, write-only identifier (the `phc_…` "Project API Key") — safe to inline
// into the bundle. Never put your PostHog Personal API key here.
const POSTHOG_KEY: string = import.meta.env.VITE_POSTHOG_KEY ?? "";
// Use || (not ??) so an *empty* host falls back to the US default. CI passes
// `VITE_POSTHOG_HOST: ${{ vars.VITE_POSTHOG_HOST }}`, which is an empty string
// (not undefined) when the variable is unset — with ?? that empty string would
// stick and break ingestion. Use https://eu.i.posthog.com for EU residency, or a
// reverse-proxy subdomain of your own domain to dodge ad blockers.
const POSTHOG_HOST: string =
  import.meta.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com";
const ENABLED = !!POSTHOG_KEY;

// When events are routed through a reverse proxy on our own domain (api_host set
// to e.g. https://t.kapkit.ca), posthog-js can no longer infer which PostHog app
// its toolbar / "open in PostHog" links should point at. `ui_host` tells it
// explicitly. When api_host is a real *.posthog.com ingestion host we return
// undefined and let posthog-js derive the app host itself (its US/EU default is
// already correct), so this stays a no-op when the proxy isn't used.
function deriveUiHost(apiHost: string): string | undefined {
  try {
    const host = new URL(apiHost).hostname;
    if (/\.posthog\.com$/i.test(host)) return undefined;
    // Custom proxy: this project targets US PostHog, whose app lives at
    // us.posthog.com. EU forks: change this to https://eu.posthog.com.
    return "https://us.posthog.com";
  } catch {
    return undefined;
  }
}

const POSTHOG_UI_HOST = deriveUiHost(POSTHOG_HOST);

let started = false;

// Prefix a custom event name once, guarding against double-prefixing.
function eventName(event: string): string {
  return event.startsWith(`${EVENT_PREFIX}_`)
    ? event
    : `${EVENT_PREFIX}_${event}`;
}

// Cookie-based, but starts OPTED OUT — nothing is captured until the visitor
// accepts via the consent banner (see mountCookieBanner in customizer.ts).
export function initAnalytics() {
  if (!ENABLED || started || typeof window === "undefined") return;
  started = true;

  const config: Partial<PostHogConfig> = {
    api_host: POSTHOG_HOST,
    // Only set when api_host is our reverse proxy; undefined otherwise (see
    // deriveUiHost) so posthog-js keeps its own correct default.
    ...(POSTHOG_UI_HOST ? { ui_host: POSTHOG_UI_HOST } : {}),
    // Capture "every interaction": autocapture records clicks/inputs generically
    // and pageviews/leaves are captured too. Named events (see trackEvent) add
    // the meaningful, prefixed events on top.
    autocapture: true,
    capture_pageview: true,
    capture_pageleave: true,
    // No screen recording, and no feature-flag round-trips (we don't use them).
    disable_session_recording: true,
    advanced_disable_feature_flags: true,
    // Keep it anonymous: never build identified person profiles (we never call
    // identify()). Approximate location IS derived from IP by PostHog (geoip) so
    // aggregate location/region breakdowns work — no precise data, no profile.
    person_profiles: "identified_only",
    persistence: "localStorage+cookie",
    // Gate ALL capturing on banner consent; opt_in_capturing() flips this on.
    opt_out_capturing_by_default: true,
    loaded: (ph) => {
      // Tag every event — including PostHog's own autocaptured ones — with the
      // site, so a shared project can be broken down per site.
      ph.register({ site: EVENT_PREFIX });
    },
  };
  posthog.init(POSTHOG_KEY, config);
}

export function trackEvent(event: string, props?: Props) {
  if (!ENABLED || !started) return;
  try {
    posthog.capture(eventName(event), props);
  } catch {
    // analytics must never break the app
  }
}

// ---- Consent controls (cookie banner) ------------------------------------

// Whether analytics is configured at all — the banner only shows when true.
export function analyticsEnabled(): boolean {
  return ENABLED;
}

// True once the visitor has explicitly accepted or rejected, so the banner
// isn't shown again on return visits.
//
// NOTE: we must NOT use has_opted_out_capturing() here. With
// opt_out_capturing_by_default (set in initAnalytics), a first-time visitor is
// already reported as "opted out" before making any choice, so that check would
// always be true and the banner would never appear. get_explicit_consent_status
// reads the *stored* choice only ("pending" until the visitor actually decides).
export function consentDecided(): boolean {
  return consentStatus() !== "pending";
}

// The visitor's stored choice: "granted" (accepted), "denied" (rejected), or
// "pending" (no choice yet). Used to show which option is active in the modal.
export function consentStatus(): "granted" | "denied" | "pending" {
  if (!ENABLED || !started) return "pending";
  try {
    return posthog.get_explicit_consent_status();
  } catch {
    return "pending";
  }
}

export function grantConsent() {
  if (!ENABLED || !started) return;
  try {
    posthog.opt_in_capturing();
  } catch {
    /* ignore */
  }
}

export function revokeConsent() {
  if (!ENABLED || !started) return;
  try {
    posthog.opt_out_capturing();
  } catch {
    /* ignore */
  }
}
