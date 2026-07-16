#!/usr/bin/env node
// build-playlist.js — gather game-ready song candidates from the Deezer API
// and write a curation draft to data/<category>.draft.json.
//
// Usage:
//   node tools/build-playlist.js --category 90lar-pop --name "90'lar Türk Pop" \
//     --artist "Tarkan" --artist "Sertab Erener" --search "90lar türkçe pop" --target 80
//
// The draft is NOT the final category file: a curator reviews the list and the
// approved version is saved as data/<category>.json (see the playlist-builder
// skill). Drafts are gitignored.
//
// Security rules (docs/SECURITY.md §6): Node built-ins only, output confined
// to data/, every Deezer response shape-validated, strings sanitized.

"use strict";

const fs = require("fs");
const path = require("path");
const { parseArgs } = require("util");

const API_BASE = "https://api.deezer.com";
const DATA_DIR = path.resolve(__dirname, "..", "data");
const REQUEST_GAP_MS = 150;
const REQUEST_TIMEOUT_MS = 10000;
const MAX_RETRIES = 5;
const MAX_STRING = 200;
const LOW_RANK = 100000;
const ARTIST_SHARE_CAP = 0.2;

// Titles that are alternate versions, not the canonical song (docs/DEEZER-API.md).
// Tested against the accent-normalized title, so "canlı" matches "canli".
const VERSION_WORDS = /\b(live|canli|karaoke|cover|remix|akustik|versiyon|version|instrumental|remaster(ed)?|edit|mix)\b/;
const CONTROL_CHARS = /[\x00-\x1F\x7F-\x9F]/g;

// ---------------------------------------------------------------- utilities

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Accent- and case-insensitive normalization (SPEC §2).
function normalize(s) {
  return s
    .toLocaleLowerCase("tr")
    .replace(/ş/g, "s").replace(/ı/g, "i").replace(/ğ/g, "g")
    .replace(/ö/g, "o").replace(/ü/g, "u").replace(/ç/g, "c")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitize(s) {
  return s.replace(CONTROL_CHARS, "").replace(/\s+/g, " ").trim().slice(0, MAX_STRING);
}

// Edit distance between two strings (used to catch near-duplicate titles that
// slip past exact-key dedup — see isNearDuplicateTitle below).
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// Deezer's Turkish catalog carries the same song under near-identical
// transliteration variants ("Fesuphanallah"/"Fesupanallah", "Dinleyiverin
// Gari"/"Gayri", "İkimiz(i) Bir Fidanın/Fidanız") that differ by only one or
// two characters — normalize() alone doesn't collapse these, so they dodge
// the exact-key dedup above. Treat same-artist titles within a small edit
// distance as the same song.
function isNearDuplicateTitle(a, b) {
  if (a === b) return true;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen < 6) return false; // too short to fuzzy-match without false positives
  const dist = levenshtein(a, b);
  return dist <= 2 && dist / maxLen <= 0.2;
}

// Strip version-noise parentheticals/suffixes from a display title while
// keeping meaningful ones ("Şımarık (Kiss Kiss)" is left for the curator).
function cleanTitle(title) {
  let t = sanitize(title);
  const noise = /^\s*[-–—]?\s*[([]?[^()[\]]*\b(remaster(ed)?|radio edit|single version|album version|mono|stereo|deluxe|yeni versiyon|new version)\b[^()[\]]*[)\]]?\s*$/i;
  // repeatedly drop trailing " (…)" / " [-–] …" chunks that are pure version noise
  for (;;) {
    const m = t.match(/\s+([([][^()[\]]*[)\]]|[-–—][^-–—]*)$/);
    if (!m || !noise.test(m[1])) break;
    t = t.slice(0, t.length - m[0].length).trim();
  }
  return t;
}

// ------------------------------------------------------------- Deezer fetch

// Shape checks per docs/SECURITY.md §4: type-check every field we touch,
// bound string lengths, whitelist URL schemes.
function isValidTrack(t) {
  return t && typeof t === "object" &&
    Number.isInteger(t.id) && t.id > 0 &&
    typeof t.title === "string" && t.title.length > 0 && t.title.length < 300 &&
    typeof t.preview === "string" &&
    (t.preview === "" || t.preview.startsWith("https://")) &&
    t.artist && typeof t.artist === "object" &&
    typeof t.artist.name === "string" && t.artist.name.length > 0 && t.artist.name.length < 300;
}

function isValidArtist(a) {
  return a && typeof a === "object" &&
    Number.isInteger(a.id) && a.id > 0 &&
    typeof a.name === "string" && a.name.length > 0 && a.name.length < 300;
}

let requestCount = 0;

