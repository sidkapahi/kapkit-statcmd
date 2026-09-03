// Cloudflare Worker: kapKit statcmd renderer
//
// The heart of the tool. A chat bot (Nightbot / Fossabot / StreamElements) runs
//   $(urlfetch https://statcmd.kapkit.ca/v3?steamid=<id>&timezone=<tz>&view=<template>)
// each time the viewer runs the command. This Worker fetches the player's live
// CS2 stats — Premier rating from Leetify, ELO/level/today's record from the
// FACEIT Data API — substitutes the {{tokens}} in `view`, and returns the plain
// text line the bot posts in chat. Keeping the API keys server-side is the whole
// point: a bot can only urlfetch a public URL, so the render has to happen here.
//
// Routes:
//   • GET /v3?steamid=&timezone=&view=   → text/plain rendered command output
//   • GET /resolve?input=<steam url|vanity|id>  → { steamId }  (customizer only)
//
// Secrets (wrangler secret put … --config wrangler.statcmd.toml):
//   • FACEIT_API_KEY  — required for {{elo}}/{{lvl}}/{{url}}/{{elo.diff}}/{{todays.*}}
//   • STEAM_API_KEY   — required for /resolve of steamcommunity.com/id/<vanity> links
//   • LEETIFY_KEY     — optional, only raises Leetify's rate limit
//
// The token contract mirrors src/shared/statcmd.ts exactly.

// Origins allowed to call the Worker from a browser (the customizer's live
// preview + local dev). Bots aren't browsers, so CORS never gates them — this
// only stops other sites from driving the preview against your keys. Scheme +
// host only, no trailing slash.
const ALLOWED_ORIGINS = new Set([
  'https://statcmd.kapkit.ca',
  'https://sidkapahi.github.io',
  'http://localhost:5173',
]);

const LEETIFY_PROFILE = 'https://api-public.cs-prod.leetify.com/v3/profile';
const FACEIT_BASE = 'https://open.faceit.com/data/v4';
// FACEIT's public web stats API (no key) — carries per-match ELO + timestamp,
// which the Data API doesn't expose. Best-effort, exactly as in the overlay's
// faceit-proxy.js. Used for {{elo.diff}}.
const FACEIT_WEB_STATS = 'https://www.faceit.com/api/stats/v1/stats/time/users';

// Value shown for any token whose data is missing (no Premier/FACEIT profile, or
// an upstream error) so the command still returns a readable line.
const MISSING = '-';
// Guardrail on the template length so the Worker can't be pushed huge strings.
const VIEW_MAX = 400;
// How many recent FACEIT matches to scan for "today" (a busy day is well under
// this; the Data API caps history pages at 100).
const HISTORY_SCAN = 30;

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const url = new URL(request.url);
    if (url.pathname.replace(/\/+$/, '').endsWith('/resolve')) {
      return handleResolve(url, env, cors);
    }
    return handleRender(request.url, env, cors);
  },
};

// ---- /v3 render -----------------------------------------------------------

