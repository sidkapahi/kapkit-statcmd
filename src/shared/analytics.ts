import mixpanel from "mixpanel-browser";
import type { Config } from "mixpanel-browser";

// Customizer analytics (Mixpanel, cookie-based). The overlay does NOT use this
// module — it uses the lightweight, cookieless analyticsOverlay.ts instead, so
// mixpanel-browser is never bundled into the OBS overlay.

type Props = Record<string, string | number | boolean>;

// Mixpanel project token, injected by Vite at build time. Empty token = no
// analytics at all (forks / local dev without their own project). The token is
// a PUBLIC, write-only identifier — safe to inline into the bundle. Never put
// your Mixpanel *API Secret* here; that is a server-side credential.
//
// MULTIPLE SITES: Mixpanel's free plan allows unlimited projects, so the clean
// setup is one project per site — give each deployment its own VITE_MIXPANEL_TOKEN.
// If instead you pool several sites into ONE project, set VITE_MIXPANEL_SITE per
// deployment: it's registered as a super property on every event so you can
// break your reports down by site.
const MIXPANEL_TOKEN: string = import.meta.env.VITE_MIXPANEL_TOKEN ?? "";
// Region host. Use || (not ??) so an *empty* host from CI (`${{ vars.… }}`
// expands to "" when unset, not undefined) falls back to the US default instead
// of sticking as an empty string and breaking ingestion. Set to
// https://api-eu.mixpanel.com for EU residency, or a reverse-proxy subdomain of
// your own domain to dodge ad blockers.
const MIXPANEL_HOST: string =
  import.meta.env.VITE_MIXPANEL_HOST || "https://api.mixpanel.com";
// Optional per-site label (only useful when several sites share one project).
const MIXPANEL_SITE: string = import.meta.env.VITE_MIXPANEL_SITE ?? "";
const ENABLED = !!MIXPANEL_TOKEN;

// Mixpanel has no built-in three-state consent, so we record the visitor's
// explicit choice ourselves. "pending" until they accept or decline via the
// banner; the banner then stops showing on return visits. Kept in localStorage
// so it survives Mixpanel's own opt-out cookie being cleared.
const CONSENT_KEY = "kapkit_analytics_consent";

let started = false;

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

  const config: Partial<Config> = {
    api_host: MIXPANEL_HOST,
    // We send explicit, named events only — no autocapture, no auto pageviews.
    autocapture: false,
    track_pageview: false,
    // Gate all capturing on banner consent; opt_in_tracking() flips this on.
    opt_out_tracking_by_default: true,
    // Anonymise: don't store the visitor's IP with events.
    ip: false,
    persistence: "localStorage",
  };
  mixpanel.init(MIXPANEL_TOKEN, config);

  // Re-apply a returning visitor's stored choice: mixpanel restores its own
  // opt-in/out cookie, but this keeps the two in sync if the cookie was cleared.
  if (readConsent() === "granted") mixpanel.opt_in_tracking();

  // Tag every event with the site when pooling multiple sites into one project.
  if (MIXPANEL_SITE) mixpanel.register({ site: MIXPANEL_SITE });
}

export function trackEvent(event: string, props?: Props) {
  if (!ENABLED || !started) return;
  try {
    mixpanel.track(event, props);
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
    mixpanel.opt_in_tracking();
  } catch {
    /* ignore */
  }
}

export function revokeConsent() {
  writeConsent("denied");
  if (!ENABLED || !started) return;
  try {
    mixpanel.opt_out_tracking();
  } catch {
    /* ignore */
  }
}