async function deezerGet(pathAndQuery) {
  const url = `${API_BASE}/${pathAndQuery}`;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await sleep(attempt === 0 ? REQUEST_GAP_MS : 1000 * 2 ** (attempt - 1));
    requestCount++;
    let res, body;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      body = await res.json();
    } catch (e) {
      if (attempt === MAX_RETRIES) throw new Error(`Deezer unreachable (${url}): ${e.message}`);
      continue;
    }
    if (body && typeof body === "object" && body.error) {
      if (body.error.code === 4) continue; // quota — exponential backoff via loop
      throw new Error(`Deezer error ${body.error.code} on ${url}: ${body.error.message}`);
    }
    if (body === null || typeof body !== "object") {
      throw new Error(`Unexpected Deezer response shape on ${url}`);
    }
    return body;
  }
  throw new Error(`Deezer quota limit persisted after ${MAX_RETRIES} retries (${url})`);
}

// Fetch a list endpoint, following `next` pagination up to maxItems.
async function deezerList(firstPath, maxItems) {
  const items = [];
  let url = `${API_BASE}/${firstPath}`;
  while (url && items.length < maxItems) {
    const rel = url.startsWith(API_BASE + "/") ? url.slice(API_BASE.length + 1) : null;
    if (rel === null) break; // refuse to follow pagination off api.deezer.com
    const page = await deezerGet(rel);
    if (!Array.isArray(page.data)) break;
    items.push(...page.data);
    url = typeof page.next === "string" ? page.next : null;
  }
  return items.slice(0, maxItems);
}

// ------------------------------------------------------------------ gather

async function gatherFromArtist(query) {
  const found = await deezerGet(`search/artist?q=${encodeURIComponent(query)}&limit=1`);
  const artist = Array.isArray(found.data) ? found.data[0] : null;
  if (!isValidArtist(artist)) {
    console.warn(`  ! artist not found on Deezer: "${query}" — skipped`);
    return [];
  }
  if (normalize(artist.name) !== normalize(query)) {
    console.warn(`  ! "${query}" resolved to "${artist.name}" (id ${artist.id}) — verify during curation`);
  }
  const tracks = await deezerList(`artist/${artist.id}/top?limit=50`, 50);
  // Top lists include collaborations credited to other main artists; those
  // drag in off-category material, so keep only tracks credited to the artist.
  const own = tracks.filter((t) => isValidTrack(t) && normalize(t.artist.name) === normalize(artist.name));
  console.log(`  artist "${artist.name}": ${own.length} own tracks (of ${tracks.length} top)`);
  return own.map((t) => ({ track: t, kaynak: `artist:${artist.name}` }));
}

async function gatherFromSearch(query) {
  const tracks = await deezerList(`search/track?q=${encodeURIComponent(query)}&limit=50`, 100);
  console.log(`  search "${query}": ${tracks.length} tracks`);
  return tracks.map((t) => ({ track: t, kaynak: `search:${query}` }));
}

// ------------------------------------------------------------------- main

