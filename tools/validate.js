#!/usr/bin/env node
// validate.js — schema check for category JSONs (docs/SPEC.md §5).
//
// Usage:
//   node tools/validate.js              # validate data/*.json (drafts skipped)
//   node tools/validate.js <file...>    # validate specific files (drafts allowed)
//
// Exit code: 0 = all valid, 1 = any error. Warnings do not affect the exit code.

"use strict";

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.resolve(__dirname, "..", "data");
const MAX_STRING = 200;
const MIN_SONGS_WARN = 60; // daily mode repeats too soon below this
const CURRENT_YEAR = new Date().getFullYear();

// no control characters (C0 + DEL + C1)
const CONTROL_CHARS = /[\x00-\x1F\x7F-\x9F]/;

// Keys that must never be persisted (preview URLs are short-lived tokens,
// and we never store URLs of any kind — docs/DEEZER-API.md).
const FORBIDDEN_SONG_KEYS = ["preview", "url", "link", "cover", "album", "md5_image"];
const ALLOWED_SONG_KEYS = new Set(["deezerId", "baslik", "sanatci", "yil"]);
// Drafts may carry curation metadata on top of the schema.
const DRAFT_EXTRA_KEYS = new Set(["rank", "flags", "kaynak"]);

let errorCount = 0;
let warnCount = 0;

function err(file, msg) {
  errorCount++;
  console.error(`ERROR  ${file}: ${msg}`);
}

function warn(file, msg) {
  warnCount++;
  console.warn(`warn   ${file}: ${msg}`);
}

function isCleanString(s) {
  return typeof s === "string" && !CONTROL_CHARS.test(s);
}

function validateSong(file, song, index, isDraft, seenIds) {
  const label = `sarkilar[${index}]`;
  if (song === null || typeof song !== "object" || Array.isArray(song)) {
    err(file, `${label} is not an object`);
    return;
  }

  for (const key of Object.keys(song)) {
    if (FORBIDDEN_SONG_KEYS.includes(key)) {
      err(file, `${label} contains forbidden key "${key}" (URLs/previews must never be persisted)`);
    } else if (!ALLOWED_SONG_KEYS.has(key) && !(isDraft && DRAFT_EXTRA_KEYS.has(key))) {
      err(file, `${label} contains unknown key "${key}"`);
    }
  }

  if (!Number.isInteger(song.deezerId) || song.deezerId <= 0) {
    err(file, `${label}.deezerId must be a positive integer (got ${JSON.stringify(song.deezerId)})`);
  } else if (seenIds.has(song.deezerId)) {
    err(file, `${label}.deezerId ${song.deezerId} is a duplicate (first seen at sarkilar[${seenIds.get(song.deezerId)}])`);
  } else {
    seenIds.set(song.deezerId, index);
  }

  for (const field of ["baslik", "sanatci"]) {
    const v = song[field];
    if (typeof v !== "string" || v.trim().length === 0) {
      err(file, `${label}.${field} must be a non-empty string`);
    } else if (v.length > MAX_STRING) {
      err(file, `${label}.${field} exceeds ${MAX_STRING} characters (${v.length})`);
    } else if (!isCleanString(v)) {
      err(file, `${label}.${field} contains control characters`);
    }
  }

  if ("yil" in song && song.yil !== null) {
    if (!Number.isInteger(song.yil) || song.yil < 1900 || song.yil > CURRENT_YEAR) {
      err(file, `${label}.yil must be an integer between 1900 and ${CURRENT_YEAR} (got ${JSON.stringify(song.yil)})`);
    }
  }
}

function validateCategoryFile(filePath) {
  const file = path.relative(process.cwd(), filePath);
  const isDraft = filePath.endsWith(".draft.json");

  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (e) {
    err(file, `cannot read file: ${e.message}`);
    return;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    err(file, `invalid JSON: ${e.message}`);
    return;
  }

  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    err(file, "top level must be an object");
    return;
  }

  if (typeof data.id !== "string" || !/^[a-z0-9-]+$/.test(data.id)) {
    err(file, `id must be a lowercase kebab-case string (got ${JSON.stringify(data.id)})`);
  } else {
    const expected = isDraft ? `${data.id}.draft.json` : `${data.id}.json`;
    if (path.basename(filePath) !== expected) {
      err(file, `id "${data.id}" does not match filename (expected ${expected})`);
    }
  }

  if (typeof data.ad !== "string" || data.ad.trim().length === 0 || data.ad.length > MAX_STRING || !isCleanString(data.ad)) {
    err(file, "ad must be a clean, non-empty string");
  }

  if (!Array.isArray(data.sarkilar)) {
    err(file, "sarkilar must be an array");
    return;
  }
  if (data.sarkilar.length === 0) {
    err(file, "sarkilar is empty");
    return;
  }
  if (data.sarkilar.length < MIN_SONGS_WARN) {
    warn(file, `only ${data.sarkilar.length} songs — below ${MIN_SONGS_WARN}, daily mode will repeat within ~2 months`);
  }

  const seenIds = new Map();
  data.sarkilar.forEach((song, i) => validateSong(file, song, i, isDraft, seenIds));
}

function validateCategoriesIndex(filePath) {
  const file = path.relative(process.cwd(), filePath);

  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) {
    err(file, `invalid JSON: ${e.message}`);
    return;
  }

  if (!Array.isArray(data)) {
    err(file, "categories.json must be an array of { id, ad } entries");
    return;
  }

  const seen = new Set();
  data.forEach((entry, i) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      err(file, `[${i}] is not an object`);
      return;
    }
    if (typeof entry.id !== "string" || !/^[a-z0-9-]+$/.test(entry.id)) {
      err(file, `[${i}].id must be a lowercase kebab-case string`);
      return;
    }
    if (seen.has(entry.id)) {
      err(file, `[${i}].id "${entry.id}" is duplicated`);
    }
    seen.add(entry.id);
    if (typeof entry.ad !== "string" || entry.ad.trim().length === 0 || !isCleanString(entry.ad)) {
      err(file, `[${i}].ad must be a clean, non-empty string`);
    }
    if (!fs.existsSync(path.join(DATA_DIR, `${entry.id}.json`))) {
      err(file, `[${i}] "${entry.id}" has no data/${entry.id}.json`);
    }
  });
}

function main() {
  const args = process.argv.slice(2);
  let files;

  if (args.length > 0) {
    files = args.map((a) => path.resolve(a));
  } else {
    if (!fs.existsSync(DATA_DIR)) {
      console.error(`ERROR  data directory not found: ${DATA_DIR}`);
      process.exit(1);
    }
    files = fs
      .readdirSync(DATA_DIR)
      .filter((f) => f.endsWith(".json") && !f.endsWith(".draft.json"))
      .map((f) => path.join(DATA_DIR, f));
    if (files.length === 0) {
      console.log("No JSON files in data/ yet — nothing to validate.");
      process.exit(0);
    }
  }

  for (const f of files) {
    if (path.basename(f) === "categories.json") {
      validateCategoriesIndex(f);
    } else {
      validateCategoryFile(f);
    }
  }

  const checked = files.map((f) => path.basename(f)).join(", ");
  if (errorCount > 0) {
    console.error(`\nFAIL — ${errorCount} error(s), ${warnCount} warning(s) in: ${checked}`);
    process.exit(1);
  }
  console.log(`OK — ${files.length} file(s) valid (${warnCount} warning(s)): ${checked}`);
}

main();
