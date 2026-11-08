// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-015 · 去重契约：常量、Canonical ID / 版本 / 周期键校验、组合指纹与日期工具。
 *
 * 规格口径：FR-015（最近 7 天「主菜+主食」不重复）、FR-016（周内主标识互斥、
 * 近 4 周重合 ≤ 2 道）、FR-017（节气 / 月份 / 年度周期性重复不得豁免短期窗口）、
 * FR-018（台账登记字段 + 只追加）、AC-07 / AC-08、SC-004、E-05、§9 不变式 5。
 *
 * 内部只有 ASCII Canonical ID（P-11 / FR-041 / plan.md §5.4）；窗口长度是
 * **不可注入的常量**，避免调用方以参数方式放宽护栏。日期运算只用 ECMA-262 Date。
 */
import { VERSION_KEYS } from '../profile/versions.js';
import { DEDUP_ERROR, DedupError, dedupIssue } from './errors.js';

export const HISTORY_PATH = 'history.md';
export const SHORT_TERM_DAYS = 7;
export const LOOKBACK_WEEKS = 4;
export const WEEK_DAYS = 7;
export const MAX_WEEK_OVERLAP = 2;

export const DEDUP_STATUS = Object.freeze({
  ACCEPTED: 'accepted',
  REPLACED: 'replaced',
  BLOCKED: 'blocked',
});

/** 命中的去重规则 Canonical ID。 */
export const DEDUP_RULE = Object.freeze({
  SHORT_TERM_COMBO: 'dedup.rule.short_term_combo',
  WEEK_MAIN_DUPLICATE: 'dedup.rule.week_main_duplicate',
  WEEK_OVERLAP: 'dedup.rule.week_overlap',
});

/** 面向上层的结构化原因键；自然语言渲染归 T-018 / T-031（P-11）。 */
export const DEDUP_REASON = Object.freeze({
  SHORT_TERM_COMBO: 'dedup.reason.short_term_combo',
  WEEK_MAIN_DUPLICATE: 'dedup.reason.week_main_duplicate',
  WEEK_OVERLAP: 'dedup.reason.week_overlap',
  REPLACEMENT: 'dedup.reason.replacement',
  OVERRIDE_WEEK_PLAN: 'dedup.reason.override_week_plan',
  NO_ALTERNATIVE: 'dedup.reason.no_alternative',
  PERIODIC_REUSE: 'dedup.reason.periodic_reuse',
});

export const LEDGER_COLUMNS = Object.freeze([
  'date', 'level', 'period_id', 'main_id', 'staple_id',
  'combo_fp', 'version_ids', 'cycle_key', 'source',
]);

const CANDIDATE_KEYS = Object.freeze([
  'date', 'level', 'period_id', 'main_id', 'staple_id', 'version_ids',
  'cycle_key', 'source', 'alternatives',
]);
const REQUIRED_CANDIDATE_KEYS = Object.freeze(CANDIDATE_KEYS.slice(0, 6));
const WINDOW_KEYS = Object.freeze(['run_date']);
const SOURCES = Object.freeze(['daily', 'week_plan', 'user']);
const LEVELS = Object.freeze(['day', 'week']);

const CANONICAL_ID = /^[a-z][a-z0-9._-]{0,63}$/;
const VERSION_ID = /^[A-Za-z0-9._-]{1,64}$/;
const PERIOD_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CYCLE_KEY = /^(term|month|year)\.[a-z0-9._-]{1,32}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const FINGERPRINT = /^fp-[0-9a-f]{8}$/;

/** @param {unknown} value */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {Array<import('./errors.js').DedupIssue>} issues */
function fail(issues) {
  if (issues.length > 0) throw new DedupError(issues);
}