async function handleRender(rawUrl, env, cors) {
  // Parse from the RAW query string so `view` (placed last, un-encoded by the
  // client) survives with its spaces, `|`, `(`, and `{{…}}` intact.
  const q = rawUrl.slice(rawUrl.indexOf('?') + 1);
  const steamid = (getParam(q, 'steamid') || '').trim();
  const timezone = (getParam(q, 'timezone') || 'UTC').trim();
  const view = getRawView(q).slice(0, VIEW_MAX);

  if (!/^\d{17}$/.test(steamid)) {
    return text('Invalid steamid (needs a 17-digit Steam64 ID)', 400, cors);
  }
  if (!view) return text('Missing view template', 400, cors);
  const tz = isValidTz(timezone) ? timezone : 'UTC';

  // Only fetch what the template actually references.
  const used = new Set(matchTokens(view));
  const wantPremier = used.has('{{rating}}') || used.has('{{rating.diff}}');
  const wantFaceitBasic =
    used.has('{{elo}}') || used.has('{{lvl}}') || used.has('{{url}}');
  const wantEloDiff = used.has('{{elo.diff}}');
  const wantToday = [...used].some((t) => t.startsWith('{{todays.'));
  const wantFaceit = wantFaceitBasic || wantEloDiff || wantToday;

  const startOfToday = startOfTodayMs(tz, Date.now());

  const [premier, faceit] = await Promise.all([
    wantPremier ? fetchPremier(steamid, startOfToday, env).catch(() => null) : Promise.resolve(null),
    wantFaceit
      ? fetchFaceit(steamid, startOfToday, { wantEloDiff, wantToday }, env).catch(() => null)
      : Promise.resolve(null),
  ]);

  const values = buildValues(premier, faceit);
  const output = render(view, values);

  return text(output, 200, cors, true);
}

// Replaces known {{tokens}} with computed values; unknown tokens are left
// literal so a typo is visible in chat rather than silently dropped.
function render(view, values) {
  return view.replace(/\{\{([a-zA-Z.]+)\}\}/g, (whole, key) => {
    const v = values[key];
    return v === undefined ? whole : v;
  });
}

// Maps provider results to the flat token → string table `render` consumes.
function buildValues(premier, faceit) {
  const v = {};
  // Premier (Leetify)
  v['rating'] = premier && premier.rating != null ? fmtInt(premier.rating) : MISSING;
  v['rating.diff'] = premier ? fmtSigned(premier.ratingDiff) : MISSING;
  // FACEIT basics
  v['elo'] = faceit && faceit.elo != null ? fmtInt(faceit.elo) : MISSING;
  v['lvl'] = faceit && faceit.level != null ? String(faceit.level) : MISSING;
  v['url'] = faceit && faceit.url ? faceit.url : MISSING;
  v['elo.diff'] = faceit && faceit.eloDiff != null ? fmtSigned(faceit.eloDiff) : MISSING;
  // Today (FACEIT)
  const t = faceit && faceit.todays ? faceit.todays : null;
  v['todays.wins'] = t ? String(t.wins) : MISSING;
  v['todays.losses'] = t ? String(t.losses) : MISSING;
  v['todays.avgKills'] = t && t.avgKills != null ? t.avgKills.toFixed(1) : MISSING;
  v['todays.kd'] = t && t.kd != null ? t.kd.toFixed(2) : MISSING;
  v['todays.hs'] = t && t.hs != null ? `${Math.round(t.hs)}%` : MISSING;
  return v;
}

// ---- Premier (Leetify) ----------------------------------------------------

// Current Premier rating + today's net rating change (since local midnight).
async function fetchPremier(steamid, startOfToday, env) {
  const headers = {};
  if (env.LEETIFY_KEY) headers._leetify_key = env.LEETIFY_KEY;
  const res = await fetch(`${LEETIFY_PROFILE}?steam64_id=${steamid}`, { headers });
  if (!res.ok) return null;
  const data = await res.json();

  const rating = num(data?.ranks?.premier);
  if (rating == null) return { rating: null, ratingDiff: 0 };

  // Premier matches only (a CS Rating in the thousands, matchmaking source — not
  // FACEIT), newest-first as returned. Each carries the rating it ended at, so
  // today's net = newest-today rating − the rating held before today's first
  // Premier match (telescoping sum of the day's swings).
  const premierMatches = (Array.isArray(data?.recent_matches) ? data.recent_matches : [])
    .filter(
      (m) =>
        num(m?.rank) != null &&
        num(m.rank) >= 1000 &&
        !/faceit/i.test(m?.data_source ?? ''),
    )
    .map((m) => ({ rank: num(m.rank), t: Date.parse(m?.finished_at ?? '') || 0 }));

  const todays = premierMatches.filter((m) => m.t >= startOfToday);
  let ratingDiff = 0;
  if (todays.length) {
    const prior = premierMatches.find((m) => m.t < startOfToday);
    const baseline = prior ? prior.rank : todays[todays.length - 1].rank;
    ratingDiff = Math.round(todays[0].rank - baseline);
  }
  return { rating, ratingDiff };
}

