import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toPublicSnapshot, PUBLIC_SNAPSHOT_SCHEMA } from '../collector/lib/public-snapshot.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NOW = new Date('2026-11-04T03:00:00Z');

function sampleStatus() {
  return {
    schemaVersion: 1,
    generatedAt: '2026-11-04T02:59:30.000Z',
    dashboardUrl: 'https://example-host.example.ts.net:8990',
    alerts: [{ level: 'warning', text: 'Claude weekly at 91% in /Users/someone/Projects/x' }],
    menubar: { text: 'C 63%', tooltip: 'project secret-project', attention: false },
    providers: {
      claude: {
        ok: true,
        stale: false,
        lastSuccessAt: '2026-11-04T02:58:00.000Z',
        plan: 'max',
        model: 'claude-opus-5-5',
        contextWindow: 1000000,
        snapshotAt: null,
        error: null,
        authFailed: false,
        parseErrors: 0,
        source: 'oauth_api',
        hint: 'run claude in /Users/someone',
        extraUsage: { note: 'x' },
        credits: null,
        today: { input: 10, output: 20, byModel: { a: 1 } },
        weeklyModels: [{ model: 'Opus 5.5', tokens: 123 }],
        latestTurn: { model: 'claude-opus-5-5', outputTokens: 5 },
        windows: [
          { key: 'five_hour', label: '5-hour', utilization: 63, resetsAt: '2026-11-04T05:00:00Z', expired: false, resetsFriendly: 'at 5', resetsCountdown: 'in 2h' },
          { key: 'seven_day', label: 'Weekly', utilization: 40, resetsAt: '2026-11-06T05:59:00Z', expired: true },
          { key: 'seven_day_opus', label: 'Weekly Opus', utilization: 12, resetsAt: null, expired: false, suspect: true },
        ],
      },
      codex: {
        ok: true,
        stale: true,
        error: 'ENOENT /Users/someone/.codex/auth.json',
        source: 'local files with spaces',
        windows: [{ key: 'weekly', label: 'Weekly', utilization: 'NaN', resetsAt: 'not a date', windowMinutes: 10080, limitReached: true }],
      },
      'bad name/../x': { ok: true, windows: [] },
    },
  };
}

test('keeps only quota fields and drops anything that can carry paths, hosts or prompts', () => {
  const out = toPublicSnapshot(sampleStatus(), { now: NOW });
  const text = JSON.stringify(out);
  for (const leak of ['/Users/', 'ts.net', 'secret-project', 'auth.json', 'byModel', 'Opus 5.5', 'tooltip', 'alerts', 'dashboardUrl', 'hint', 'latestTurn', 'weeklyModels', 'today', 'extraUsage', 'model']) {
    assert.ok(!text.includes(leak), `snapshot must not contain ${leak}`);
  }
  assert.deepEqual(Object.keys(out).sort(), ['exportedAt', 'generatedAt', 'providers', 'publicSnapshotSchema', 'statusSchemaVersion']);
  assert.equal(out.publicSnapshotSchema, PUBLIC_SNAPSHOT_SCHEMA);
  assert.equal(out.exportedAt, NOW.toISOString());
  assert.deepEqual(Object.keys(out.providers).sort(), ['claude', 'codex']);
  assert.deepEqual(Object.keys(out.providers.claude).sort(), ['authFailed', 'lastSuccessAt', 'ok', 'plan', 'source', 'stale', 'windows']);
});

test('does not copy arbitrary labels, plan names, source IDs or provider names', () => {
  const input = sampleStatus();
  input.providers.claude.plan = 'private-team';
  input.providers.claude.source = 'secret_source';
  input.providers.claude.windows[0].label = 'private-label';
  input.providers.claude.windows.push({ key: 'private-window', label: 'private-label', utilization: 4 });
  input.providers.confidential_project = { ok: true };
  const out = toPublicSnapshot(input, { now: NOW });
  assert.doesNotMatch(JSON.stringify(out), /private-|secret_source|confidential_project/);
  assert.equal(out.providers.claude.windows[0].label, '5-hour');
  assert.equal(out.providers.claude.windows.at(-1).utilization, 4);
  assert.equal(out.providers.claude.windows.at(-1).label, null);
});

test('marks a window current only when it is a real, fresh reading', () => {
  const { claude, codex } = toPublicSnapshot(sampleStatus(), { now: NOW }).providers;
  assert.deepEqual(claude.windows.map((w) => w.current), [true, false, false]);
  assert.equal(claude.windows[0].utilization, 63);
  assert.equal(claude.windows[0].resetsAt, '2026-11-04T05:00:00.000Z');
  assert.equal(claude.windows[1].expired, true);
  assert.equal(claude.windows[2].suspect, true);
  assert.equal(claude.windows[2].resetsAt, null);
  // A stale provider is never current, and bad values are not invented into numbers or times.
  assert.equal(codex.windows[0].current, false);
  assert.equal(codex.windows[0].utilization, null);
  assert.equal(codex.windows[0].resetsAt, null);
  assert.equal(codex.windows[0].windowMinutes, 10080);
  assert.equal(codex.windows[0].limitReached, true);
  assert.equal(codex.source, null);
});

test('handles missing or malformed input without throwing', () => {
  for (const input of [null, undefined, {}, { providers: null }, { providers: { claude: null } }]) {
    const out = toPublicSnapshot(input, { now: NOW });
    assert.equal(out.generatedAt, null);
    assert.equal(typeof out.providers, 'object');
  }
  assert.deepEqual(toPublicSnapshot({ providers: { claude: null } }, { now: NOW }).providers.claude.windows, []);
});

test('export script reads one file and writes the snapshot', () => {
  const dir = mkdtempSync(join(tmpdir(), 'public-snapshot-'));
  try {
    const inPath = join(dir, 'status.json');
    const outPath = join(dir, 'out', 'status.json');
    writeFileSync(inPath, JSON.stringify(sampleStatus()));
    const run = spawnSync(process.execPath, [join(ROOT, 'scripts/export-public-snapshot.mjs'), '--in', inPath, '--out', outPath], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const written = JSON.parse(readFileSync(outPath, 'utf8'));
    assert.equal(written.providers.claude.windows[0].utilization, 63);
    assert.ok(!JSON.stringify(written).includes('/Users/'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a frozen status.json exported later is never current, nor is a window whose reset has passed', () => {
  const old = { ...sampleStatus(), generatedAt: '2026-11-02T03:00:00.000Z' }; // two days before NOW
  const out = toPublicSnapshot(old, { now: NOW });
  for (const p of Object.values(out.providers)) for (const w of p.windows) assert.equal(w.current, false);
  const noTime = { ...sampleStatus(), generatedAt: null };
  assert.equal(toPublicSnapshot(noTime, { now: NOW }).providers.claude.windows[0].current, false);
  // Fresh status, but the 5-hour window reset at 05:00 and it is now 06:00: not current.
  const later = toPublicSnapshot({ ...sampleStatus(), generatedAt: '2026-11-04T05:59:00Z' }, { now: new Date('2026-11-04T06:00:00Z') });
  assert.equal(later.providers.claude.windows[0].current, false);
});