/** @param {unknown} value */
export function isIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** @param {string} iso @param {number} days */
export function addDays(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** @param {string} iso @returns {string} 所在 ISO 周的周一 */
export function mondayOf(iso) {
  const index = (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(iso, -index);
}

/** @param {unknown} value */
function isCanonicalId(value) {
  return typeof value === 'string' && CANONICAL_ID.test(value);
}

/**
 * 组合指纹：只由主菜 / 主食两个 Canonical ID 决定，语言切换后哈希不变
 * （FR-044 / NFR-011）。纯 JS FNV-1a，零 node:crypto 依赖（NFR-004）。
 * @param {unknown} mainId @param {unknown} stapleId
 */
export function comboFingerprint(mainId, stapleId) {
  if (!isCanonicalId(mainId) || !isCanonicalId(stapleId)) {
    throw new DedupError([
      dedupIssue(DEDUP_ERROR.ID, '(fingerprint)', 'action.dedup.canonical_id'),
    ]);
  }
  const text = `${mainId}|${stapleId}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fp-${hash.toString(16).padStart(8, '0')}`;
}

/** @param {unknown} value */
function validateVersionIds(value, problems, field = 'version_ids') {
  if (!isRecord(value)) {
    problems.push(dedupIssue(DEDUP_ERROR.VERSION, field, 'action.dedup.versions_object'));
    return null;
  }
  const record = /** @type {Record<string, unknown>} */ (value);
  const keys = Object.keys(record);
  if (keys.length !== VERSION_KEYS.length || !VERSION_KEYS.every((k) => keys.includes(k))) {
    problems.push(dedupIssue(DEDUP_ERROR.VERSION, field, 'action.dedup.versions_keys'));
    return null;
  }
  /** @type {Record<string, string>} */
  const out = {};
  for (const key of VERSION_KEYS) {
    const id = record[key];
    if (typeof id !== 'string' || !VERSION_ID.test(id)) {
      problems.push(dedupIssue(DEDUP_ERROR.VERSION, `${field}.${key}`, 'action.dedup.version_id'));
    } else out[key] = id;
  }
  return Object.freeze(out);
}

/** @param {Record<string, string>} versions */
export function formatVersionIds(versions) {
  return VERSION_KEYS.map((k) => `${k}:${versions[k]}`).join(',');
}

/** @param {unknown} text */
export function parseVersionIds(text, problems, field = 'version_ids') {
  if (typeof text !== 'string') {
    problems.push(dedupIssue(DEDUP_ERROR.VERSION, field, 'action.dedup.versions_text'));
    return Object.create(null);
  }
  const parts = text.split(',');
  if (parts.length !== VERSION_KEYS.length) {
    problems.push(dedupIssue(DEDUP_ERROR.VERSION, field, 'action.dedup.versions_keys'));
    return Object.create(null);
  }
  /** @type {Record<string, string>} */
  const out = {};
  for (let i = 0; i < parts.length; i += 1) {
    const [key, value, ...rest] = parts[i].split(':');
    if (key !== VERSION_KEYS[i] || rest.length > 0 || !value || !VERSION_ID.test(value)) {
      problems.push(dedupIssue(DEDUP_ERROR.VERSION, field, 'action.dedup.version_id'));
    } else out[key] = value;
  }
  return Object.freeze(out);
}

/** 窗口只接受运行日；7 天 / 4 周是常量，禁止注入放宽（FR-015 / FR-016）。 */
export function validateWindow(raw) {
  /** @type {Array<import('./errors.js').DedupIssue>} */
  const problems = [];
  if (!isRecord(raw)) {
    throw new DedupError([dedupIssue(DEDUP_ERROR.WINDOW, '(window)', 'action.dedup.window_object')]);
  }
  const keys = Object.keys(raw);
  if (keys.length !== WINDOW_KEYS.length || !WINDOW_KEYS.every((k) => keys.includes(k))) {
    throw new DedupError([dedupIssue(DEDUP_ERROR.WINDOW, '(window)', 'action.dedup.window_keys')]);
  }
  if (!isIsoDate(raw.run_date)) {
    problems.push(dedupIssue(DEDUP_ERROR.DATE, '(window).run_date', 'action.dedup.date'));
  }
  fail(problems);
  return Object.freeze({ run_date: /** @type {string} */ (raw.run_date) });
}

/** 候选规范化 + 固定键集白名单（额外键一律拒绝，防注入 / FR-041）。 */
export function validateCandidate(raw) {
  /** @type {Array<import('./errors.js').DedupIssue>} */
  const problems = [];
  if (!isRecord(raw)) {
    throw new DedupError([dedupIssue(DEDUP_ERROR.CANDIDATE, '(candidate)', 'action.dedup.candidate_object')]);
  }
  const record = /** @type {Record<string, unknown>} */ (raw);
  const keys = Object.keys(record);
  if (keys.some((k) => !CANDIDATE_KEYS.includes(k))
    || !REQUIRED_CANDIDATE_KEYS.every((k) => keys.includes(k))) {
    problems.push(dedupIssue(DEDUP_ERROR.CANDIDATE, '(candidate)', 'action.dedup.candidate_keys'));
  }
  if (!isIsoDate(record.date)) {
    problems.push(dedupIssue(DEDUP_ERROR.DATE, '(candidate).date', 'action.dedup.date'));
  }
  if (!LEVELS.includes(/** @type {string} */ (record.level))) {
    problems.push(dedupIssue(DEDUP_ERROR.CANDIDATE, '(candidate).level', 'action.dedup.level'));
  }
  if (typeof record.period_id !== 'string' || !PERIOD_ID.test(record.period_id)) {
    problems.push(dedupIssue(DEDUP_ERROR.ID, '(candidate).period_id', 'action.dedup.period_id'));
  }
  if (!isCanonicalId(record.main_id)) {
    problems.push(dedupIssue(DEDUP_ERROR.ID, '(candidate).main_id', 'action.dedup.canonical_id'));
  }
  if (!isCanonicalId(record.staple_id)) {
    problems.push(dedupIssue(DEDUP_ERROR.ID, '(candidate).staple_id', 'action.dedup.canonical_id'));
  }
  const versions = validateVersionIds(record.version_ids, problems);
  const cycleKey = record.cycle_key ?? null;
  if (cycleKey !== null && (typeof cycleKey !== 'string' || !CYCLE_KEY.test(cycleKey))) {
    problems.push(dedupIssue(DEDUP_ERROR.CYCLE, '(candidate).cycle_key', 'action.dedup.cycle_key'));
  }
  const source = record.source ?? 'daily';
  if (!SOURCES.includes(/** @type {string} */ (source))) {
    problems.push(dedupIssue(DEDUP_ERROR.CANDIDATE, '(candidate).source', 'action.dedup.source'));
  }
  const alternatives = record.alternatives ?? [];
  if (!Array.isArray(alternatives)) {
    problems.push(dedupIssue(DEDUP_ERROR.CANDIDATE, '(candidate).alternatives', 'action.dedup.alternatives'));
  } else {
    alternatives.forEach((alt, index) => {
      if (!isRecord(alt) || Object.keys(alt).some((k) => !['main_id', 'staple_id', 'cycle_key'].includes(k))
        || !isCanonicalId(alt.main_id) || !isCanonicalId(alt.staple_id)) {
        problems.push(dedupIssue(DEDUP_ERROR.ID, `(candidate).alternatives[${index}]`, 'action.dedup.canonical_id'));
      }
      const altCycle = isRecord(alt) ? (alt.cycle_key ?? null) : null;
      if (altCycle !== null && (typeof altCycle !== 'string' || !CYCLE_KEY.test(altCycle))) {
        problems.push(dedupIssue(DEDUP_ERROR.CYCLE, `(candidate).alternatives[${index}]`, 'action.dedup.cycle_key'));
      }
    });
  }
  fail(problems);
  return Object.freeze({
    date: /** @type {string} */ (record.date),
    level: /** @type {string} */ (record.level),
    period_id: /** @type {string} */ (record.period_id),
    main_id: /** @type {string} */ (record.main_id),
    staple_id: /** @type {string} */ (record.staple_id),
    version_ids: versions,
    cycle_key: cycleKey,
    source,
    alternatives: Object.freeze((/** @type {Array<any>} */ (alternatives)).map((alt) =>
      Object.freeze({ main_id: alt.main_id, staple_id: alt.staple_id, cycle_key: alt.cycle_key ?? null }))),
  });
}

/** 台账行校验：固定 9 键、字段合法、指纹与内容自洽（防篡改 / FR-018）。 */
export function validateLedgerEntry(raw) {
  /** @type {Array<import('./errors.js').DedupIssue>} */
  const problems = [];
  if (!isRecord(raw)) {
    throw new DedupError([dedupIssue(DEDUP_ERROR.LEDGER, '(entry)', 'action.dedup.ledger_object')]);
  }
  const record = /** @type {Record<string, unknown>} */ (raw);
  const keys = Object.keys(record);
  if (keys.length !== LEDGER_COLUMNS.length || !LEDGER_COLUMNS.every((k) => keys.includes(k))) {
    throw new DedupError([dedupIssue(DEDUP_ERROR.LEDGER, '(entry)', 'action.dedup.ledger_keys')]);
  }
  if (!isIsoDate(record.date)) problems.push(dedupIssue(DEDUP_ERROR.DATE, '(entry).date', 'action.dedup.date'));
  if (!LEVELS.includes(/** @type {string} */ (record.level))) {
    problems.push(dedupIssue(DEDUP_ERROR.CANDIDATE, '(entry).level', 'action.dedup.level'));
  }
  if (typeof record.period_id !== 'string' || !PERIOD_ID.test(record.period_id)) {
    problems.push(dedupIssue(DEDUP_ERROR.ID, '(entry).period_id', 'action.dedup.period_id'));
  }
  if (!isCanonicalId(record.main_id) || !isCanonicalId(record.staple_id)) {
    problems.push(dedupIssue(DEDUP_ERROR.ID, '(entry).dish', 'action.dedup.canonical_id'));
  }
  if (typeof record.combo_fp !== 'string' || !FINGERPRINT.test(record.combo_fp)
    || record.combo_fp !== comboFingerprint(record.main_id, record.staple_id)) {
    problems.push(dedupIssue(DEDUP_ERROR.LEDGER, '(entry).combo_fp', 'action.dedup.ledger_fingerprint'));
  }
  const versions = validateVersionIds(record.version_ids, problems, '(entry).version_ids');
  const cycleKey = record.cycle_key ?? null;
  if (cycleKey !== null && (typeof cycleKey !== 'string' || !CYCLE_KEY.test(cycleKey))) {
    problems.push(dedupIssue(DEDUP_ERROR.CYCLE, '(entry).cycle_key', 'action.dedup.cycle_key'));
  }
  if (!SOURCES.includes(/** @type {string} */ (record.source))) {
    problems.push(dedupIssue(DEDUP_ERROR.CANDIDATE, '(entry).source', 'action.dedup.source'));
  }
  fail(problems);
  return Object.freeze({
    date: /** @type {string} */ (record.date),
    level: /** @type {string} */ (record.level),
    period_id: /** @type {string} */ (record.period_id),
    main_id: /** @type {string} */ (record.main_id),
    staple_id: /** @type {string} */ (record.staple_id),
    combo_fp: /** @type {string} */ (record.combo_fp),
    version_ids: versions,
    cycle_key: cycleKey,
    source: /** @type {string} */ (record.source),
  });
}

/** @param {unknown} ledger */
export function validateLedgerArray(ledger) {
  if (!Array.isArray(ledger)) {
    throw new DedupError([dedupIssue(DEDUP_ERROR.LEDGER, '(ledger)', 'action.dedup.ledger_array')]);
  }
  return Object.freeze(ledger.map(validateLedgerEntry));
}

/** 由候选生成恰好一行的台账登记（FR-018 要求的全部字段）。 */
export function toLedgerEntry(candidate) {
  const c = validateCandidate(candidate);
  return validateLedgerEntry({
    date: c.date,
    level: c.level,
    period_id: c.period_id,
    main_id: c.main_id,
    staple_id: c.staple_id,
    combo_fp: comboFingerprint(c.main_id, c.staple_id),
    version_ids: c.version_ids,
    cycle_key: c.cycle_key,
    source: c.source,
  });
}