// ---- FACEIT ---------------------------------------------------------------

async function fetchFaceit(steamid, startOfToday, needs, env) {
  if (!env.FACEIT_API_KEY) return null;
  const auth = { headers: { Authorization: `Bearer ${env.FACEIT_API_KEY}` } };

  // Resolve the Steam ID to the FACEIT player (a CS2 player's game_player_id IS
  // their Steam64 ID). This one call gives ELO, level, and nickname.
  let player;
  try {
    const res = await fetch(
      `${FACEIT_BASE}/players?game=cs2&game_player_id=${steamid}`,
      auth,
    );
    if (!res.ok) return null;
    player = await res.json();
  } catch {
    return null;
  }
  const cs2 = player?.games?.cs2 ?? {};
  const playerId = player?.player_id;
  if (!playerId) return null;

  const elo = num(cs2.faceit_elo);
  const level = num(cs2.skill_level);
  const nickname = typeof player.nickname === 'string' ? player.nickname : '';
  const url = nickname
    ? `https://www.faceit.com/en/players/${encodeURIComponent(nickname)}`
    : '';

  const [eloDiff, todays] = await Promise.all([
    needs.wantEloDiff ? fetchEloDiffToday(playerId, startOfToday) : Promise.resolve(null),
    needs.wantToday ? fetchTodaysStats(playerId, startOfToday, auth) : Promise.resolve(null),
  ]);

  return { elo, level, url, eloDiff, todays };
}

// Net FACEIT ELO change today, from the public web-stats API (each entry carries
// the ELO held after that match + a timestamp). Net = newest-today ELO − ELO
// held just before today's first match. Best-effort: any failure → 0.
async function fetchEloDiffToday(playerId, startOfToday) {
  try {
    const res = await fetch(
      `${FACEIT_WEB_STATS}/${encodeURIComponent(playerId)}/games/cs2?page=0&size=${HISTORY_SCAN}`,
      { headers: { Accept: 'application/json' }, cf: { cacheTtl: 30, cacheEverything: true } },
    );
    if (!res.ok) return 0;
    const data = await res.json();
    const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
    const rows = items
      .map((m) => ({ elo: num(m?.elo), t: num(m?.date) ?? num(m?.created_at) ?? 0 }))
      .filter((m) => m.elo != null)
      .sort((a, b) => b.t - a.t);
    const todays = rows.filter((m) => m.t >= startOfToday);
    if (!todays.length) return 0;
    const prior = rows.find((m) => m.t < startOfToday);
    const baseline = prior ? prior.elo : todays[todays.length - 1].elo;
    return Math.round(todays[0].elo - baseline);
  } catch {
    return 0;
  }
}

