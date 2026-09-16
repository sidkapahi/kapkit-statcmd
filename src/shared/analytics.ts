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

// PostHog project API key, injected by Vite at build time. Empty key = no
// analytics at all (forks / local dev without their own project). This key is a
// PUBLIC, write-only identifier (the `phc_…` "Project API Key") — safe to inline
// into the bundle. Never put your PostHog Personal API key here; that is a
// server-side credential.
const POSTHOG_KEY: string = import.meta.env.VITE_POSTHOG_KEY ?? "";
// API host. Use || (not ??) so an *empty* host from CI (`${{ vars.… }}` expands
// to "" when unset, not undefined) falls back to the US default instead of
// sticking as an empty string and breaking ingestion. Use
// https://eu.i.posthog.com for EU residency, or a reverse-proxy subdomain of
// your own domain to dodge ad blockers.
const POSTHOG_HOST: string =
  import.meta.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com";
const ENABLED = !!POSTHOG_KEY;

// PostHog can gate capturing on an explicit opt-in, but it has no three-state
// "not decided yet", so we record the visitor's choice ourselves. "pending"
// until they accept or decline via the banner; the banner then stops showing on
// return visits. Kept in localStorage so it survives PostHog's own opt-out
// cookie being cleared.
const CONSENT_KEY = "kapkit_analytics_consent";

let started = false;

// Prefix a custom event name once, guarding against double-prefixing.
function eventName(event: string): string {
  return event.startsWith(`${EVENT_PREFIX}_`)
    ? event
    : `${EVENT_PREFIX}_${event}`;
}

function readConsent(): "granted" | "denied" | "pending" {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    return v === "granted" || v === "denied" ? v : "pending";
  } catch {
    return "pending";
  }
}

function writeConsent(value: "granted" | "denied") {
  try {
    localStorage.setItem(CONSENT_KEY, value);
  } catch {
    /* ignore (private mode / storage disabled) */
  }
}

// Cookie-based, but starts OPTED OUT — nothing is captured until the visitor
// accepts via the consent banner (see mountCookieBanner in customizer.ts).
export function initAnalytics() {
  if (!ENABLED || started || typeof window === "undefined") return;
  started = true;

  const config: Partial<PostHogConfig> = {
    api_host: POSTHOG_HOST,
    // Capture "every interaction": autocapture records clicks/inputs generically
    // and pageviews/leaves are captured too. Named events (see trackEvent) add
    // the meaningful, prefixed events on top.
    autocapture: true,
    capture_pageview: true,
    capture_pageleave: true,
    // Gate ALL capturing on banner consent; opt_in_capturing() flips this on.
    opt_out_capturing_by_default: true,
    // Keep it anonymous: never create identified person profiles (we never call
    // identify()), and don't record the visitor's screen.
    person_profiles: "identified_only",
    disable_session_recording: true,
    persistence: "localStorage+cookie",
    loaded: (ph) => {
      ph.register({
        // Tag every event — including PostHog's own autocaptured ones — with
        // the site, so a shared project can be broken down per site.
        site: EVENT_PREFIX,
        // Don't run IP-based geolocation on our events (keeps it anonymous).
        $geoip_disable: true,
      });
    },
  };
  posthog.init(POSTHOG_KEY, config);

  // Re-apply a returning visitor's stored choice: PostHog restores its own
  // opt-in/out cookie, but this keeps the two in sync if the cookie was cleared.
  if (readConsent() === "granted") posthog.opt_in_capturing();
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
export function consentDecided(): boolean {
  return consentStatus() !== "pending";
}

// The visitor's stored choice: "granted" (accepted), "denied" (rejected), or
// "pending" (no choice yet).
export function consentStatus(): "granted" | "denied" | "pending" {
  if (!ENABLED) return "pending";
  return readConsent();
}

export function grantConsent() {
  writeConsent("granted");
  if (!ENABLED || !started) return;
  try {
    posthog.opt_in_capturing();
  } catch {
    /* ignore */
  }
}

export function revokeConsent() {
  writeConsent("denied");
  if (!ENABLED || !started) return;
  try {
    posthog.opt_out_capturing();
  } catch {
    /* ignore */
  }
}
