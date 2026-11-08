// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-014 · 可插拔历法适配器契约（FR-011～013 注 / FR-032 / FR-048 / E-09）。
 *
 * 适配器只描述「去哪里取、取几条、是什么历法」，**不携带任何节气日期数据**；
 * 全部数值来自注入的 netPort 下载结果（FR-012 禁止内置近似日期表）。
 * 固定键集白名单：额外键一律拒绝，既防注入也防把受版权保护的原文塞进产物。
 */
import { assertSafeCalendarUrl } from '../../io/net.js';
import { CALENDAR_ERROR, CalendarError, calendarIssue } from './errors.js';

export const CALENDAR_KIND = Object.freeze({
  SOLAR_TERMS: 'solar-terms',
  SEASON: 'gregorian-season',
});

export const CALENDAR_STATUS = Object.freeze({
  VERIFIED: 'verified',
  FALLBACK: 'FALLBACK',
});

export const FALLBACK_LABEL = 'FALLBACK / 未校验';
export const MANUAL_REVIEW_KEY = 'calendar.review.manual';

/** plan.md §5.3 / tasks.md T-014 的默认缓存路径；SPEC §6.2 / AC-04 写 `_data/`，故路径 MUST 可注入。 */
export const DEFAULT_CACHE_PREFIX = 'data/calendar/solar-terms';

/** @param {number|string} year @param {string} [prefix] */
export function cachePathFor(year, prefix = DEFAULT_CACHE_PREFIX) {
  return `${prefix}-${year}.md`;
}

const ADAPTER_KEYS = Object.freeze([
  'id', 'version', 'kind', 'expected_count', 'notice_key', 'sources',
]);
const SOURCE_KEYS = Object.freeze(['id', 'url']);
const ADAPTER_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VERSION = /^[A-Za-z0-9._-]{1,32}$/;
const CANONICAL_ID = /^[a-z][a-z0-9._-]{0,63}$/;

/** @param {unknown} value */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function keysOk(record, allowed) {
  const keys = Object.keys(record);
  return keys.length === allowed.length && keys.every((k) => allowed.includes(k));
}

/**
 * 校验可插拔历法适配器。≥2 个独立来源；来源 URL 必须满足 FR-048 静态护栏。
 * @param {unknown} adapter
 * @returns {void}
 * @throws {CalendarError}
 */
export function validateCalendarAdapter(adapter) {
  /** @type {import('./errors.js').CalendarIssue[]} */
  const problems = [];
  const add = (code, field, hint) => problems.push(calendarIssue(code, field, hint));
  if (!isRecord(adapter) || !keysOk(/** @type {Record<string, unknown>} */ (adapter), ADAPTER_KEYS)) {
    throw new CalendarError([calendarIssue(CALENDAR_ERROR.ADAPTER, '(adapter)', 'action.calendar.adapter_object')]);
  }
  const a = /** @type {Record<string, unknown>} */ (adapter);
  if (typeof a.id !== 'string' || !ADAPTER_ID.test(a.id)) add(CALENDAR_ERROR.ADAPTER, '(adapter).id', 'action.calendar.adapter_id');
  if (typeof a.version !== 'string' || !VERSION.test(a.version)) add(CALENDAR_ERROR.ADAPTER, '(adapter).version', 'action.calendar.adapter_version');
  if (!Object.values(CALENDAR_KIND).includes(a.kind)) add(CALENDAR_ERROR.ADAPTER, '(adapter).kind', 'action.calendar.adapter_kind');
  if (!Number.isInteger(a.expected_count) || a.expected_count < 1 || a.expected_count > 366) {
    add(CALENDAR_ERROR.ADAPTER, '(adapter).expected_count', 'action.calendar.adapter_count');
  }
  if (typeof a.notice_key !== 'string' || !CANONICAL_ID.test(a.notice_key)) {
    add(CALENDAR_ERROR.ADAPTER, '(adapter).notice_key', 'action.calendar.adapter_notice');
  }
  if (!Array.isArray(a.sources) || a.sources.length < 2) {
    add(CALENDAR_ERROR.SOURCES, '(adapter).sources', 'action.calendar.sources_count');
  } else {
    /** @type {string[]} */
    const urls = [];
    /** @type {string[]} */
    const ids = [];
    for (const [index, source] of a.sources.entries()) {
      if (!isRecord(source) || !keysOk(/** @type {Record<string, unknown>} */ (source), SOURCE_KEYS)) {
        add(CALENDAR_ERROR.SOURCES, `(adapter).sources[${index}]`, 'action.calendar.source_object');
        continue;
      }
      const s = /** @type {Record<string, unknown>} */ (source);
      if (typeof s.id !== 'string' || !CANONICAL_ID.test(s.id)) {
        add(CALENDAR_ERROR.SOURCES, `(adapter).sources[${index}].id`, 'action.calendar.source_id');
      } else ids.push(s.id);
      if (typeof s.url !== 'string') {
        add(CALENDAR_ERROR.URL, `(adapter).sources[${index}].url`, 'action.calendar.source_url');
        continue;
      }
      try {
        assertSafeCalendarUrl(s.url);
      } catch {
        add(CALENDAR_ERROR.URL, `(adapter).sources[${index}].url`, 'action.calendar.source_url_safe');
      }
      urls.push(s.url);
    }
    if (new Set(urls).size !== urls.length || new Set(ids).size !== ids.length) {
      add(CALENDAR_ERROR.SOURCES, '(adapter).sources', 'action.calendar.sources_independent');
    }
  }
  if (problems.length > 0) throw new CalendarError(problems);
}
