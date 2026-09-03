import './customizer.css';

import { parseSteamInput } from '../shared/steamId';
import {
  TOKEN_GROUPS,
  STATCMD_CONFIGURED,
  RESOLVE_URL,
  buildCommand,
  buildCommandUrl,
  stateToParams,
  paramsToState,
  type StatcmdState,
  type TokenGroupId,
} from '../shared/statcmd';
import { allTimezones, defaultTimezone, isValidTimezone } from '../shared/timezones';
import {
  initAnalytics,
  trackEvent,
  analyticsEnabled,
  consentDecided,
  grantConsent,
  revokeConsent,
} from '../shared/analytics';

// Bundled assets (Vite rewrites these to hashed URLs).
import ghIcon from '../../assets/logos/github.svg';
import kofiIcon from '../../assets/logos/kofi.svg';
import twitchIcon from '../../assets/logos/twitch-mark.svg';
import faceitMark from '../../assets/logos/faceit.svg';
import csLogo from '../../assets/logos/cs2.png';
import kapkitLogo from '../../assets/kapKit_logo.png';

// Twitch-style chat badges for the preview are loaded at runtime from
// public/badges/ (drop your own PNGs there — see public/badges/README.md).
// A missing file is hidden rather than shown broken (see hideMissingBadges).
const SUB_BADGE = '/badges/sub.png';
const MOD_BADGE = '/badges/moderator.png';
const BOT_BADGE = '/badges/bot.png';

const REPO_URL = 'https://github.com/sidkapahi/kapkit-statcmd';
const KOFI_URL = 'https://ko-fi.com/sidkapahi';
const TWITCH_URL = 'https://twitch.tv/';

// Inline icons.
const caretSvg =
  '<svg class="caret" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const copySvg =
  '<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="7" y="7" width="10" height="10" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M4 13H3.5A1.5 1.5 0 0 1 2 11.5v-8A1.5 1.5 0 0 1 3.5 2h8A1.5 1.5 0 0 1 13 3.5V4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const checkSvg =
  '<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 10.5l4 4 8-9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// ---- State ----------------------------------------------------------------

const state: StatcmdState = paramsToState(
  new URLSearchParams(location.search),
  defaultTimezone(),
);
if (!isValidTimezone(state.timezone)) state.timezone = defaultTimezone();

// The numeric Steam64 ID resolved from whatever the user typed (may be a URL or
// vanity name). Empty until a valid identity resolves.
let resolvedSteamId = '';
let resolveToken = 0; // guards against out-of-order async resolves

const TIMEZONES = allTimezones();

// ---- DOM ------------------------------------------------------------------

const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="shell">
    ${renderSidebar()}
    ${renderStage()}
  </div>
  ${renderModals()}
  ${renderCookieBanner()}
