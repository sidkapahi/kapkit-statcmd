# Branding assets

Files in this folder are served at the site root by Vite (e.g.
`public/branding/favicon.png` → `https://statcmd.kapkit.ca/branding/favicon.png`).

## favicon.png

The browser-tab icon, referenced from `index.html`.

**To swap it:** drop your image in here named exactly `favicon.png`, replacing the
current file. No code changes are needed — `index.html` already points at
`/branding/favicon.png`. A square PNG (e.g. 512×512) works best.

## og-image.png

The social-share / link-preview image (`og:image` + `twitter:image`). Currently a
copy of `assets/header.png`. Replace this file to change the embed preview; keep
the `og-image.png` name so the meta tags in `index.html` keep resolving.
