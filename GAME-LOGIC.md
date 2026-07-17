# Nakar — Game Logic Reference

This document describes what the game **does** and the rules it must follow.
It contains **zero visual/design decisions on purpose** — no colors, no
fonts, no component styling. The visual design for this rebuild comes
entirely from the provided prototype/reference images and
`Nakar_Türkiye_Prototipi-handoff.zip`. Do not reintroduce any prior color
tokens, font choices, or CSS patterns from anywhere else — treat the visual
layer as a clean slate defined only by the new reference.

Everything below is carried forward from a mature, tested prior
implementation and must be preserved functionally, even as the UI is
rebuilt from scratch.

---

## 1. Architecture rules (non-negotiable)

- Vanilla HTML + CSS + JS. No framework, no build step, no bundler, no
  runtime dependencies.
- Zero third-party CDN usage of any kind (no Google Fonts, no icon CDNs,
  no JS libraries loaded remotely). Any font or icon set the new design
  needs must be self-hosted inside the repo.
- Hosting target: GitHub Pages (static only).
- Page weight budget: HTML+CSS+JS combined should stay near 200 KB
  uncompressed (this reflects real scope — daily/unlimited/rush modes,
  hint system, archive, achievements, meydan links, canvas score cards —
  not a hard wall, but a sanity check). Fonts/data JSON are excluded from
  this budget.
- Data lives in `data/*.json`, one file per category, plus
  `data/categories.json` as the index. This data is already complete
  (2118 songs across 16 category files) and must not be regenerated or
  re-curated — only consumed.
- `tools/` contains Node build/validation scripts (`validate.js`,
  `build-playlist.js`, `build-decades.js`) — not deployed to the site,
  don't touch unless explicitly asked.

## 2. Data schema