// Today's FACEIT record + averages. Pulls the recent history, keeps matches
// finished since local midnight, then fetches per-match stats (kills/deaths/HS)
// for those. Returns { wins, losses, avgKills, kd, hs } — averages null when
// there are no matches today (the token then renders '-').
async function fetchTodaysStats(playerId, startOfToday, auth) {
  let items;
  try {
    const res = await fetch(
      `${FACEIT_BASE}/players/${playerId}/history?game=cs2&offset=0&limit=${HISTORY_SCAN}`,
      auth,
    );
    if (!res.ok) return null;
    const data = await res.json();
    items = Array.isArray(data?.items) ? data.items : [];
  } catch {
    return null;
  }

  const todays = items.filter((it) => matchFinishedMs(it) >= startOfToday);
  if (!todays.length) {
    return { wins: 0, losses: 0, avgKills: null, kd: null, hs: null };
  }

  let wins = 0;
  let losses = 0;
  for (const it of todays) {
    const o = outcomeFor(it, playerId);
    if (o === 'win') wins++;
    else if (o === 'loss') losses++;
  }

  const perMatch = await Promise.all(
    todays.map((it) => fetchMatchStats(it?.match_id, playerId, auth)),
  );
  let kills = 0;
  let deaths = 0;
  let hsSum = 0;
  let statCount = 0;
  for (const s of perMatch) {
    if (!s) continue;
    statCount++;
    if (s.kills != null) kills += s.kills;
    if (s.deaths != null) deaths += s.deaths;
    if (s.hs != null) hsSum += s.hs;
  }
  const avgKills = statCount ? kills / statCount : null;
  const kd = deaths > 0 ? kills / deaths : statCount ? kills : null;
  const hs = statCount ? hsSum / statCount : null; // already a 0..100 percent

  return { wins, losses, avgKills, kd, hs };
}

// Per-match kills/deaths/HS for one finished match (immutable → cache hard).
async function fetchMatchStats(matchId, playerId, auth) {
  if (!matchId) return null;
  try {
    const res = await fetch(`${FACEIT_BASE}/matches/${matchId}/stats`, {
      ...auth,
      cf: { cacheTtl: 86400, cacheEverything: true },
    });
    if (!res.ok) return null;
    const stats = await res.json();
    const me = findPlayerStats(stats, playerId);
    if (!me) return null;
    return {
      kills: num(me['Kills']),
      deaths: num(me['Deaths']),
      hs: num(me['Headshots %']), // 0..100
    };
  } catch {
    return null;
  }
}

// ---- /resolve (customizer helper) -----------------------------------------

// Turns a Steam identity the user pasted (a steamcommunity.com/id/<vanity> link,
// a bare vanity name, a /profiles/<id> link, or a raw Steam64) into a numeric
// Steam64 ID, so the customizer can build a command URL with a concrete id.
// Vanity names need Steam's ResolveVanityURL (STEAM_API_KEY); the others don't.
async function handleResolve(url, env, cors) {
  const input = (url.searchParams.get('input') || url.searchParams.get('vanity') || '').trim();
  if (!input) return json({ error: 'Missing input' }, 400, cors);

  // A bare Steam64, or one embedded in a /profiles/ link.
  const direct = input.match(/^\d{17}$/) || input.match(/\/profiles\/(\d{17})\b/);
  if (direct) return json({ steamId: direct[1] || direct[0] }, 200, cors);

  // Pull a vanity name out of a /id/<name> link, or take a bare word as one.
  let vanity = null;
  const idLink = input.match(/steamcommunity\.com\/id\/([A-Za-z0-9_.-]{2,64})/i);
  if (idLink) vanity = idLink[1];
  else if (/^[A-Za-z0-9_.-]{2,64}$/.test(input) && !/^\d+$/.test(input)) vanity = input;
  if (!vanity) return json({ error: 'Not a recognizable Steam ID or profile link' }, 400, cors);

  if (!env.STEAM_API_KEY) {
    return json(
      { error: 'Custom /id/ links need the Steam key. Paste a Steam64 ID or /profiles/… link.' },
      501,
      cors,
    );
  }
  try {
    const res = await fetch(
      `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${env.STEAM_API_KEY}&vanityurl=${encodeURIComponent(vanity)}`,
    );
    if (!res.ok) return json({ error: `Steam API error: ${res.status}` }, 502, cors);
    const body = await res.json();
    const steamId = body?.response?.steamid;
    if (body?.response?.success === 1 && /^\d{17}$/.test(steamId || '')) {
      return json({ steamId }, 200, cors);
    }
    return json({ error: "Steam didn't recognize that custom URL name" }, 404, cors);
  } catch {
    return json({ error: 'Failed to reach the Steam API' }, 502, cors);
  }
}

