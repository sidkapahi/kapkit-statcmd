# Chat badges (upload spots)

Drop your own **PNG** badge images here to show them in the live chat preview.
The app loads them at runtime by exact filename — no code change, no rebuild
needed for the dev server (a production build just needs these files present).

| File (put it here) | Where it shows | In the mockup |
|---|---|---|
| `public/badges/sub.png` | before **Kapowhi** | subscriber badge |
| `public/badges/moderator.png` | before **Fossabot** (1st) | moderator badge |
| `public/badges/bot.png` | before **Fossabot** (2nd) | bot badge |

Notes:
- **Filenames must match exactly** (all lowercase): `sub.png`, `moderator.png`, `bot.png`.
- Square images look best. Any size works — they're scaled to the chat text
  (roughly 24–72px source is plenty). Transparent background recommended.
- If a file is missing, that badge is simply hidden (no broken-image icon), so
  you can add them one at a time.
- Want more than one badge before a name? Say the word and I'll add extra slots.