`data/<category>.json`:
```json
{
  "id": "turk-pop",
  "ad": "Türk Pop",
  "sarkilar": [
    { "deezerId": 16412330, "baslik": "Şımarık", "sanatci": "Tarkan", "yil": 1997 }
  ]
}
```
- `deezerId` unique within a file. `yil` is optional — many entries
  legitimately omit it (couldn't be verified without guessing); never
  fabricate a year.
- Song titles/artist names are the display strings; JSON field names
  (`ad`, `sarkilar`, `baslik`, `sanatci`, `yil`) are Turkish by design —
  part of the shipped data contract, don't rename them.

`data/categories.json` — index of all categories, each entry has an `id`,
`ad`, and a `grup` field used to sort categories into page sections:
- `grup: "tur"` — 6 core genres: turk-pop, anadolu-rock, arabesk, turkuler,
  turkce-rap, slow-damar.
- `grup: "yil"` — 5 decade categories: y1980, y1990, y2000, y2010, y2020.
  These are **auto-derived** from the `yil` field across the "tur"
  categories via `tools/build-decades.js` — never hand-curated.
- `grup: "dizi"` — dizi-muzikleri (TV theme songs; intentionally small,
  ~34 songs, under the usual 60-song floor — a real catalog limitation,
  not a bug).
- `grup: "diger"` — turkiye-top-100, yeni-cikanlar.
- `gunun` (Günün Şarkısı) has **no grup** — it's the main mixed/default
  category, not part of the grid, sampled from all others.
- A 7th "Eurovision Türkiye" category is a placeholder only — no real
  data behind it, shown as a disabled "Yakında" card. Don't invent data
  for it.

## 3. Game modes

Three modes, always available via a top-level switcher:

### Günlük (Daily)
- Every category has its own independent daily puzzle.
- **Period length: 12 hours**, aligned to Turkey local time (UTC+3, no
  DST) — periods reset at 00:00 and 12:00 Turkey time. (A prior version
  used a 24-hour period aligned to UTC midnight; this was deliberately
  changed. Do not revert to a 24-hour or UTC-aligned period.)
- Song selection is deterministic: an FNV-1a hash of
  `(periodId + ":" + categoryId)` picks the index into that category's
  song list. `Math.random` must never be used for this pick.
- Repeat protection: a song shouldn't repeat within roughly 90 real days'
  worth of periods (scale the lookback window for the 12h period length —
  i.e. ~180 periods, not 90).
- Game state (attempts so far, hints revealed, finished/not) persists to
  `localStorage` per category per period, so a page refresh resumes
  mid-round. Once a period's round is finished, replay is blocked; show
  the result + a countdown to the next period boundary instead.
- A small summary bar shows daily progress across categories for the
  current period (e.g. "X/Y oynandı · Z doğru") with a link into the
  Archive (see below).

### Sınırsız (Unlimited)
- Random song per round within the active category (`Math.random` is
  fine here — this is the one place it's allowed).
- Not part of the daily period system; can be replayed endlessly.
- Has its own separate stats (see §7) — distinct from daily stats, never
  merged.

### Yarış (Rush)
- A timed challenge: 60-second countdown, score increments per correct
  guess within the window. A wrong guess does **not** end the round or
  change the song — the round continues until the clock runs out or the
  player leaves.
- Free skip (no attempt cost) — skipping doesn't consume anything, it's
  about speed within the timer.
- Tracked as a per-category "best score" (see §7) — a simple high-score
  card, not the same distribution/streak UI as daily/unlimited.

## 4. Core guess mechanics (applies to Günlük, Sınırsız, and — with the
   above Rush-specific exceptions — Yarış)

- 6 attempts. Unlocked preview duration ladder (cumulative seconds):
  `1 → 2 → 4 → 7 → 11 → 16`. Skipping an attempt unlocks the next tier;
  a correct guess or the 6th failed attempt ends the round and unlocks
  the full 30s preview on the result screen.
- Guesses are **selection-only** via autocomplete over the active
  category's song list — no free-text submission.
- Matching is accent/case-insensitive: normalize `ş→s ı→i ğ→g ö→o ü→u
  ç→c` both directions, plus correct handling of Turkish İ/I casing
  (naive `toLowerCase()` mishandles this — use an explicit mapping).
- Outcomes per attempt: 🟩 correct, 🟨 correct artist but wrong song
  ("Sanatçı doğru!" hint shown), 🟥 wrong, ⬜ skipped.
- Skipping must not interrupt in-progress audio playback — if a clip is
  still playing when skip unlocks a longer duration, playback continues
  seamlessly toward the new cutoff rather than stopping/restarting. (This
  was a real regression once — verify it explicitly after any audio-timer
  refactor.)

## 5. Hint system

- Off by default. A toggle (visually: a lightbulb-style icon near the
  play control) lets the player opt in per round. While off, no hint UI
  is shown at all — gameplay is identical to a hint-free game.
- When enabled, one hint tier reveals per spent attempt (guess or skip),
  in this order: **word count → first letter → decade (only if the
  active category's songs span more than one decade — skip this tier
  entirely for single-era categories like turk-pop/turkce-rap/
  yeni-cikanlar) → artist name → masked per-word initials**. Artist name
  is deliberately late (revealing it early trivializes the audio-guessing
  challenge).
- Hints derive only from existing fields (`baslik`, `sanatci`, `yil`) —
  no new data needed. Hint state is per-round UI state, not persisted to
  localStorage.

## 6. Sharing, score card, and challenge links

- **Emoji share text**: `Nakar #N · <Kategori Adı>` on one line, then
  `🔊` + one icon per attempt (⬜ skip, 🟥 wrong, 🟨 artist-correct, 🟩
  correct) — omit trailing attempts on a win, show all 6 on a loss — then
  the domain. `#N` = periods elapsed since launch. Uses
  `navigator.share` when available, clipboard copy otherwise with a
  visible confirmation.
- **Canvas score-card image**: a shareable PNG generated via the native
  Canvas API (no dependency) showing the emoji grid + song/category info,
  offered alongside the text share (download or `navigator.share` with
  files where supported).
- **Meydan (challenge link)**: encodes category + a specific `deezerId`
  into a URL query parameter — fully client-side, no server, no personal
  data. On load, a valid param starts a one-off round on that exact song
  instead of the normal daily/unlimited flow. The param must be
  defensively validated (confirm the category exists and the deezerId
  exists within it) before use — a malformed/tampered param falls back
  silently to normal daily mode, no crash, no error shown to the user.

## 7. Stats, streaks, and achievements

- Stats are tracked **per category**, and **separately for daily vs.
  unlimited** — a daily streak and an unlimited "run" streak are
  different counters that must never be merged or conflated. Rush has
  its own simple best-score tracking, separate from both.
- Per category/mode: played, won, win %, current streak, longest streak,
  guess-distribution (which attempt the win landed on, buckets 1–6).
- Favorites: a heart toggle per category, persisted, reflected as a
  filled/outline icon state (not just a one-off animation — the toggle
  state must be visibly readable after the fact).
- Archive: the last 30 daily periods **per category**, computed
  client-side from the existing deterministic hash — no network calls
  needed to build the list; only fetch a song's real data when the
  player actually opens an archived entry.
- Achievements: a small set of milestone badges (first win, a daily
  streak milestone, a no-skip/first-attempt win, an unlimited-mode
  correct-guess milestone, playing at least one round in every category,
  etc. — expand this set reasonably, doesn't need to match any specific
  prior list exactly). Stored under its own schema-versioned localStorage
  key.
- Settings (separate from stats): autoplay next clip, reduce animations,
  a dim/low-brightness display mode — persisted, defaults to off.

## 8. Deezer integration

- Public API, no key required. Base: `https://api.deezer.com`.
- Fetch a track's data via `GET /track/{id}` for the `preview` field (30s
  MP3) — this URL is short-lived and must be fetched fresh every round,
  never cached/stored in data files or localStorage.
