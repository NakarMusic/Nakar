#!/usr/bin/env node
// build-decades.js — mechanically derive decade categories (y1980..y2020)
// from the existing genre category files (docs/SPEC.md §4/§5). No Deezer
// queries, no curation: every song with a valid `yil` in a source file is
// bucketed by decade and deduped by deezerId within that bucket.
//
// Excluded from scanning: gunun.json (already a cross-genre sample of the
// others — including it would just double-count), dizi-muzikleri.json
// (Dizi Müzikleri is a standalone category — its jenerikler must not also
// surface in a random decade round), turkiye-top-100.json and
// yeni-cikanlar.json (both "diger" categories, not part of the 6 "tur"
// genres that decades are derived from), any *.draft.json, and any existing
// y19xx/y20xx decade file (so re-running this script doesn't fold decade
// output back into itself).
//
// Security rules (docs/SECURITY.md §6): Node built-ins only, output
// confined to data/, every written field passes through the same schema
// used elsewhere (deezerId, baslik, sanatci, yil).

"use strict";

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.resolve(__dirname, "..", "data");
const DECADES = [1980, 1990, 2000, 2010, 2020];
const DECADE_NAMES = { 1980: "1980'ler", 1990: "1990'lar", 2000: "2000'ler", 2010: "2010'lar", 2020: "2020'ler" };
const EXCLUDED_SOURCE_FILES = new Set([
  "gunun.json",
  "categories.json",
  "dizi-muzikleri.json",
  "turkiye-top-100.json",
  "yeni-cikanlar.json",
]);

function isDecadeFile(filename) {
  return DECADES.some((d) => filename === `y${d}.json`);
}

function main() {
  const sourceFiles = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".draft.json"))
    .filter((f) => !EXCLUDED_SOURCE_FILES.has(f) && !isDecadeFile(f));

  console.log(`Scanning ${sourceFiles.length} source file(s): ${sourceFiles.join(", ")}`);

  const buckets = new Map(DECADES.map((d) => [d, new Map()])); // decade -> deezerId -> song
  let scanned = 0;
  let noYil = 0;
  let outOfRange = 0;

  for (const file of sourceFiles) {
    const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8"));
    for (const song of data.sarkilar) {
      scanned++;
      if (!Number.isInteger(song.yil)) {
        noYil++;
        continue;
      }
      const decade = Math.floor(song.yil / 10) * 10;
      const bucket = buckets.get(decade);
      if (!bucket) {
        outOfRange++;
        continue;
      }
      if (!bucket.has(song.deezerId)) {
        bucket.set(song.deezerId, { deezerId: song.deezerId, baslik: song.baslik, sanatci: song.sanatci, yil: song.yil });
      }
    }
  }

  console.log(`Songs scanned: ${scanned}, no yil (excluded): ${noYil}, outside 1980-2029 (excluded): ${outOfRange}`);

  const counts = {};
  for (const decade of DECADES) {
    const songs = [...buckets.get(decade).values()].sort((a, b) => a.yil - b.yil || a.sanatci.localeCompare(b.sanatci, "tr"));
    const out = { id: `y${decade}`, ad: DECADE_NAMES[decade], sarkilar: songs };
    const outPath = path.join(DATA_DIR, `y${decade}.json`);
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
    counts[decade] = songs.length;
    console.log(`  wrote data/y${decade}.json — ${songs.length} songs`);
  }

  return counts;
}

main();
