// SPDX-License-Identifier: GPL-3.0-only
/**
 * 重算域错误码与错误对象（T-012 / E-04 / P-05 / FR-049 / plan.md §9）。
 *
 * 与 T-010 PROFILE_ERROR 分离：后者描述「档案本身不合法」，
 * 本文件描述「档案与计划头部不一致、时间线被破坏、重算输入不可用」。
 * 错误对象只携带 ASCII 稳定码 + Canonical ID，绝不插值身体数值、
 * 文件路径以外的内容或原生异常文本（P-11 / FR-049）。
 */

/** @type {Readonly<Record<string, string>>} */
export const RECALC_ERROR = Object.freeze({
  INVALID: 'ERR_RECALC_INVALID',
  HEADER: 'ERR_RECALC_HEADER',
  CHANGE: 'ERR_RECALC_CHANGE',
  DATE: 'ERR_RECALC_DATE',
  TIMELINE: 'ERR_RECALC_TIMELINE',
  CLOCK: 'ERR_RECALC_CLOCK',
  FS: 'ERR_RECALC_FS',
});

/**
 * @typedef {Readonly<{code: string, field: string, hint: string}>} RecalcIssue
 */

/**
 * @param {string} code RECALC_ERROR 中的稳定码
 * @param {string} field 字段路径（只允许结构路径，不含个人数据）
 * @param {string} hint 修复动作的 Canonical ID
 * @returns {RecalcIssue}
 */
export function recalcIssue(code, field, hint) {
  return Object.freeze({ code, field, hint });
}

/** 重算前置条件不满足：一次性汇总全部问题，便于逐项修正。 */
export class RecalcError extends Error {
  /** @param {RecalcIssue[]} issues */
  constructor(issues) {
    // 消息只由稳定码组成，绝不插值输入值（FR-049 / plan.md §9）。
    super(`${RECALC_ERROR.INVALID}: ${issues.map((i) => i.code).join(',')}`);
    this.name = 'RecalcError';
    this.code = RECALC_ERROR.INVALID;
    this.issues = Object.freeze(issues.map((i) => Object.freeze({ ...i })));
  }
}
