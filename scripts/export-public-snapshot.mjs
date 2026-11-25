#!/usr/bin/env node
// Writes a quota-only copy of data/status.json for hosting off the Mac.
//
// Nothing runs this automatically, and it makes no network calls. It reads one
// local file and writes one local file (default under build/, which git ignores).
// What it keeps and drops: collector/lib/public-snapshot.js.
//
// Usage:
//   node scripts/export-public-snapshot.mjs [--in data/status.json] [--out build/public-snapshot/status.json]

import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toPublicSnapshot } from '../collector/lib/public-snapshot.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const inPath = resolve(root, arg('--in', 'data/status.json'));
const outPath = resolve(root, arg('--out', 'build/public-snapshot/status.json'));

let status;
try {
  status = JSON.parse(readFileSync(inPath, 'utf8'));
} catch (err) {
  console.error(`Could not read ${inPath}: ${err.code || err.message}`);
  process.exit(1);
}

const snapshot = toPublicSnapshot(status);
mkdirSync(dirname(outPath), { recursive: true });
const tmp = `${outPath}.tmp-${process.pid}`;
writeFileSync(tmp, JSON.stringify(snapshot, null, 2) + '\n');
renameSync(tmp, outPath);

const windows = Object.values(snapshot.providers).reduce((n, p) => n + p.windows.length, 0);
console.log(`Wrote ${outPath} (${Object.keys(snapshot.providers).length} providers, ${windows} windows).`);