`;

// Element handles.
const steamInput = byId<HTMLInputElement>('steam-input');
const steamMsg = byId<HTMLDivElement>('steam-msg');
const tzBtn = byId<HTMLButtonElement>('tz-btn');
const tzValue = byId<HTMLSpanElement>('tz-value');
const tzCombo = byId<HTMLDivElement>('tz-combo');
const tzSearch = byId<HTMLInputElement>('tz-search');
const tzList = byId<HTMLDivElement>('tz-list');
const outputArea = byId<HTMLTextAreaElement>('output-area');
const commandText = byId<HTMLDivElement>('command-text');
const copyBtn = byId<HTMLButtonElement>('copy-btn');
const chatOutput = byId<HTMLSpanElement>('chat-output');

// ---- Sidebar markup -------------------------------------------------------

function renderSidebar(): string {
  return `
  <aside class="setup">
    <div class="setup-head">
      <div class="setup-title-block">
        <h1 class="setup-title">CS2 Stats Command</h1>
        <p class="setup-sub">Customize and plug into your own bot for an elo or stats command. Data provided by <a href="https://leetify.com/" target="_blank" rel="noopener">Leetify</a></p>
      </div>
      <div class="link-row">
        <a class="gh-chip" href="${REPO_URL}" target="_blank" rel="noopener">
          <img src="${ghIcon}" alt="GitHub" />
          <span>kapkit-statcmd</span>
        </a>
        <a class="icon-btn kofi" href="${KOFI_URL}" target="_blank" rel="noopener" aria-label="Support on Ko-fi">
          <img src="${kofiIcon}" alt="Ko-fi" />
        </a>
        <a class="icon-btn twitch" href="${TWITCH_URL}" target="_blank" rel="noopener" aria-label="Twitch">
          <img src="${twitchIcon}" alt="Twitch" />
        </a>
      </div>
    </div>

    <div class="setup-body">
      <div class="field">
        <label class="field-label" for="steam-input">STEAM</label>
        <input class="input" id="steam-input" type="text" spellcheck="false" autocomplete="off"
          placeholder="https://steamcommunity.com/id/..." value="${escapeAttr(state.steamInput)}" />
        <div class="field-msg" id="steam-msg"></div>
      </div>

      <div class="field tz">
        <label class="field-label">TIMEZONE</label>
        <div class="combo" id="tz-combo">
          <button type="button" class="combo-btn" id="tz-btn" aria-haspopup="listbox" aria-expanded="false">
            <span id="tz-value">${escapeHtml(state.timezone)}</span>
            ${caretSvg}
          </button>
          <div class="combo-panel">
            <input class="combo-search" id="tz-search" type="text" placeholder="Search timezone…" autocomplete="off" />
            <div class="combo-list" id="tz-list" role="listbox"></div>
          </div>
        </div>
      </div>

      <div class="divider"></div>

      <div class="output-block">
        <label class="field-label" for="output-area">OUTPUT</label>
        <div class="output-stack">
          <textarea class="output-area" id="output-area" spellcheck="false">${escapeHtml(state.view)}</textarea>
          ${TOKEN_GROUPS.map(renderGroup).join('')}
        </div>
      </div>
    </div>

    <div class="setup-footer">
      <div class="brand">
        <img src="${kapkitLogo}" alt="kapKit" />
      </div>
      <div class="footer-links">
        <button type="button" id="open-privacy">Privacy Policy</button>
        <span class="footer-dot"></span>
        <button type="button" id="open-terms">Terms of Service</button>
      </div>
    </div>
  </aside>`;
}

function groupIcon(id: TokenGroupId): string {
  if (id === 'premier') return `<img class="cs-badge" src="${csLogo}" alt="" />`;
  return `<img src="${faceitMark}" alt="" />`;
}

function renderGroup(group: (typeof TOKEN_GROUPS)[number]): string {
  return `
    <div class="dp-group">
      <div class="dp-head">${groupIcon(group.id)}<span>${group.label}</span></div>
      <div class="dp-btns">
        ${group.tokens
          .map(
            (t) =>
              `<button type="button" class="dp-btn" data-token="${escapeAttr(t.token)}" title="${escapeAttr(t.hint)}">${t.label}</button>`,
          )
          .join('')}
      </div>
    </div>`;
}

// ---- Stage markup ---------------------------------------------------------

function renderStage(): string {
  return `
  <section class="stage">
    <div class="chat-card">
      <div class="chat-lines">
        <div class="chat-line">
          <div class="chat-body"><img class="chat-badge" src="${SUB_BADGE}" alt="Subscriber" /><span class="chat-name-green">Kapowhi</span><span class="chat-sep">: </span><span class="chat-text">!elo</span></div>
        </div>
        <div class="chat-line">
          <div class="chat-body"><img class="chat-badge" src="${MOD_BADGE}" alt="Moderator" /><img class="chat-badge" src="${BOT_BADGE}" alt="Bot" /><span class="chat-name-blue">Fossabot</span><span class="chat-sep">: </span><span class="chat-text" id="chat-output"></span></div>
        </div>
      </div>
    </div>

    <div class="command-card">
      <div class="command-inner">
        <div class="command-label">Command Content - Paste into command response</div>
        <div class="command-box">
          <div class="command-text" id="command-text"></div>
          <button type="button" class="copy-btn" id="copy-btn" aria-label="Copy command">${copySvg}</button>
        </div>
      </div>
    </div>
  </section>`;
}

// ---- Wiring ---------------------------------------------------------------

// STEAM input → resolve → refresh.
let steamDebounce: number | undefined;
steamInput.addEventListener('input', () => {
  state.steamInput = steamInput.value;
  window.clearTimeout(steamDebounce);
  steamDebounce = window.setTimeout(resolveSteam, 400);
  syncUrl();
});

async function resolveSteam(): Promise<void> {
  const raw = state.steamInput.trim();
  const parsed = parseSteamInput(raw);
  const token = ++resolveToken;

  if (parsed.kind === 'empty') {
    resolvedSteamId = '';
    setSteamMsg('Enter your Steam profile link or Steam64 ID to finish the command.', '');
    refresh();
    return;
  }
  if (parsed.kind === 'id') {
    resolvedSteamId = parsed.steamId;
    setSteamMsg('', 'ok');
    refresh();
    return;
  }
  if (parsed.kind === 'invalid') {
    setSteamMsg("That doesn't look like a Steam profile link or Steam64 ID.", 'error');
    refresh();
    return;
  }

  // Vanity (steamcommunity.com/id/<name>) — needs the Worker's /resolve route.
  setSteamMsg('Resolving profile…', '');
  try {
    const res = await fetch(`${RESOLVE_URL}?input=${encodeURIComponent(raw)}`, { cache: 'no-store' });
    if (token !== resolveToken) return; // superseded by a newer input
    const body = (await res.json().catch(() => ({}))) as { steamId?: string; error?: string };
    if (res.ok && body.steamId && /^\d{17}$/.test(body.steamId)) {
      resolvedSteamId = body.steamId;
      setSteamMsg('', 'ok');
    } else {
      setSteamMsg(
        body.error || "Couldn't resolve that profile — paste your Steam64 ID or a /profiles/… link.",
        'error',
      );
    }
  } catch {
    if (token !== resolveToken) return;
    setSteamMsg('Could not reach the resolver. Paste your Steam64 ID instead.', 'error');
  }
  refresh();
}

function setSteamMsg(msg: string, kind: '' | 'ok' | 'error'): void {
  steamMsg.textContent = msg;
  steamMsg.className = `field-msg${kind ? ' ' + kind : ''}`;
}

// OUTPUT textarea → refresh.
outputArea.addEventListener('input', () => {
  state.view = outputArea.value;
  syncUrl();
  refresh();
});

// Datapoint buttons → insert token at cursor.
for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>('.dp-btn'))) {
  btn.addEventListener('click', () => {
    insertAtCursor(outputArea, btn.dataset.token ?? '');
    state.view = outputArea.value;
    syncUrl();
    refresh();
    btn.classList.add('flash');
    window.setTimeout(() => btn.classList.remove('flash'), 260);
    trackEvent('token_inserted', { token: btn.dataset.token ?? '' });
  });
}

function insertAtCursor(el: HTMLTextAreaElement, text: string): void {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  el.value = el.value.slice(0, start) + text + el.value.slice(end);
  const pos = start + text.length;
  el.setSelectionRange(pos, pos);
  el.focus();
}

// Copy button.
copyBtn.addEventListener('click', () => {
  if (copyBtn.classList.contains('copied')) return;
  const cmd = currentCommand();
  navigator.clipboard?.writeText(cmd).catch(() => {});
  copyBtn.classList.add('copied');
  copyBtn.innerHTML = checkSvg;
  window.setTimeout(() => {
    copyBtn.classList.remove('copied');
    copyBtn.innerHTML = copySvg;
  }, 1600);
  trackEvent('command_copied', { hasSteamId: Boolean(resolvedSteamId) });
});

// ---- Timezone combobox ----------------------------------------------------

let tzActiveIndex = -1;
let tzFiltered: string[] = TIMEZONES;

function openTz(open: boolean): void {
  tzCombo.classList.toggle('open', open);
  tzBtn.setAttribute('aria-expanded', String(open));
  if (open) {
    tzSearch.value = '';
    renderTzList(TIMEZONES);
    window.setTimeout(() => tzSearch.focus(), 0);
  }
}

tzBtn.addEventListener('click', () => openTz(!tzCombo.classList.contains('open')));

tzSearch.addEventListener('input', () => {
  const q = tzSearch.value.trim().toLowerCase();
  const filtered = q
    ? TIMEZONES.filter((t) => t.toLowerCase().includes(q))
    : TIMEZONES;
  renderTzList(filtered);
});

tzSearch.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    setTzActive(Math.min(tzActiveIndex + 1, tzFiltered.length - 1));
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    setTzActive(Math.max(tzActiveIndex - 1, 0));
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (tzFiltered[tzActiveIndex]) selectTz(tzFiltered[tzActiveIndex]);
  } else if (e.key === 'Escape') {
    openTz(false);
    tzBtn.focus();
  }
});

function renderTzList(list: string[]): void {
  tzFiltered = list;
  tzActiveIndex = list.length ? 0 : -1;
  if (!list.length) {
    tzList.innerHTML = `<div class="combo-empty">No matching timezone</div>`;
    return;
  }
  // Cap the rendered rows for performance; search narrows quickly.
  const shown = list.slice(0, 300);
  tzList.innerHTML = shown
    .map(
      (tz, i) =>
        `<div class="combo-option${i === 0 ? ' active' : ''}" role="option" data-tz="${escapeAttr(tz)}" aria-selected="${tz === state.timezone}">${escapeHtml(tz)}</div>`,
    )
    .join('');
  for (const opt of Array.from(tzList.querySelectorAll<HTMLDivElement>('.combo-option'))) {
    opt.addEventListener('click', () => selectTz(opt.dataset.tz ?? ''));
  }
}

function setTzActive(index: number): void {
  tzActiveIndex = index;
  const opts = tzList.querySelectorAll<HTMLDivElement>('.combo-option');
  opts.forEach((o, i) => o.classList.toggle('active', i === index));
  opts[index]?.scrollIntoView({ block: 'nearest' });
}

function selectTz(tz: string): void {
  if (!tz) return;
  state.timezone = tz;
  tzValue.textContent = tz;
  openTz(false);
  syncUrl();
  refresh();
}

// Close the combo when clicking outside.
document.addEventListener('click', (e) => {
  if (!tzCombo.contains(e.target as Node)) openTz(false);
});

// ---- Modals & cookie banner ----------------------------------------------

wireModal('open-privacy', 'modal-privacy');
wireModal('open-terms', 'modal-terms');

function wireModal(openId: string, modalId: string): void {
  const opener = document.getElementById(openId);
  const backdrop = document.getElementById(modalId);
  if (!opener || !backdrop) return;
  opener.addEventListener('click', () => backdrop.classList.add('open'));
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.classList.remove('open');
  });
  backdrop.querySelector('.modal-close')?.addEventListener('click', () => backdrop.classList.remove('open'));
}

// ---- Render ---------------------------------------------------------------

function currentCommand(): string {
  return buildCommand(steamIdForCommand(), state.timezone, state.view);
}

// The id put into the command: the resolved numeric id, or a placeholder so the
// shape is visible before a profile is entered.
function steamIdForCommand(): string {
  return resolvedSteamId || 'YOUR_STEAM_ID';
}

// Refreshes the command string + live chat preview from current state.
function refresh(): void {
  commandText.textContent = currentCommand();
  updatePreview();
}

let previewDebounce: number | undefined;
let previewToken = 0;

function updatePreview(): void {
  window.clearTimeout(previewDebounce);
  // No real Worker configured, or no profile yet → show a rendered-looking sample
  // so the layout is populated without a network call.
  if (!STATCMD_CONFIGURED || !resolvedSteamId) {
    chatOutput.textContent = samplePreview(state.view);
    return;
  }
  previewDebounce = window.setTimeout(async () => {
    const token = ++previewToken;
    chatOutput.textContent = samplePreview(state.view); // optimistic placeholder
    try {
      const res = await fetch(
        buildCommandUrl(resolvedSteamId, state.timezone, state.view),
        { cache: 'no-store' },
      );
      const body = await res.text();
      if (token === previewToken) chatOutput.textContent = body.trim() || '—';
    } catch {
      if (token === previewToken) chatOutput.textContent = samplePreview(state.view);
    }
  }, 450);
}

// Substitutes tokens with illustrative sample values (used before a profile
// resolves or when no Worker is configured). Mirrors the Worker's token set.
function samplePreview(view: string): string {
  const samples: Record<string, string> = {
    '{{rating}}': '15,000',
    '{{rating.diff}}': '+250',
    '{{elo}}': '1,059',
    '{{lvl}}': '5',
    '{{elo.diff}}': '+34',
    '{{url}}': 'faceit.com/en/players/Kapahiii',
    '{{todays.wins}}': '4',
    '{{todays.losses}}': '1',
    '{{todays.avgKills}}': '22.4',
    '{{todays.kd}}': '1.24',
    '{{todays.hs}}': '48%',
  };
  return view.replace(/\{\{[a-zA-Z.]+\}\}/g, (t) => samples[t] ?? t).replace(/\r?\n/g, ' ');
}

// Keeps the customizer's own URL in sync so a configured build is shareable.
function syncUrl(): void {
  const params = stateToParams(state);
  const qs = params.toString();
  const next = qs ? `${location.pathname}?${qs}` : location.pathname;
  history.replaceState(null, '', next);
}

// ---- Init -----------------------------------------------------------------

renderTzList(TIMEZONES);
hideMissingBadges();
initAnalytics();
mountCookieBanner();
void resolveSteam();
refresh();

// Chat badges are optional PNGs in public/badges/. When one isn't present the
// <img> would show a broken-image glyph, so drop it instead — the preview then
// simply renders without that badge.
function hideMissingBadges(): void {
  for (const img of Array.from(document.querySelectorAll<HTMLImageElement>('.chat-badge'))) {
    img.addEventListener('error', () => img.remove());
    if (img.complete && img.naturalWidth === 0) img.remove();
  }
}

// ---- Helpers --------------------------------------------------------------

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

// ---- Modals markup --------------------------------------------------------

function renderModals(): string {
  return `
  <div class="modal-backdrop" id="modal-privacy" role="dialog" aria-modal="true" aria-labelledby="privacy-title">
    <div class="modal">
      <h2 class="modal-title" id="privacy-title">Privacy &amp; Cookies</h2>
      <p>This tool builds a chat-command string in your browser. The Steam profile and timezone you enter are used to construct the command URL and to render the live preview.</p>
      <h3>Live preview &amp; the command</h3>
      <p>The preview and the generated command call the kapKit statcmd service (<a href="https://statcmd.kapkit.ca/" target="_blank" rel="noopener">statcmd.kapkit.ca</a>), which looks up public CS2 stats for the Steam ID you provide from <a href="https://leetify.com" target="_blank" rel="noopener">Leetify</a> (Premier) and the <a href="https://www.faceit.com" target="_blank" rel="noopener">FACEIT</a> Data API. Only your Steam ID, timezone, and template are sent — no personal account access is needed.</p>
      <h3>Analytics</h3>
      <p>If analytics is enabled on this deployment, anonymous, aggregate usage counts are collected via <a href="https://posthog.com" target="_blank" rel="noopener">PostHog</a>, and only after you accept the cookie banner. No Steam ID or personal data is sent. You can decline and the tool works exactly the same.</p>
      <p>Questions? Email <a class="modal-mail" href="mailto:hey@sidkapahi.com">hey@sidkapahi.com</a>.</p>
      <button type="button" class="modal-close">Close</button>
    </div>
  </div>

  <div class="modal-backdrop" id="modal-terms" role="dialog" aria-modal="true" aria-labelledby="terms-title">
    <div class="modal">
      <h2 class="modal-title" id="terms-title">Terms of Service</h2>
      <p>kapKit statcmd is a free tool published at <a href="https://statcmd.kapkit.ca/" target="_blank" rel="noopener">statcmd.kapkit.ca</a> with source at <a href="${REPO_URL}" target="_blank" rel="noopener">github.com/sidkapahi/kapkit-statcmd</a>, released under the MIT License. By using it you accept these terms.</p>
      <h3>Third-party data</h3>
      <p>The commands read public CS2 stats from Leetify and FACEIT for the Steam profile you point it at. You are responsible for using those services within their own terms:</p>
      <ul>
        <li><a href="https://leetify.com/terms-of-service" target="_blank" rel="noopener">Leetify Terms of Service</a></li>
        <li><a href="https://www.faceit.com/en/terms" target="_blank" rel="noopener">FACEIT Terms of Service</a></li>
        <li><a href="https://store.steampowered.com/subscriber_agreement/" target="_blank" rel="noopener">Steam Subscriber Agreement</a></li>
      </ul>
      <h3>No warranty</h3>
      <p>The tool is provided “as is”, without warranty of any kind. Stats depend on third-party APIs and may be unavailable or inaccurate at times. Because it is free, you assume responsibility for how you use it.</p>
      <p>Questions? Email <a class="modal-mail" href="mailto:hey@sidkapahi.com">hey@sidkapahi.com</a>.</p>
      <button type="button" class="modal-close">Close</button>
    </div>
  </div>`;
}

function renderCookieBanner(): string {
  return `
  <div class="cookie-banner" id="cookie-banner">
    <p>We use privacy-friendly, anonymous analytics to see which features get used. No Steam ID or personal data is collected. See the <a id="cookie-privacy">Privacy Policy</a>.</p>
    <div class="cookie-actions">
      <button type="button" class="cookie-reject" id="cookie-reject">Decline</button>
      <button type="button" class="cookie-accept" id="cookie-accept">Accept</button>
    </div>
  </div>`;
}

function mountCookieBanner(): void {
  const banner = document.getElementById('cookie-banner');
  if (!banner) return;
  if (!analyticsEnabled() || consentDecided()) return;
  banner.classList.add('open');
  document.getElementById('cookie-accept')?.addEventListener('click', () => {
    grantConsent();
    banner.classList.remove('open');
  });
  document.getElementById('cookie-reject')?.addEventListener('click', () => {
    revokeConsent();
    banner.classList.remove('open');
  });
  document.getElementById('cookie-privacy')?.addEventListener('click', () => {
    document.getElementById('modal-privacy')?.classList.add('open');
  });
}
