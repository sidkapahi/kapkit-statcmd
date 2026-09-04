<div align="center">

<!-- Header image — drop your file at assets/header.png (or update the src below)
     and it renders here. Delete this block if you'd rather not have one. -->
<img src="assets/header.png" alt="kapKit — CS2 Stats Command" width="100%" />

# kapKit — CS2 Stats Command

Build a **CS2 FACEIT + Premier stats command** for your chat bot. Point it at a
Steam profile, click the datapoints you want, and paste the generated
`$(urlfetch …)` line into any chatbot (e.x. Nightbot, Fossabot, Streamelements, etc.)

Live stats come from [Leetify](https://leetify.com) (Premier) and the
[FACEIT](https://www.faceit.com) Data API.

[![license MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

---

## How it works

```
$(urlfetch https://statcmd.kapkit.ca/v3?steamid=<id>&timezone=<tz>&view=<template>)
```

The customizer builds that string. Each time a viewer runs your command, the bot
calls the URL; the **statcmd Worker** looks up the player's live stats,
substitutes the `{{tokens}}` in `view`, and returns the line the bot posts:

> **FACEIT: Level 5 (1,059) | PREMIER: 15,000**

### Datapoints

| Group | Token | Value |
|---|---|---|
| **Premier** | `{{rating}}` | Current Premier CS Rating |
| | `{{rating.diff}}` | Premier rating change today |
| **FACEIT** | `{{elo}}` | Current FACEIT ELO |
| | `{{lvl}}` | FACEIT skill level (1–10) |
| | `{{elo.diff}}` | FACEIT ELO change today |
| | `{{url}}` | Link to the FACEIT profile |
| **Today** | `{{todays.wins}}` / `{{todays.losses}}` | Today's record |
| | `{{todays.avgKills}}` | Average kills across today's matches |
| | `{{todays.kd}}` | Kills / deaths across today's matches |
| | `{{todays.hs}}` | Average headshot % across today's matches |

"Today" is measured since midnight in the timezone you pick. A datapoint with no
data (no Premier/FACEIT profile, or an upstream hiccup) renders as `-`.

## Architecture

- **Static site** (this repo) — a Vite + TypeScript customizer, deployed to
  GitHub Pages. No backend, no build-time secrets.
- **One Cloudflare Worker** (`worker/statcmd.js`) — the render engine + Steam
  vanity resolver. Holds the API keys. See [`worker/README.md`](worker/README.md).

Both live on **one domain**: the site at `statcmd.kapkit.ca/`, the Worker at
`statcmd.kapkit.ca/v3` (and `/resolve`) via a Cloudflare route.

## Setup — workers, variables & secrets

### 1. Cloudflare Worker (`statcmd`)

Deploy `worker/statcmd.js` and add its secrets:

| Secret | Required? | Purpose |
|---|---|---|
| `FACEIT_API_KEY` | **Yes** for FACEIT/Today tokens | FACEIT Data API server key ([developers.faceit.com](https://developers.faceit.com/)) |
| `STEAM_API_KEY` | **Yes** to accept `steamcommunity.com/id/<vanity>` links | Steam Web API key ([steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey)) |
| `LEETIFY_KEY` | Optional | Only raises Leetify rate limits |

```bash
cd worker
npx wrangler deploy --config wrangler.statcmd.toml
npx wrangler secret put FACEIT_API_KEY --config wrangler.statcmd.toml
npx wrangler secret put STEAM_API_KEY  --config wrangler.statcmd.toml
npx wrangler secret put LEETIFY_KEY     --config wrangler.statcmd.toml   # optional
```

Then route it onto the domain (Workers → Triggers → Routes):
`statcmd.kapkit.ca/v3*` and `statcmd.kapkit.ca/resolve*`. Full details in
[`worker/README.md`](worker/README.md).

### 2. Site build variables (GitHub Actions repository **variables** — not secrets)

Settings → Secrets and variables → Actions → **Variables**:

| Variable | Value | Notes |
|---|---|---|
| `VITE_STATCMD_URL` | `https://statcmd.kapkit.ca/v3` | The Worker's render route. Drives the command + preview. |
| `VITE_POSTHOG_KEY` | `phc_…` | Optional analytics. Public write key. |
| `VITE_POSTHOG_HOST` | `https://us.i.posthog.com` | Optional. US or EU region. |

These are inlined into the public bundle at build time, so they are **not**
secrets — a repository *variable* is the right home.

### 3. DNS / Pages

- DNS: `statcmd.kapkit.ca` → CNAME `sidkapahi.github.io`, **proxied** (orange
  cloud) so the Worker routes can intercept `/v3` and `/resolve`.
- GitHub → Settings → Pages → Source = **GitHub Actions**; custom domain
  `statcmd.kapkit.ca` (the committed `public/CNAME`); enable HTTPS.

## Local development

```bash
npm install
npm run dev            # customizer at http://localhost:5173
```

For live previews against a local Worker, run it in a second terminal and point
`.env.local` at it:

```bash
# .env.local
VITE_STATCMD_URL=http://localhost:8787/v3
```

```bash
cd worker
printf 'FACEIT_API_KEY=…\nSTEAM_API_KEY=…\n' > .dev.vars   # gitignored
npx wrangler dev --config wrangler.statcmd.toml
```

Without a Worker URL the customizer still builds valid command strings and shows
a sample preview.

## License

[MIT](LICENSE). Not affiliated with Valve, FACEIT, or Leetify.
