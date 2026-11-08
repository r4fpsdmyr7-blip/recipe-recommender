// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-014 · `refreshCalendarData(year, calendarAdapter, netPort, ctx)`（FR-011～013 / FR-048）。
 *
 * plan.md §6.1 的三参数签名保持不变，第四个 `ctx` 只承载注入端口
 * （`fsPort` / `clock` / 可选 `cachePath`），便于确定性测试与离线复现。
 *
 * 关键护栏：
 * - 唯一的对外动作是 `netPort.download(url)`，URL 已在适配器契约中静态证明
 *   **不含 query / fragment / 凭据 / 个人参数**（FR-048）；本函数不接收 Profile。
 * - ≥2 独立来源、归一化 UTC+8 后逐条交叉校验，冲突即回退（E-03）。
 * - 失败 / 离线 / 冲突 → `FALLBACK / 未校验` + 人工复核提示 + 沿用上一版缓存；
 *   **绝不内置或静默套用任何节气近似日期表**（FR-012 / AC-04）。
 * - FALLBACK 不覆写上一版缓存（零写入），避免回改历史快照（P-05 精神）。
 * - 季 / 月 / 周 / 日只经 `readCalendarCache()` 读缓存，零网络（NFR-001）。
 */
import { CALENDAR_ERROR, CalendarError, calendarIssue } from './errors.js';
import {
  CALENDAR_STATUS,
  FALLBACK_LABEL,
  MANUAL_REVIEW_KEY,
  cachePathFor,
  validateCalendarAdapter,
} from './contract.js';
import {
  isIsoDate,
  parseTermTable,
  crossCheckSources,
  diffVsPrevious,
  versionFor,
  renderCacheText,
  parseCacheText,
} from './parse.js';

/** @param {unknown} value */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function preflight(year, netPort, ctx) {
  /** @type {import('./errors.js').CalendarIssue[]} */
  const problems = [];
  const add = (code, field, hint) => problems.push(calendarIssue(code, field, hint));
  if (!Number.isInteger(year) || year < 1970 || year > 9999) add(CALENDAR_ERROR.YEAR, '(year)', 'action.calendar.year');
  if (!netPort
    || typeof netPort.download !== 'function'
    || typeof netPort.isOffline !== 'function'
    || typeof netPort.requests !== 'function') {
    add(CALENDAR_ERROR.NET, '(netPort)', 'action.calendar.inject_net_port');
  }
  if (!isRecord(ctx) || !ctx.fsPort
    || typeof ctx.fsPort.readText !== 'function'
    || typeof ctx.fsPort.writeText !== 'function'
    || typeof ctx.fsPort.exists !== 'function') {
    add(CALENDAR_ERROR.FS, '(ctx).fsPort', 'action.calendar.inject_fs_port');
  }
  if (!isRecord(ctx) || !isRecord(ctx.clock) || typeof ctx.clock.iso !== 'function') {
    add(CALENDAR_ERROR.CLOCK, '(ctx).clock', 'action.calendar.inject_clock');
  }
  if (problems.length > 0) throw new CalendarError(problems);
}

/** 读取上一版缓存；缺失或损坏都视为「无上一版」，绝不猜测补齐。 */
async function previousCache(fsPort, cachePath, year) {
  try {
    if (!(await fsPort.exists(cachePath))) return null;
    return parseCacheText(await fsPort.readText(cachePath), year);
  } catch {
    return null;
  }
}

/**
 * 生成 FALLBACK 结果：沿用上一版缓存（若有）、标注未校验、人工复核提示、零写入。
 * @param {Record<string, unknown>} base
 * @param {string[]} reasons
 * @param {ReadonlyArray<unknown>} terms
 */
function fallbackResult(base, reasons, terms) {
  const hasPrevious = terms.length > 0;
  return Object.freeze({
    ...base,
    status: CALENDAR_STATUS.FALLBACK,
    status_label: FALLBACK_LABEL,
    terms: Object.freeze(terms),
    wrote: false,
    cache_text: null,
    diff_vs_previous: null,
    manual_review_key: MANUAL_REVIEW_KEY,
    notice_keys: Object.freeze([
      'calendar.notice.estimated',
      'calendar.notice.unverified',
      'calendar.notice.manual_review',
    ]),
    reason_keys: Object.freeze(hasPrevious ? reasons : [...reasons, 'calendar.fallback.no_previous_cache']),
  });
}

/**
 * 年计划时刷新当年时令缓存。
 *
 * @param {number} year
 * @param {unknown} calendarAdapter
 * @param {import('../../io/ports.js').NetPort} netPort
 * @param {{fsPort: import('../../io/ports.js').FsPort, clock: import('../../io/ports.js').ClockPort, cachePath?: string}} ctx
 * @returns {Promise<Readonly<Record<string, unknown>>>}
 */
