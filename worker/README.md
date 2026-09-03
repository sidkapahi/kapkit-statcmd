# statcmd Worker (Cloudflare)

The rendering engine behind every generated command. A chat bot can only
`urlfetch` a public URL, so the actual stat lookup + template substitution has to
happen server-side — that's this Worker. Your API keys stay on it and never
reach a browser or a bot.

```
GET /v3?steamid=<17-digit>&timezone=<IANA>&view=<template>   → text/plain rendered line
GET /resolve?input=<steam url | vanity | id>                 → { "steamId": "…" }
```

`/v3` is what the bot calls. `/resolve` is used only by the customizer, to turn a
`steamcommunity.com/id/<name>` link into a numeric Steam64 ID when building the
command.

## Tokens

`view` is a free-form string; these `{{tokens}}` are replaced with live values.
Anything else is left as-is.

| Token | Source | Value |
|---|---|---|
| `{{rating}}` | Leetify | Current Premier CS Rating (e.g. `15,000`) |
| `{{rating.diff}}` | Leetify | Premier rating change since local midnight (e.g. `+250`) |
| `{{elo}}` | FACEIT | Current FACEIT ELO (e.g. `1,059`) |
| `{{lvl}}` | FACEIT | FACEIT skill level 1–10 |
| `{{elo.diff}}` | FACEIT | FACEIT ELO change since local midnight |
| `{{url}}` | FACEIT | Link to the FACEIT profile |
| `{{todays.wins}}` / `{{todays.losses}}` | FACEIT | Today's match record |
| `{{todays.avgKills}}` | FACEIT | Average kills across today's matches |
| `{{todays.kd}}` | FACEIT | Kills / deaths across today's matches |
| `{{todays.hs}}` | FACEIT | Average headshot % across today's matches |

"Today" means since midnight in the `timezone` query param (an IANA name such as
`America/Toronto`). A token whose data is unavailable (no Premier/FACEIT profile,
or an upstream hiccup) renders as `-` so the command still returns a readable
line.

## Deploy

1. **Get the keys**
   - **FACEIT** (required for FACEIT/Today tokens): create an app at
     <https://developers.faceit.com/> (App Studio) and generate a **server-side**
     API key.
   - **Steam** (required only to accept `steamcommunity.com/id/<vanity>` links in
     the customizer): a free key from <https://steamcommunity.com/dev/apikey>.
   - **Leetify** (optional, only raises rate limits): <https://leetify.com>.

2. **Deploy** with [Wrangler](https://developers.cloudflare.com/workers/wrangler/):

   ```bash
   cd worker
   npx wrangler deploy --config wrangler.statcmd.toml
   ```

3. **Add the secrets** (never commit them):

   ```bash
   npx wrangler secret put FACEIT_API_KEY --config wrangler.statcmd.toml
   npx wrangler secret put STEAM_API_KEY  --config wrangler.statcmd.toml
   npx wrangler secret put LEETIFY_KEY     --config wrangler.statcmd.toml   # optional
   ```

   (Dashboard equivalent: your Worker → Settings → Variables and Secrets → add a
   **secret**.)

4. **Route it onto the domain.** The Worker shares `statcmd.kapkit.ca` with the
   GitHub Pages site:
   - DNS: `statcmd.kapkit.ca` → CNAME `sidkapahi.github.io`, **proxied** (orange
     cloud), so Cloudflare can intercept paths.
   - Worker routes (Workers → your Worker → Triggers → Routes, or the
     `[[routes]]` block in `wrangler.statcmd.toml`):
     `statcmd.kapkit.ca/v3*` and `statcmd.kapkit.ca/resolve*`.
   - Every other path falls through to Pages (the customizer site).

5. **Point the customizer at it** via the `VITE_STATCMD_URL` build variable
   (`https://statcmd.kapkit.ca/v3`) — see the repo README. Since the site and
   `/v3` share an origin in production, the preview call is same-origin; CORS
   only matters for local dev (`http://localhost:5173`), which is already in the
   Worker's `ALLOWED_ORIGINS`.

## CORS / allowed origins

`ALLOWED_ORIGINS` at the top of `statcmd.js` gates **browser** callers (the
customizer's live preview + local dev). Bots aren't browsers, so this never
affects the command itself — it just stops other websites from driving the
preview against your keys. Edit that set (scheme + host, no trailing slash) to
match wherever the customizer is hosted, then redeploy.

## Local dev

```bash
cd worker
# .dev.vars holds the secrets locally (gitignored):
printf 'FACEIT_API_KEY=…\nSTEAM_API_KEY=…\nLEETIFY_KEY=…\n' > .dev.vars
npx wrangler dev --config wrangler.statcmd.toml
# → http://localhost:8787
curl 'http://localhost:8787/v3?steamid=76561198123894701&timezone=America/Toronto&view=FACEIT: Level {{lvl}} ({{elo}}) | PREMIER: {{rating}}'
```

Point the site's `.env.local` `VITE_STATCMD_URL` at `http://localhost:8787/v3`
to preview against the local Worker.