// ---- FACEIT payload helpers (shared with the overlay's faceit-proxy.js) ----

function matchFinishedMs(item) {
  const secs = num(item?.finished_at) ?? num(item?.started_at) ?? 0;
  return secs * 1000;
}

function outcomeFor(item, playerId) {
  const teams = item?.teams ?? {};
  const winner = item?.results?.winner ?? null;
  const inFaction = (key) =>
    Array.isArray(teams?.[key]?.players) &&
    teams[key].players.some((p) => p?.player_id === playerId);
  let faction = null;
  if (inFaction('faction1')) faction = 'faction1';
  else if (inFaction('faction2')) faction = 'faction2';
  if (!faction || !winner) return 'loss';
  return faction === winner ? 'win' : 'loss';
}

function findPlayerStats(stats, playerId) {
  const rounds = Array.isArray(stats?.rounds) ? stats.rounds : [];
  for (const round of rounds) {
    const teams = Array.isArray(round?.teams) ? round.teams : [];
    for (const team of teams) {
      const players = Array.isArray(team?.players) ? team.players : [];
      const me = players.find((p) => p?.player_id === playerId);
      if (me?.player_stats) return me.player_stats;
    }
  }
  return null;
}

// ---- Small utilities ------------------------------------------------------

// Extracts a simple `name=value` param from a raw query string (value decoded,
// stops at `&`). For steamid/timezone, which never contain `&`.
function getParam(query, name) {
  const m = new RegExp(`(?:^|&)${name}=([^&]*)`).exec(query);
  return m ? safeDecode(m[1]) : null;
}

// Everything after the first `view=` to the end of the query, decoded — the raw
// template, which may contain spaces, `|`, `(`, `{{…}}` and even `&`-free text.
function getRawView(query) {
  const i = query.indexOf('view=');
  if (i === -1) return '';
  return safeDecode(query.slice(i + 'view='.length));
}

// decodeURIComponent, but tolerant: a template may contain a literal `%` (or a
// lone one) that would otherwise throw, and `+` should read as a space.
function safeDecode(s) {
  const plus = s.replace(/\+/g, ' ');
  try {
    return decodeURIComponent(plus);
  } catch {
    return plus;
  }
}

function matchTokens(view) {
  return (view.match(/\{\{[a-zA-Z.]+\}\}/g) || []);
}

function num(v) {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

function fmtInt(n) {
  return Number(n).toLocaleString('en-US');
}

function fmtSigned(n) {
  const v = Math.round(Number(n) || 0);
  if (v === 0) return '0';
  return v > 0 ? `+${v}` : String(v);
}

function isValidTz(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// UTC ms of the most recent local midnight in `tz`. Uses the tz offset at `now`
// (good enough for "today's stats" — only DST-transition days differ slightly).
function startOfTodayMs(tz, nowMs) {
  const off = tzOffsetMs(tz, nowMs);
  const local = new Date(nowMs + off); // wall clock, read via UTC getters
  const midnightWall = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  );
  return midnightWall - off;
}

// Offset (ms) such that localWallClock = utc + offset, for `tz` at `nowMs`.
function tzOffsetMs(tz, nowMs) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(nowMs));
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  const asUTC = Date.UTC(
    +map.year,
    +map.month - 1,
    +map.day,
    +map.hour,
    +map.minute,
    +map.second,
  );
  return asUTC - nowMs;
}

function corsHeaders(request) {
  const headers = { 'Access-Control-Allow-Methods': 'GET, OPTIONS', Vary: 'Origin' };
  const origin = request.headers.get('Origin');
  if (origin && ALLOWED_ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function text(body, status, cors, cacheOk = false) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': cacheOk && status === 200 ? 'public, max-age=30' : 'no-store',
      ...cors,
    },
  });
}

function json(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': status === 200 ? 'public, max-age=30' : 'no-store',
      ...cors,
    },
  });
}
