// SPDX-License-Identifier: GPL-3.0-only
import { ERR, ioError } from '../../src/io/ports.js';
import { DEFAULT_TIME_ZONE, todayInZone, isoInZone } from '../../src/io/clock.js';

/**
 * 固定时钟替身：把「运行日期」变成可注入值，供 AC-02（2026-01-01）、
 * AC-03（2026-11-06 20:00）、AC-09（周五补跑）等场景确定性复现。
 * @param {string} iso 带偏移的 ISO 时间戳，如 2026-11-06T20:00:00+08:00
 * @param {{timeZone?: string}} [options]
 * @returns {import('../../src/io/ports.js').ClockPort & {advance: (ms: number) => Date, set: (iso: string) => Date}}
 */
export function createFixedClock(iso, { timeZone = DEFAULT_TIME_ZONE } = {}) {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) throw ioError(ERR.CLOCK_INVALID, '固定时钟需要合法 ISO 时间戳');
  let current = parsed;
  const read = () => new Date(current);
  return {
    timeZone,
    now: read,
    today: (zone = timeZone) => todayInZone(read(), zone),
    iso: (zone = timeZone) => isoInZone(read(), zone),
    advance: (milliseconds) => {
      current += milliseconds;
      return read();
    },
    set: (nextIso) => {
      const next = Date.parse(nextIso);
      if (Number.isNaN(next)) throw ioError(ERR.CLOCK_INVALID, '固定时钟需要合法 ISO 时间戳');
      current = next;
      return read();
    },
  };
}
