// The command contract shared by the customizer's datapoint buttons and the
// statcmd Worker's renderer (worker/statcmd.js). The Worker implements exactly
// the token set defined here; the customizer only ever inserts these tokens, so
// the two can't drift.
//
// A built command looks like:
//   $(urlfetch https://statcmd.kapkit.ca/v3?steamid=<id>&timezone=<tz>&view=<template>)
// The bot (Nightbot / Fossabot / StreamElements) runs the urlfetch each time the
// command fires; the Worker fetches live stats, substitutes the {{tokens}} in
// `view`, and returns the plain-text line the bot posts in chat.

// Base URL of the Worker's render route. Injected by Vite at build time
// (VITE_STATCMD_URL); falls back to the production Worker so a plain
// `npm run build` with no env still emits working commands.
export const STATCMD_URL: string =
  (import.meta.env.VITE_STATCMD_URL as string | undefined)?.trim() ||
  'https://statcmd.kapkit.ca/v3';

// Whether a real Worker URL is configured. When false the live preview shows a
// sample line instead of calling a Worker (the command string still builds).
export const STATCMD_CONFIGURED = Boolean(
  (import.meta.env.VITE_STATCMD_URL as string | undefined)?.trim(),
);

// The Worker's /resolve route (sibling of /v3), used by the customizer to turn a
// steamcommunity.com/id/<vanity> link into a numeric Steam64 ID.
export const RESOLVE_URL: string = /\/v3\/?$/.test(STATCMD_URL)
  ? STATCMD_URL.replace(/\/v3\/?$/, '/resolve')
  : `${STATCMD_URL.replace(/\/$/, '')}/resolve`;

export interface TokenDef {
  // The literal `{{…}}` token inserted into the template.
  token: string;
  // Short label shown on the datapoint button (matches the Figma).
  label: string;
  // One-line description shown in a tooltip / for accessibility.
  hint: string;
}

export type TokenGroupId = 'premier' | 'faceit' | 'today';

export interface TokenGroup {
  id: TokenGroupId;
  label: string;
  tokens: TokenDef[];
}

// The datapoint groups, in Figma order. Premier is backed by Leetify; FACEIT and
// Today by the FACEIT Data API. "Today" is scoped to the streamer's chosen
// timezone (since local midnight).
export const TOKEN_GROUPS: TokenGroup[] = [
  {
    id: 'premier',
    label: 'Premier',
    tokens: [
      { token: '{{rating}}', label: 'RATING', hint: 'Current Premier CS Rating' },
      { token: '{{rating.diff}}', label: 'DIFF TODAY', hint: "Premier rating change since midnight (your timezone)" },
    ],
  },
  {
    id: 'faceit',
    label: 'FACEIT',
    tokens: [
      { token: '{{elo}}', label: 'ELO', hint: 'Current FACEIT ELO' },
      { token: '{{lvl}}', label: 'LEVEL', hint: 'FACEIT skill level (1–10)' },
      { token: '{{elo.diff}}', label: 'DIFF TODAY', hint: 'FACEIT ELO change since midnight (your timezone)' },
      { token: '{{url}}', label: 'URL', hint: 'Link to the FACEIT profile' },
    ],
  },
  {
    id: 'today',
    label: 'Today',
    tokens: [
      { token: '{{todays.wins}}', label: 'WINS', hint: 'FACEIT matches won today' },
      { token: '{{todays.losses}}', label: 'LOSSES', hint: 'FACEIT matches lost today' },
      { token: '{{todays.avgKills}}', label: 'AVG KILLS', hint: "Average kills across today's matches" },
      { token: '{{todays.kd}}', label: 'K/D', hint: "Kills / deaths across today's matches" },
      { token: '{{todays.hs}}', label: 'HS %', hint: "Average headshot % across today's matches" },
    ],
  },
];

// Every valid token, for quick membership checks.
export const ALL_TOKENS: string[] = TOKEN_GROUPS.flatMap((g) => g.tokens.map((t) => t.token));

// The default template shown on first load (matches the Figma mockup).
export const DEFAULT_VIEW = 'FACEIT: Level {{lvl}} ({{elo}}) | PREMIER: {{rating}}';

// Builds the Worker GET URL. `view` is placed LAST and left un-encoded on
// purpose: bot `urlfetch` implementations pass the URL through verbatim and the
// Worker reads everything after `&view=` as the raw template, so a template with
// spaces, `|`, `(`, and `{{…}}` survives intact and reads cleanly in chat — the
// same shape elocmd and the Figma mockup use. `steamid` is digits and `timezone`
// is an IANA name (letters, digits, `/`, `_`, `+`, `-`), all URL-safe as-is.
export function buildCommandUrl(steamId: string, timezone: string, view: string): string {
  const id = steamId.trim();
  const tz = timezone.trim();
  const v = view.replace(/\r?\n/g, ' ').trim();
  return `${STATCMD_URL}?steamid=${id}&timezone=${tz}&view=${v}`;
}

// Wraps the Worker URL in the `$(urlfetch …)` call the user pastes into their
// bot's command response. Nightbot, Fossabot, and StreamElements all use this
// same `$(urlfetch)` syntax.
export function buildCommand(steamId: string, timezone: string, view: string): string {
  return `$(urlfetch ${buildCommandUrl(steamId, timezone, view)})`;
}

// ---- Shareable customizer state (site URL) --------------------------------
// So a configured build can be linked/bookmarked. Encoded on the customizer's
// OWN URL (not the Worker's) — steam/tz/view — and restored on load.

export interface StatcmdState {
  steamInput: string; // whatever the user typed in the STEAM field (URL/id/vanity)
  timezone: string;
  view: string;
}

export function stateToParams(state: StatcmdState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.steamInput.trim()) params.set('steam', state.steamInput.trim());
  if (state.timezone) params.set('tz', state.timezone);
  if (state.view && state.view !== DEFAULT_VIEW) params.set('view', state.view);
  return params;
}

export function paramsToState(params: URLSearchParams, fallbackTimezone: string): StatcmdState {
  return {
    steamInput: params.get('steam') ?? '',
    timezone: params.get('tz') || fallbackTimezone,
    view: params.get('view') ?? DEFAULT_VIEW,
  };
}
