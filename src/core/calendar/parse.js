// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-014 · 时令数据解析、UTC+8 归一化、双源交叉校验与可 diff 缓存文本（FR-011 / SC-005）。
 *
 * 本文件**不含任何节气名称或日期常量**：所有条目来自 netPort 下载正文，
 * 内部一律以 Canonical ID 表示（P-11 / FR-012）。UTC+8 无夏令时，
 * 因此固定 +8 小时偏移即可把任意带偏移的 ISO 时刻换算为北京时间。
 */
import { CALENDAR_ERROR, CalendarError, calendarIssue } from './errors.js';
import { CALENDAR_STATUS, FALLBACK_LABEL } from './contract.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;
const TERM_LINE = /^term id=(\S+) longitude_deg=(\S+) at=(\S+)(?: date=(\S+))?$/;
const CANONICAL_ID = /^[a-z][a-z0-9._-]{0,63}$/;
const UTC8_MS = 8 * 3600 * 1000;

/** @param {unknown} value */
export function isIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * 把任意带偏移的 ISO 时刻统一为北京时间 `YYYY-MM-DDTHH:mm:ss+08:00`。
 * @param {unknown} value
 * @returns {string}
 * @throws {CalendarError}
 */
export function normalizeUtc8(value) {
  if (typeof value !== 'string' || !INSTANT.test(value) || !isIsoDate(value.slice(0, 10))) {
    throw new CalendarError([
      calendarIssue(CALENDAR_ERROR.INSTANT, '(at)', 'action.calendar.instant'),
    ]);
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new CalendarError([
      calendarIssue(CALENDAR_ERROR.INSTANT, '(at)', 'action.calendar.instant'),
    ]);
  }
  return `${new Date(ms + UTC8_MS).toISOString().slice(0, 19)}+08:00`;
}

/**
 * 解析来源正文中的时令条目（中性行格式，不含节气名 / 日期常量）。
 * @param {unknown} text
 * @param {number} year
 * @param {number} expectedCount
 * @returns {ReadonlyArray<Readonly<{id: string, longitude_deg: number, at: string, date: string}>>}
 */
export function parseTermTable(text, year, expectedCount) {
  const fail = (field, hint) => {
    throw new CalendarError([calendarIssue(CALENDAR_ERROR.PARSE, field, hint)]);
  };
  if (typeof text !== 'string') fail('(source)', 'action.calendar.source_text');
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length !== expectedCount) fail('(source)', 'action.calendar.term_count');

  /** @type {Array<{id: string, longitude_deg: number, at: string, date: string}>} */
  const terms = [];
  /** @type {Set<string>} */
  const seen = new Set();
  for (const [index, line] of lines.entries()) {
    const m = TERM_LINE.exec(line);
    if (!m) fail(`term[${index}]`, 'action.calendar.term_line');
    const [, id, longitudeRaw, atRaw] = /** @type {RegExpExecArray} */ (m);
    if (!CANONICAL_ID.test(id)) fail(`term[${index}].id`, 'action.calendar.term_id');
    if (seen.has(id)) fail(`term[${index}].id`, 'action.calendar.term_duplicate');
    seen.add(id);
    const longitude = Number(longitudeRaw);
    if (!Number.isFinite(longitude) || longitude < 0 || longitude > 360) {
      fail(`term[${index}].longitude_deg`, 'action.calendar.term_longitude');
    }
    let at;
    try {
      at = normalizeUtc8(atRaw);
    } catch {
      throw new CalendarError([
        calendarIssue(CALENDAR_ERROR.INSTANT, `term[${index}].at`, 'action.calendar.instant'),
      ]);
    }
    const date = at.slice(0, 10);
    if (!date.startsWith(`${year}-`)) fail(`term[${index}].at`, 'action.calendar.term_year');
    terms.push(Object.freeze({ id, longitude_deg: longitude, at, date }));
  }
  return Object.freeze(terms);
}

/**
 * ≥2 源逐条交叉校验（归一化后比对 id / 黄经 / 交节时刻）。
 * @param {Array<{source_id: string, terms: ReadonlyArray<{id: string, longitude_deg: number, at: string}>}>} sourceResults
 * @returns {Readonly<{terms: ReadonlyArray<unknown>, conflicts: ReadonlyArray<string>}>}
 */
export function crossCheckSources(sourceResults) {
  if (!Array.isArray(sourceResults) || sourceResults.length < 2) {
    throw new CalendarError([
      calendarIssue(CALENDAR_ERROR.SOURCES, '(sources)', 'action.calendar.sources_count'),
    ]);
  }
  const normalized = sourceResults.map((s) => ({
    source_id: s.source_id,
    terms: [...s.terms].sort((a, b) => a.id.localeCompare(b.id)),
  }));
  const base = normalized[0].terms;
  /** @type {string[]} */
  const conflicts = [];
  for (let i = 1; i < normalized.length; i += 1) {
    const other = normalized[i].terms;
    if (other.length !== base.length) {
      conflicts.push(`count:${normalized[i].source_id}`);
      continue;
    }
    for (let j = 0; j < base.length; j += 1) {
      const a = base[j];
      const b = other[j];
      if (a.id !== b.id) conflicts.push(`${a.id}:id`);
      else {
        if (a.longitude_deg !== b.longitude_deg) conflicts.push(`${a.id}:longitude_deg`);
        if (a.at !== b.at) conflicts.push(`${a.id}:at`);
      }
    }
  }
  return Object.freeze({ terms: Object.freeze(base), conflicts: Object.freeze(conflicts) });
}

