// SPDX-License-Identifier: GPL-3.0-only
/**
 * 历法域错误码（T-014 / FR-049 / plan.md §9 / P-11）。
 *
 * 错误对象只携带 ASCII 稳定码 + Canonical ID，绝不插值下载正文、
 * 身体数值、URL 中的个人参数或原生异常文本（FR-048 / FR-049）。
 */

/** @type {Readonly<Record<string, string>>} */
export const CALENDAR_ERROR = Object.freeze({
  INVALID: 'ERR_CALENDAR_INVALID',
  YEAR: 'ERR_CALENDAR_YEAR',
  ADAPTER: 'ERR_CALENDAR_ADAPTER',
  SOURCES: 'ERR_CALENDAR_SOURCES',
  URL: 'ERR_CALENDAR_URL',
  PARSE: 'ERR_CALENDAR_PARSE',
  INSTANT: 'ERR_CALENDAR_INSTANT',
  CONFLICT: 'ERR_CALENDAR_CONFLICT',
  CACHE: 'ERR_CALENDAR_CACHE',
  FS: 'ERR_CALENDAR_FS',
  NET: 'ERR_CALENDAR_NET',
  CLOCK: 'ERR_CALENDAR_CLOCK',
});

/**
 * @typedef {Readonly<{code: string, field: string, hint: string}>} CalendarIssue
 */

/** @param {string} code @param {string} field @param {string} hint */
export function calendarIssue(code, field, hint) {
  return Object.freeze({ code, field, hint });
}

/** 历法输入 / 缓存 / 来源不合规：一次性汇总全部问题。 */
export class CalendarError extends Error {
  /** @param {CalendarIssue[]} issues */
  constructor(issues) {
    super(`${CALENDAR_ERROR.INVALID}: ${issues.map((i) => i.code).join(',')}`);
    this.name = 'CalendarError';
    this.code = CALENDAR_ERROR.INVALID;
    this.issues = Object.freeze(issues.map((i) => Object.freeze({ ...i })));
  }
}
