// @ts-check
/**
 * Builds a quota-only copy of status.json that is safe to leave the Mac.
 *
 * Nothing in the running collector imports this module: it exists so a hosted
 * page can read a small file with quota fields.
 *
 * Rules:
 * - Allowlist, never blocklist. Only the provider and window fields named below
 *   are copied. Error text, hints, alerts, the dashboard URL, the menu-bar
 *   tooltip, token counts, per-model lists and latest-turn details are dropped,
 *   because they can carry file paths, host names, project names or prompts.
 * - Text values are chosen from known provider, plan, source and window names.
 *   Unknown window names stay anonymous, even if their numeric readings are usable.
 * - Numbers are copied only when finite; anything else becomes null. Nothing is
 *   invented: a missing percentage or reset time stays null.
 * - Each window gets `current`: true only when its percentage is a real number,
 *   the window is not expired or suspect, its reset time has not passed, its
 *   provider is ok and not stale, AND status.json itself was generated within
 *   `maxAgeMs` (default 15 minutes) of the export. A frozen status.json exported
 *   later is therefore never shown as current. A reader must treat
 *   `current: false` as unknown, not as headroom.
 */

export const PUBLIC_SNAPSHOT_SCHEMA = 1;
export const DEFAULT_MAX_AGE_MS = 15 * 60 * 1000;

const PROVIDERS = new Set(['claude', 'codex', 'antigravity', 'copilot', 'gemini']);
const PLANS = new Set(['free', 'pro', 'pro+', 'max', 'plus', 'team', 'business', 'enterprise', 'ultra']);
const SOURCES = new Set([
  'oauth_api', 'statusline_file', 'codex_rollout', 'agy_cli', 'claude_transcript',
  'github_billing_api', 'local_rpc', 'quota_api', 'state_vscdb',
]);
const WINDOWS = new Map([
  ['five_hour', '5-hour'], ['seven_day', 'Weekly'], ['weekly', 'Weekly'], ['daily', 'Daily'],
  ['seven_day_opus', 'Weekly Opus'], ['seven_day_sonnet', 'Weekly Sonnet'],
  ['seven_day_fable', 'Weekly Fable'], ['seven_day_fable_5', 'Weekly Fable 5'],
  ['primary', 'Primary'], ['secondary', 'Secondary'],
  ['monthly_credits', 'Monthly credits'], ['spark', 'Spark'],
  ['codex_spark', 'Spark'], ['gpt_5_3_codex_spark', 'Spark'],
  ['weekly_spark', 'Weekly Spark'], ['spark_weekly', 'Weekly Spark'],
  ['gemini_bucket', 'Gemini 5-hour'], ['gemini_weekly_bucket', 'Gemini weekly'],
  ['claude_gpt_bucket', 'Claude and GPT 5-hour'], ['claude_gpt_weekly_bucket', 'Claude and GPT weekly'],
]);
/** @param {unknown} v */
function finiteOrNull(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** @param {unknown} v */
function isoOrNull(v) {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/**
 * @param {any} win
 * @param {{ok: boolean, stale: boolean}} provider
 * @param {{fresh: boolean, nowMs: number}} ctx
 */
function publicWindow(win, provider, ctx) {
  const utilization = finiteOrNull(win?.utilization);
  const expired = win?.expired === true;
  const suspect = win?.suspect === true;
  const resetsAt = isoOrNull(win?.resetsAt);
  const resetPassed = resetsAt !== null && Date.parse(resetsAt) <= ctx.nowMs;
  /** @type {Record<string, unknown>} */
  const out = {
    key: WINDOWS.has(win?.key) ? win.key : null,
    label: WINDOWS.get(win?.key) ?? null,
    utilization,
    resetsAt,
    expired,
    suspect,
    current: utilization !== null && !expired && !suspect && !resetPassed
      && provider.ok && !provider.stale && ctx.fresh,
  };
  const minutes = finiteOrNull(win?.windowMinutes);
  if (minutes !== null) out.windowMinutes = minutes;
  if (win?.limitReached === true) out.limitReached = true;
  return out;
}

/**
 * @param {any} p
 * @param {{fresh: boolean, nowMs: number}} ctx
 */
function publicProvider(p, ctx) {
  const ok = p?.ok === true;
  const stale = p?.stale === true;
  const source = SOURCES.has(p?.source) ? p.source : null;
  return {
    ok,
    stale,
    authFailed: p?.authFailed === true,
    lastSuccessAt: isoOrNull(p?.lastSuccessAt),
    plan: PLANS.has(p?.plan) ? p.plan : null,
    source,
    windows: Array.isArray(p?.windows) ? p.windows.map((w) => publicWindow(w, { ok, stale }, ctx)) : [],
  };
}

/**
 * @param {any} status Parsed collector status
 * @param {{now?: Date, maxAgeMs?: number}} [opts]
 */
export function toPublicSnapshot(status, opts = {}) {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const maxAgeMs = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const generatedAt = isoOrNull(status?.generatedAt);
  // status.json older than maxAgeMs (or with no time at all) is not current,
  // however its own ok/stale flags read: they were computed back then.
  const ageMs = generatedAt === null ? Infinity : nowMs - Date.parse(generatedAt);
  const fresh = ageMs >= 0 && ageMs <= maxAgeMs;
  const ctx = { fresh, nowMs };
  /** @type {Record<string, ReturnType<typeof publicProvider>>} */
  const providers = {};
  const src = status && typeof status.providers === 'object' && status.providers ? status.providers : {};
  for (const name of Object.keys(src)) {
    // Provider names are short ids (claude, codex, antigravity, gemini).
    if (!PROVIDERS.has(name)) continue;
    providers[name] = publicProvider(src[name], ctx);
  }
  return {
    publicSnapshotSchema: PUBLIC_SNAPSHOT_SCHEMA,
    statusSchemaVersion: finiteOrNull(status?.schemaVersion),
    generatedAt,
    exportedAt: now.toISOString(),
    providers,
  };
}
