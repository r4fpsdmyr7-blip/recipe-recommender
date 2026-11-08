// SPDX-License-Identifier: GPL-3.0-only
/** IO 端口统一出口。核心域只从此处注入依赖，不直接引用 node: 内置模块（plan.md §3）。 */

export { ERR, ioError } from './ports.js';
export { DEFAULT_TIME_ZONE, createSystemClock, todayInZone, isoInZone } from './clock.js';
export { createLocalFsPort } from './fs.js';
export { createNetPort, assertSafeCalendarUrl } from './net.js';
export { LOG_ERROR, LogError, LOG_KEYS, LOG_LEVEL, createLogPort } from './log.js';