export async function refreshCalendarData(year, calendarAdapter, netPort, ctx = {}) {
  preflight(year, netPort, ctx);
  validateCalendarAdapter(calendarAdapter);
  const adapter = /** @type {Record<string, any>} */ (calendarAdapter);
  const fsPort = ctx.fsPort;
  const cachePath = typeof ctx.cachePath === 'string' && ctx.cachePath.length > 0
    ? ctx.cachePath
    : cachePathFor(year);
  const downloadedAt = ctx.clock.iso();
  const sources = adapter.sources;
  const urls = sources.map((s) => s.url);

  const base = Object.freeze({
    year,
    calendar_id: `${adapter.id}-${year}`,
    adapter_id: adapter.id,
    adapter_version: adapter.version,
    kind: adapter.kind,
    cache_path: cachePath,
    downloaded_at: downloadedAt,
    timezone: 'UTC+08:00',
    sources: Object.freeze(urls),
    source_count: urls.length,
  });

  const previous = await previousCache(fsPort, cachePath, year);
  const carried = previous ? previous.terms : Object.freeze([]);

  if (netPort.isOffline()) {
    return fallbackResult(base, ['calendar.fallback.offline'], carried);
  }

  /** @type {Array<{source_id: string, terms: ReadonlyArray<unknown>}>} */
  const parsedSources = [];
  for (const source of sources) {
    let response;
    try {
      response = await netPort.download(source.url);
    } catch {
      return fallbackResult(base, ['calendar.fallback.download_failed'], carried);
    }
    try {
      parsedSources.push({
        source_id: source.id,
        terms: parseTermTable(response.text, year, adapter.expected_count),
      });
    } catch {
      return fallbackResult(base, ['calendar.fallback.parse_failed'], carried);
    }
  }

  let checked;
  try {
    checked = crossCheckSources(/** @type {any} */ (parsedSources));
  } catch {
    return fallbackResult(base, ['calendar.fallback.source_conflict'], carried);
  }
  if (checked.conflicts.length > 0) {
    return fallbackResult(base, ['calendar.fallback.source_conflict'], carried);
  }

  const terms = /** @type {ReadonlyArray<any>} */ (checked.terms);
  const diff = diffVsPrevious(terms, previous ? previous.terms : null);
  const version = versionFor(year, terms);
  const cacheText = renderCacheText({
    ...base,
    status: CALENDAR_STATUS.VERIFIED,
    version,
    diff_vs_previous: diff,
    terms,
  });
  await fsPort.writeText(cachePath, cacheText);

  return Object.freeze({
    ...base,
    status: CALENDAR_STATUS.VERIFIED,
    status_label: CALENDAR_STATUS.VERIFIED,
    version,
    terms: Object.freeze(terms),
    diff_vs_previous: diff,
    wrote: true,
    cache_text: cacheText,
    manual_review_key: null,
    notice_keys: Object.freeze(['calendar.notice.estimated']),
    reason_keys: Object.freeze([]),
  });
}

/**
 * 下层只读缓存：返回与 T-013 `readCalendarView()` **完全兼容**的四键视图。
 * 零写入、零网络（FR-012 / NFR-001 / §9 不变式 2 / SC-005）。
 *
 * @param {import('../../io/ports.js').FsPort} fsPort
 * @param {string} cachePath
 * @param {number} year
 */
export async function readCalendarCache(fsPort, cachePath, year) {
  let text;
  try {
    text = await fsPort.readText(cachePath);
  } catch {
    throw new CalendarError([
      calendarIssue(CALENDAR_ERROR.CACHE, '(cache)', 'action.calendar.cache_missing'),
    ]);
  }
  const parsed = parseCacheText(text, year);
  return Object.freeze({
    cache_id: parsed.calendar_id,
    year: parsed.year,
    status: parsed.status,
    terms: Object.freeze(parsed.terms.map((t) => Object.freeze({ id: t.id, at: t.at }))),
  });
}

/**
 * E-01 B 类提案**暂行**规则：交节 ≥12:00 当日沿用旧节气、次日起新节气。
 * `rule` 固定回传 `E-01-provisional`，提醒上层该规则尚未固化（待上级采纳）。
 *
 * @param {{terms: ReadonlyArray<{id: string, at: string}>}} cache
 * @param {string} date YYYY-MM-DD
 */
export function resolveActiveTerm(cache, date) {
  if (!isRecord(cache) || !Array.isArray(cache.terms) || !isIsoDate(date)) {
    throw new CalendarError([
      calendarIssue(CALENDAR_ERROR.CACHE, '(resolveActiveTerm)', 'action.calendar.active_term_input'),
    ]);
  }
  const sorted = [...cache.terms].sort((a, b) => a.at.localeCompare(b.at));
  const candidates = sorted.filter((t) => t.at.slice(0, 10) <= date);
  if (candidates.length === 0) {
    return Object.freeze({ term_id: null, effective_at: null, rule: 'E-01-provisional' });
  }
  let chosen = candidates[candidates.length - 1];
  const sameDay = chosen.at.slice(0, 10) === date;
  const afterNoon = Number(chosen.at.slice(11, 13)) >= 12;
  if (sameDay && afterNoon) chosen = candidates[candidates.length - 2] ?? null;
  return Object.freeze({
    term_id: chosen?.id ?? null,
    effective_at: chosen?.at ?? null,
    rule: 'E-01-provisional',
  });
}