- Deezer does not send CORS headers, so browser calls must use JSONP
  (`?output=jsonp&callback=...`), constrained to a hardcoded path pattern
  (`track/\d+` only — never built from user input), with a random
  callback name, cleanup on resolve/error/timeout (~8s), and no dangling
  globals left behind.
- `preview` can be empty (rights-restricted track) — the game must
  tolerate this by skipping to the next song in the deterministic
  sequence and logging a console warning, not crashing.
- Build/curation scripts (not the live game) respect Deezer's rate limit
  (~50 requests/5s) with sleep + exponential backoff.

## 9. Security discipline (applies to every change, not just new features)

- Never use `innerHTML`/`insertAdjacentHTML`/string-built HTML for
  anything derived from Deezer data or user input — `textContent` /
  `createElement` only.
- No `eval` / `new Function` / string-driven property access anywhere.
- Every external URL used at runtime (album art, Deezer links, preview
  audio) must be scheme-and-hostname-checked (`https:` + an allow-listed
  hostname suffix) before use; on failure, omit the element rather than
  falling back to the raw string.
- Every `localStorage` read must be parsed defensively: try/catch,
  schema-version checked, type/range validated field by field. On any
  mismatch, discard and reset to sane defaults with a single
  `console.warn` — never throw, never leave the game unplayable.
- CSP stays strict and self-hosted-only; no `'unsafe-inline'`, no new
  external origins without a documented reason.
- Any code touching Deezer responses must validate the shape of what it
  uses (type-check every field touched, bound string lengths) before
  trusting it.

## 10. Testing expectations

- After any meaningful change: a full manual/automated playthrough
  (daily win, daily loss, unlimited, rush), a corrupted-localStorage
  test (garbage JSON, wrong schema version, malformed-but-valid-JSON
  shape) confirming graceful reset with no crash, and an
  offline/blocked-Deezer test confirming a retry UI with no unhandled
  rejection.
- Clean browser console is the bar — no CSP violations, no uncaught
  exceptions, only expected warnings from the tests above.
