// SPDX-License-Identifier: GPL-3.0-only
/** 核心域「历法适配器 / 时令缓存刷新 / 下层只读」统一出口（plan.md §6.1 / §7.1）。 */

export { CALENDAR_ERROR, CalendarError, calendarIssue } from './errors.js';
export {
  CALENDAR_KIND,
  CALENDAR_STATUS,
  FALLBACK_LABEL,
  MANUAL_REVIEW_KEY,
  DEFAULT_CACHE_PREFIX,
  cachePathFor,
  validateCalendarAdapter,
} from './contract.js';
export {
  isIsoDate,
  normalizeUtc8,
  parseTermTable,
  crossCheckSources,
  diffVsPrevious,
  versionFor,
  renderCacheText,
  parseCacheText,
} from './parse.js';
export {
  refreshCalendarData,
  readCalendarCache,
  resolveActiveTerm,
} from './refresh.js';