/** 与上一版缓存的结构化差异（FR-011「与旧近似表差异」的可审计替代口径）。 */
export function diffVsPrevious(current, previous) {
  const now = new Map(current.map((t) => [t.id, t]));
  const before = new Map((previous ?? []).map((t) => [t.id, t]));
  const added = [...now.keys()].filter((id) => !before.has(id)).sort();
  const removed = [...before.keys()].filter((id) => !now.has(id)).sort();
  const changed = [...now.keys()].filter((id) => {
    const b = before.get(id);
    return b && (b.at !== now.get(id)?.at || b.longitude_deg !== now.get(id)?.longitude_deg);
  }).sort();
  return Object.freeze({ added: Object.freeze(added), removed: Object.freeze(removed), changed: Object.freeze(changed) });
}

/** 纯 JS 32 位 FNV-1a，零 node:crypto 依赖，保证核心域可移植（NFR-004）。 */
function fingerprint(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** @param {number} year @param {ReadonlyArray<{id: string, longitude_deg: number, at: string}>} terms */
export function versionFor(year, terms) {
  const body = terms.map((t) => `${t.id}|${t.longitude_deg}|${t.at}`).join('\n');
  return `calendar-${year}-${fingerprint(body)}`;
}

/**
 * 渲染 Git 可 diff 的缓存文本：来源 URL / 下载时间 / 版本号 / 差异 / 24 条条目。
 * FALLBACK 时额外写 `# FALLBACK / 未校验`（FR-013 / AC-04）。
 * @param {Record<string, unknown>} data
 */
export function renderCacheText(data) {
  const status = data.status === CALENDAR_STATUS.FALLBACK ? CALENDAR_STATUS.FALLBACK : CALENDAR_STATUS.VERIFIED;
  const terms = /** @type {Array<Record<string, unknown>>} */ (data.terms ?? []);
  const sources = /** @type {string[]} */ (data.sources ?? []);
  const diff = /** @type {Record<string, string[]> | null} */ (data.diff_vs_previous ?? null);
  const noticeKeys = ['calendar.notice.estimated'];
  if (status === CALENDAR_STATUS.FALLBACK) {
    noticeKeys.push('calendar.notice.unverified', 'calendar.notice.manual_review');
  }
  const diffText = diff
    ? `added:${diff.added.length};removed:${diff.removed.length};changed:${diff.changed.length}`
    : 'none';
  const lines = [
    '# calendar-cache',
    ...(status === CALENDAR_STATUS.FALLBACK ? [`# ${FALLBACK_LABEL}`] : []),
    `calendar_id=${data.calendar_id}`,
    `adapter_id=${data.adapter_id}`,
    `adapter_version=${data.adapter_version}`,
    `kind=${data.kind}`,
    `year=${data.year}`,
    `status=${status}`,
    `version=${data.version}`,
    `downloaded_at=${data.downloaded_at}`,
    'timezone=UTC+08:00',
    `source_count=${sources.length}`,
    `sources=${sources.join('|')}`,
    `diff_vs_previous=${diffText}`,
    `notice_keys=${noticeKeys.join(',')}`,
    ...terms.map((t) => `term id=${t.id} longitude_deg=${t.longitude_deg} at=${t.at} date=${t.date}`),
    '',
  ];
  return lines.join('\n');
}

/**
 * 解析缓存文本（下层只读入口使用）。
 * @param {unknown} text
 * @param {number} year
 */
export function parseCacheText(text, year) {
  const fail = (hint) => {
    throw new CalendarError([calendarIssue(CALENDAR_ERROR.CACHE, '(cache)', hint)]);
  };
  if (typeof text !== 'string') fail('action.calendar.cache_text');
  const lines = String(text).split(/\r?\n/).filter((l) => l.length > 0 && !l.startsWith('#'));
  /** @type {Record<string, string>} */
  const head = {};
  /** @type {string[]} */
  const termLines = [];
  for (const line of lines) {
    if (line.startsWith('term ')) { termLines.push(line); continue; }
    const m = /^([a-z_]+)=(.*)$/.exec(line);
    if (m) head[m[1]] = m[2];
  }
  if (!['verified', CALENDAR_STATUS.FALLBACK].includes(head.status)) fail('action.calendar.cache_status');
  if (Number(head.year) !== year) fail('action.calendar.cache_year');
  if (typeof head.calendar_id !== 'string' || head.calendar_id.length === 0) fail('action.calendar.cache_id');
  if (typeof head.version !== 'string' || head.version.length === 0) fail('action.calendar.cache_version');
  const terms = termLines.length > 0
    ? parseTermTable(termLines.join('\n'), year, termLines.length)
    : Object.freeze([]);
  return Object.freeze({
    calendar_id: head.calendar_id,
    year,
    status: head.status,
    version: head.version,
    downloaded_at: head.downloaded_at ?? null,
    sources: (head.sources ?? '').split('|').filter(Boolean),
    terms,
  });
}
