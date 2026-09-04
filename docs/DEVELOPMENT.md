# Development

Local dev, self-hosting, and the Cloudflare Worker that powers every command.
For a plain user walkthrough (no code), see the [README](../README.md).

## Architecture

- **Static site** (this repo) — a Vite + TypeScript customizer, deployed to
  GitHub Pages. No backend, no build-time secrets.
- **One Cloudflare Worker** (`worker/statcmd.js`) — the render engine + Steam
  vanity resolver. Holds the API keys. See [`worker/README.md`](../worker/README.md).

Both live on **one domain**: the site at `statcmd.kapkit.ca/`, the Worker at
`statcmd.kapkit.ca/v3` (and `/resolve`) via a Cloudflare route.

How a command runs:

```
$(urlfetch https://statcmd.kapkit.ca/v3?steamid=<id>&timezone=<tz>&view=<template>)
```

The customizer builds that string. Each time a viewer runs the command, the bot
calls the URL; the **statcmd Worker** looks up the player's live stats,
substitutes the `{{tokens}}` in `view`, and returns the line the bot posts.

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
[`worker/README.md`](../worker/README.md).

### 2. Site build variables (GitHub Actions repository **variables** — not secrets)

Settings → Secrets and variables → Actions → **Variables**:

| Variable | Value | Notes |
|---|---|---|
| `VITE_STATCMD_URL` | `https://statcmd.kapkit.ca/v3` | The Worker's render route. Drives the command + preview. |
| `VITE_MIXPANEL_TOKEN` | project token | Optional analytics. Public, write-only project token — **not** the API Secret. One project per site (Mixpanel's free plan allows unlimited projects). |
| `VITE_MIXPANEL_HOST` | `https://api.mixpanel.com` | Optional. US (default) or `https://api-eu.mixpanel.com` (EU). |
| `VITE_MIXPANEL_SITE` | e.g. `statcmd` | Optional. Only when several sites share one project — attached to every event as a `site` super property for per-site breakdowns. |

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
a sample preview. See [`.env.example`](../.env.example) for every variable.
