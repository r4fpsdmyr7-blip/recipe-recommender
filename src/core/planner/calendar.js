// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-013 · 只读时令缓存视图（FR-012 / E-03 / §9 不变式 2 / T-014 边界）。
 *
 * **T-014 尚未实现**：本模块不下载、不缓存、不计算任何节气交节时刻，
 * 也不内置任何固定 / 近似节气日期表。调用方 MUST 注入由 T-014
 * `refreshCalendarData()` 产出的只读缓存视图；本模块只做固定键集校验与
 * 「按日期筛选缓存中已存在的条目」，把 Canonical ID 透传进计划头部。
 *
 * 若缓存状态为 FALLBACK，计划头部必须带人工复核提示键，不得静默取近似值（E-03）。
 */
import { PLAN_ERROR, PlanError, planIssue } from './errors.js';
import { isIsoDate } from './split.js';

export const CALENDAR_STATUS = Object.freeze({
  VERIFIED: 'verified',
  FALLBACK: 'FALLBACK',
});

const CACHE_KEYS = Object.freeze(['cache_id', 'year', 'status', 'terms']);
const TERM_KEYS = Object.freeze(['id', 'at']);
const CANONICAL_ID = /^[a-z][a-z0-9._-]{0,63}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;

/** @param {unknown} value */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 固定键集白名单：额外键 / 缺键一律拒绝（同 T-011 FR-032 的防注入口径）。 */
function keysOk(record, allowed) {
  const keys = Object.keys(record);
  return keys.length === allowed.length && keys.every((k) => allowed.includes(k));
}

/**
 * 读取并校验只读时令缓存视图，选出周期范围内的条目 ID。
 *
 * @param {unknown} raw T-014 缓存视图：`{ cache_id, year, status, terms: [{ id, at }] }`
 * @param {string} startDate YYYY-MM-DD
 * @param {string} endDate YYYY-MM-DD
 * @returns {Readonly<{
 *   cache_id: string, year: number, status: string,
 *   term_ids: ReadonlyArray<string>, active_term_id: string|null,
 *   manual_review_key: string|null
 * }>}
 * @throws {PlanError} 缓存缺失、键集不合规、条目不合规
 */
export function readCalendarView(raw, startDate, endDate) {
  const fail = (field, hint) => {
    throw new PlanError([planIssue(PLAN_ERROR.CALENDAR, field, hint)]);
  };
  if (!isRecord(raw) || !keysOk(/** @type {Record<string, unknown>} */ (raw), CACHE_KEYS)) {
    fail('(calendar)', 'action.plan.calendar_object');
  }
  const view = /** @type {Record<string, unknown>} */ (raw);
  if (typeof view.cache_id !== 'string' || !CANONICAL_ID.test(view.cache_id)) {
    fail('(calendar).cache_id', 'action.plan.calendar_id');
  }
  if (!Number.isInteger(view.year) || view.year < 1970 || view.year > 9999) {
    fail('(calendar).year', 'action.plan.calendar_year');
  }
  if (!Object.values(CALENDAR_STATUS).includes(view.status)) {
    fail('(calendar).status', 'action.plan.calendar_status');
  }
  if (!Array.isArray(view.terms)) {
    fail('(calendar).terms', 'action.plan.calendar_terms');
  }
  for (const [index, term] of view.terms.entries()) {
    if (!isRecord(term) || !keysOk(/** @type {Record<string, unknown>} */ (term), TERM_KEYS)) {
      fail(`(calendar).terms[${index}]`, 'action.plan.calendar_term_object');
    }
    const t = /** @type {Record<string, unknown>} */ (term);
    if (typeof t.id !== 'string' || !CANONICAL_ID.test(t.id)) {
      fail(`(calendar).terms[${index}].id`, 'action.plan.calendar_term_id');
    }
    if (typeof t.at !== 'string' || !ISO_INSTANT.test(t.at) || !isIsoDate(t.at.slice(0, 10))) {
      fail(`(calendar).terms[${index}].at`, 'action.plan.calendar_term_at');
    }
  }
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
    fail('(period)', 'action.plan.calendar_range');
  }

  const sorted = [...view.terms].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const within = sorted.filter((t) => t.at.slice(0, 10) >= startDate && t.at.slice(0, 10) <= endDate);
  const before = sorted.filter((t) => t.at.slice(0, 10) <= endDate);
  const active = before.length > 0 ? before[before.length - 1].id : null;

  return Object.freeze({
    cache_id: view.cache_id,
    year: view.year,
    status: view.status,
    term_ids: Object.freeze(within.map((t) => t.id)),
    active_term_id: active,
    manual_review_key: view.status === CALENDAR_STATUS.FALLBACK
      ? 'plan.review.calendar_fallback'
      : null,
  });
}
