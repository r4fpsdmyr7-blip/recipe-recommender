// SPDX-License-Identifier: GPL-3.0-only
import { ERR, ioError } from './ports.js';

/** 默认业务时区：UTC+8，节气与计划日期统一按此换算（plan.md §2.3）。 */
export const DEFAULT_TIME_ZONE = 'Asia/Shanghai';

/**
 * 用 Intl 取得指定时区的日历字段，避免手写时区偏移导致夏令时 / 历史偏移错误。
 * @param {Date} date
 * @param {string} timeZone
 * @returns {Record<string, string>}
 */
function zonedParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  return Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
}

/**
 * 取得该时区的 UTC 偏移字符串，如 +08:00 / Z。
 * @param {Date} date
 * @param {string} timeZone
 * @returns {string}
 */
function zoneOffset(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  }).formatToParts(date);
  const raw = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const matched = /^GMT([+-])(\d{2}):(\d{2})$/.exec(raw);
  return matched ? `${matched[1]}${matched[2]}:${matched[3]}` : 'Z';
}

/**
 * @param {Date} date
 * @param {string} [timeZone]
 * @returns {string} YYYY-MM-DD
 */
export function todayInZone(date, timeZone = DEFAULT_TIME_ZONE) {
  const parts = zonedParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * @param {Date} date
 * @param {string} [timeZone]
 * @returns {string} YYYY-MM-DDTHH:mm:ss+08:00
 */
export function isoInZone(date, timeZone = DEFAULT_TIME_ZONE) {
  const parts = zonedParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${zoneOffset(date, timeZone)}`;
}

/**
 * 系统时钟端口。now 可注入，便于在不改业务代码的前提下复现固定运行日期。
 * @param {{timeZone?: string, now?: () => Date}} [options]
 * @returns {import('./ports.js').ClockPort}
 */
export function createSystemClock({ timeZone = DEFAULT_TIME_ZONE, now = () => new Date() } = {}) {
  const read = () => {
    const value = now();
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw ioError(ERR.CLOCK_INVALID, '时钟返回了无效日期');
    }
    return value;
  };
  return {
    timeZone,
    now: read,
    today: (zone = timeZone) => todayInZone(read(), zone),
    iso: (zone = timeZone) => isoInZone(read(), zone),
  };
}