async function main() {
  const { values } = parseArgs({
    options: {
      category: { type: "string" },
      name: { type: "string" },
      artist: { type: "string", multiple: true },
      search: { type: "string", multiple: true },
      target: { type: "string", default: "80" },
      years: { type: "string" }, // e.g. "1988-2003": flag (not drop) tracks outside the era
    },
  });

  const category = values.category;
  const name = values.name;
  const artists = values.artist ?? [];
  const searches = values.search ?? [];
  const target = Number.parseInt(values.target, 10);

  if (!category || !/^[a-z0-9-]+$/.test(category)) {
    fail('--category is required and must match ^[a-z0-9-]+$ (e.g. "90lar-pop")');
  }
  if (!name) fail("--name is required (display name, e.g. \"90'lar Türk Pop\")");
  if (artists.length === 0 && searches.length === 0) fail("give at least one --artist or --search");
  if (!Number.isInteger(target) || target < 1 || target > 500) fail("--target must be an integer between 1 and 500");

  let yearRange = null;
  if (values.years) {
    const m = values.years.match(/^(\d{4})-(\d{4})$/);
    if (!m) fail('--years must look like "1988-2003"');
    yearRange = [Number(m[1]), Number(m[2])];
  }

  // Output confinement (SECURITY.md §6): resolve and prefix-check.
  const outPath = path.resolve(DATA_DIR, `${category}.draft.json`);
  if (!outPath.startsWith(DATA_DIR + path.sep)) fail(`output path escapes data/: ${outPath}`);
  if (!fs.existsSync(DATA_DIR)) fail(`data directory not found: ${DATA_DIR}`);

  // 1. Gather ---------------------------------------------------------------
  console.log(`Gathering candidates for "${category}" (target ${target})...`);
  const rawCandidates = [];
  for (const a of artists) rawCandidates.push(...(await gatherFromArtist(a)));
  for (const s of searches) rawCandidates.push(...(await gatherFromSearch(s)));

  // 2. Filter ---------------------------------------------------------------
  const dropped = { invalid: 0, noPreview: 0, version: 0, duplicate: 0, nearDuplicate: 0 };
  const byKey = new Map(); // normalized "artist|title" -> best candidate

  for (const { track, kaynak } of rawCandidates) {
    if (!isValidTrack(track)) { dropped.invalid++; continue; }
    if (track.preview === "") { dropped.noPreview++; continue; }

    const rawTitle = typeof track.title_short === "string" && track.title_short.length > 0
      ? track.title_short : track.title;
    const title = cleanTitle(rawTitle);
    if (title.length === 0) { dropped.invalid++; continue; }
    if (VERSION_WORDS.test(normalize(track.title))) { dropped.version++; continue; }

    const rank = Number.isInteger(track.rank) ? track.rank : 0;
    const key = `${normalize(track.artist.name)}|${normalize(title)}`;
    const existing = byKey.get(key);
    if (existing) {
      dropped.duplicate++;
      if (rank <= existing.rank) continue;
    }
    byKey.set(key, {
      deezerId: track.id,
      baslik: title,
      sanatci: sanitize(track.artist.name),
      rank,
      kaynak,
      explicit: track.explicit_lyrics === true,
    });
  }

  // 3. Select: round-robin across artists (rank-ordered within each) so no
  //    single artist floods the list before curation.
  const byArtist = new Map();
  for (const c of byKey.values()) {
    const k = normalize(c.sanatci);
    if (!byArtist.has(k)) byArtist.set(k, []);
    byArtist.get(k).push(c);
  }
  for (const [k, list] of byArtist) {
    list.sort((a, b) => b.rank - a.rank);
    const deduped = [];
    for (const c of list) {
      const isDup = deduped.some((kept) => isNearDuplicateTitle(normalize(kept.baslik), normalize(c.baslik)));
      if (isDup) { dropped.nearDuplicate++; continue; }
      deduped.push(c);
    }
    byArtist.set(k, deduped);
  }

  const selected = [];
  const queues = [...byArtist.values()];
  while (selected.length < target && queues.some((q) => q.length > 0)) {
    for (const q of queues) {
      if (selected.length >= target) break;
      const c = q.shift();
      if (c) selected.push(c);
    }
  }

  if (selected.length === 0) fail("no usable candidates survived filtering — nothing to write");

  // 4. Enrich: release year + preview re-check via GET /track/{id} ----------
  console.log(`Enriching ${selected.length} candidates with release year...`);
  const songs = [];
  for (const c of selected) {
    let detail;
    try {
      detail = await deezerGet(`track/${c.deezerId}`);
    } catch (e) {
      console.warn(`  ! track ${c.deezerId} (${c.sanatci} — ${c.baslik}): ${e.message} — dropped`);
      continue;
    }
    if (!isValidTrack(detail) || detail.preview === "") {
      console.warn(`  ! track ${c.deezerId} (${c.sanatci} — ${c.baslik}): preview unavailable — dropped`);
      continue;
    }
    const song = {
      deezerId: c.deezerId,
      baslik: c.baslik,
      sanatci: c.sanatci,
      rank: c.rank,
      flags: [],
      kaynak: c.kaynak,
    };
    if (typeof detail.release_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(detail.release_date)) {
      const y = Number.parseInt(detail.release_date.slice(0, 4), 10);
      if (y >= 1900 && y <= new Date().getFullYear()) song.yil = y;
    }
    if (c.rank < LOW_RANK) song.flags.push("low-popularity");
    if (c.explicit || detail.explicit_lyrics === true) song.flags.push("explicit");
    if (yearRange && song.yil !== undefined && (song.yil < yearRange[0] || song.yil > yearRange[1])) {
      song.flags.push("out-of-era");
    }
    songs.push(song);
  }

  if (songs.length === 0) fail("all candidates lost their preview during enrichment — nothing to write");

  // 5. Write draft ----------------------------------------------------------
  const draft = { id: category, ad: sanitize(name), sarkilar: songs };
  fs.writeFileSync(outPath, JSON.stringify(draft, null, 2) + "\n", "utf8");

  // 6. Summary --------------------------------------------------------------
  console.log(`\nDraft written: ${path.relative(process.cwd(), outPath)}`);
  console.log(`Deezer requests: ${requestCount}`);
  console.log(`Candidates: ${rawCandidates.length} gathered, dropped ${dropped.invalid} invalid, ` +
    `${dropped.noPreview} no-preview, ${dropped.version} alt-version, ${dropped.duplicate} duplicate, ` +
    `${dropped.nearDuplicate} near-duplicate (transliteration variant)`);
  console.log(`Final: ${songs.length} songs`);
  if (songs.length < 60) {
    console.warn(`WARNING: below 60 songs — daily mode will repeat within ~2 months`);
  }

  const counts = new Map();
  for (const s of songs) counts.set(s.sanatci, (counts.get(s.sanatci) ?? 0) + 1);
  const capped = Math.ceil(songs.length * ARTIST_SHARE_CAP);
  for (const [artist, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    const flag = n > capped ? `  <-- exceeds ${ARTIST_SHARE_CAP * 100}% cap` : "";
    console.log(`  ${String(n).padStart(3)}  ${artist}${flag}`);
  }
  console.log(`\nNext: curator review, then save the approved list as data/${category}.json`);
}

main().catch((e) => fail(e.message));
