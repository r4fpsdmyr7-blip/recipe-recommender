// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-020 · 日志适配器（FR-041 / FR-047 / FR-049 / NFR-002 / plan.md §9）。
 *
 * 可证形式：**日志值只接受字符串且必须是 Canonical ID 或稳定码**。
 * 于是「身体数值」在类型层就进不了日志（`typeof value === 'number'` 直接拒绝），
 * 不需要事后做正则清洗；日志行因此天然零数字、零中文、零自由文本。
 *
 * 三条硬约束：
 * 1. **固定键集白名单** `{event, code, field?}`：注入 `body` / `note` / `path` 一律拒绝，
 *    避免「顺手把上下文塞进日志」把个人信息带出去（FR-032 口径）。
 * 2. **确定性**：行内不含时间戳、随机数、进程标识；同输入两次记录字节一致（FR-028），
 *    日志因此可 diff、可作为验收比对基线。
 * 3. **零 IO**：本模块不落盘、不联网、不读环境；写入目的地由调用方注入 `sink`，
 *    默认不写任何地方（离线优先 NFR-001）。
 */

/** @type {Readonly<Record<string, string>>} */
export const LOG_ERROR = Object.freeze({
  INVALID: 'ERR_LOG_INVALID',
  KEYS: 'ERR_LOG_KEYS',
  EVENT: 'ERR_LOG_EVENT',
  CODE: 'ERR_LOG_CODE',
  VALUE: 'ERR_LOG_VALUE',
});

/** 日志级别三档（NFR-002）。 */
export const LOG_LEVEL = Object.freeze({
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
});

/** 日志记录的固定键集（排序后即本数组，便于白名单直接比对）。 */
export const LOG_KEYS = Object.freeze(['code', 'event', 'field']);

/** Canonical ID：小写起头，只允许 a-z0-9 与 `.` `_` `-`（与全项目 Canonical ID 同构）。 */
const IDENT = /^[a-z][a-z0-9._-]*$/;

/** 稳定码：`ok` 或 `ERR_` + 大写下划线分段（不允许多余的首尾/连续下划线）。 */
const STABLE = /^(?:ok|ERR_[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*)$/;

const LEVELS = Object.freeze([LOG_LEVEL.INFO, LOG_LEVEL.WARN, LOG_LEVEL.ERROR]);

/**
 * @typedef {Readonly<{code: string, field: string, hint: string}>} LogIssue
 */

/** @param {string} code @param {string} field @param {string} hint @returns {LogIssue} */
function logIssue(code, field, hint) {
  return Object.freeze({ code, field, hint });
}

/** 日志输入不合法：`code` 恒为 `ERR_LOG_INVALID`，具体码在 `issues[].code`。 */
export class LogError extends Error {
  /** @param {LogIssue[]} issues */
  constructor(issues) {
    const list = issues.map((issue) => Object.freeze({ ...issue }));
    super(`${LOG_ERROR.INVALID}: ${list.map((issue) => issue.code).join(',')}`);
    this.name = 'LogError';
    this.code = LOG_ERROR.INVALID;
    this.issues = Object.freeze(list);
  }
}

/**
 * 创建日志端口。
 * @param {{level?: string, sink?: (line: string) => void}} [options]
 *   `level` 只允许三档；`sink` 是唯一的落地通道，缺省即「不落地」。
 * @returns {Readonly<{
 *   level: string,
 *   sink: ((line: string) => void) | undefined,
 *   record: (entry: unknown) => string,
 *   lines: () => string[],
 *   entries: () => ReadonlyArray<Readonly<Record<string, string>>>,
 * }>}
 * @throws {LogError}
 */
export function createLogPort({ level = LOG_LEVEL.INFO, sink } = {}) {
  if (!LEVELS.includes(level)) {
    throw new LogError([logIssue(LOG_ERROR.VALUE, 'level', 'action.log.level')]);
  }
  if (sink !== undefined && typeof sink !== 'function') {
    throw new LogError([logIssue(LOG_ERROR.VALUE, 'sink', 'action.log.sink')]);
  }

  /** @type {string[]} */
  const lines = [];
  /** @type {Array<Readonly<Record<string, string>>>} */
  const stored = [];

  /**
   * 记录一条事件。返回值即写入 `sink` 的同一行文本（便于调用方转交给 CLI 输出与测试比对）。
   * @param {unknown} entry
   * @returns {string}
   * @throws {LogError}
   */
  const record = (entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new LogError([logIssue(LOG_ERROR.INVALID, '(entry)', 'action.log.entry')]);
    }
    const bag = /** @type {Record<string, unknown>} */ (entry);

    // 1. 固定键集白名单：先于取值检查，避免「多塞一个键」被当成无害余量。
    for (const key of Object.keys(bag)) {
      if (!LOG_KEYS.includes(key)) {
        throw new LogError([logIssue(LOG_ERROR.KEYS, '(entry)', 'action.log.keys')]);
      }
    }

    // 2. 必需键：缺省与类型错误分开报，便于调用方定位。
    if (!Object.hasOwn(bag, 'event')) {
      throw new LogError([logIssue(LOG_ERROR.EVENT, 'event', 'action.log.event')]);
    }
    if (!Object.hasOwn(bag, 'code')) {
      throw new LogError([logIssue(LOG_ERROR.CODE, 'code', 'action.log.code')]);
    }

    const event = bag.event;
    if (typeof event !== 'string' || !IDENT.test(event)) {
      throw new LogError([logIssue(LOG_ERROR.EVENT, 'event', 'action.log.event')]);
    }

    const code = bag.code;
    if (typeof code !== 'string' || !STABLE.test(code)) {
      throw new LogError([logIssue(LOG_ERROR.CODE, 'code', 'action.log.code')]);
    }

    // 3. 可选字段：`null` 与缺省不等价 —— 显式传 null 是错误而非「没有值」。
    let field = null;
    if (Object.hasOwn(bag, 'field')) {
      const value = bag.field;
      if (typeof value !== 'string' || !IDENT.test(value)) {
        throw new LogError([logIssue(LOG_ERROR.VALUE, 'field', 'action.log.value')]);
      }
      field = value;
    }

    const text = field === null
      ? `level=${level} event=${event} code=${code}`
      : `level=${level} event=${event} code=${code} field=${field}`;

    lines.push(text);
    stored.push(Object.freeze(field === null
      ? { level, event, code }
      : { level, event, code, field }));
    if (sink !== undefined) sink(text);
    return text;
  };

  return Object.freeze({
    level,
    sink,
    record,
    lines: () => [...lines],
    entries: () => Object.freeze([...stored]),
  });
}
