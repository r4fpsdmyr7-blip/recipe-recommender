// SPDX-License-Identifier: GPL-3.0-only
/**
 * 计划生成域错误码（T-013 / FR-049 / plan.md §9 / P-11）。
 *
 * 与 T-012 RECALC_ERROR 分离：后者描述「重算时间线被破坏」，
 * 本文件描述「五级计划的输入、层级、时令缓存、处方一致性与执行窗口不可用」。
 * 错误消息只由 ASCII 稳定码拼成，issues 只含 { code, field, hint }，
 * 绝不携带身体数值、原生异常文本或自然语言（FR-049 / P-11）。
 */

/** @type {Readonly<Record<string, string>>} */
export const PLAN_ERROR = Object.freeze({
  INVALID: 'ERR_PLAN_INVALID',
  DATE: 'ERR_PLAN_DATE',
  LEVEL: 'ERR_PLAN_LEVEL',
  CLOCK: 'ERR_PLAN_CLOCK',
  PROFILE: 'ERR_PLAN_PROFILE',
  VERSION: 'ERR_PLAN_VERSION',
  RX: 'ERR_PLAN_RX',
  CALENDAR: 'ERR_PLAN_CALENDAR',
  HIERARCHY: 'ERR_PLAN_HIERARCHY',
  WINDOW: 'ERR_PLAN_WINDOW',
  TIMELINE: 'ERR_PLAN_TIMELINE',
  VIEW: 'ERR_PLAN_VIEW',
  FS: 'ERR_PLAN_FS',
});

/**
 * @typedef {Readonly<{code: string, field: string, hint: string}>} PlanIssue
 */

/**
 * @param {string} code PLAN_ERROR 中的稳定码
 * @param {string} field 结构字段路径（不含个人数据）
 * @param {string} hint 修复动作的 Canonical ID
 * @returns {PlanIssue}
 */
export function planIssue(code, field, hint) {
  return Object.freeze({ code, field, hint });
}

/** 计划生成前置条件 / 一致性不满足：一次性汇总全部问题。 */
export class PlanError extends Error {
  /** @param {PlanIssue[]} issues */
  constructor(issues) {
    super(`${PLAN_ERROR.INVALID}: ${issues.map((i) => i.code).join(',')}`);
    this.name = 'PlanError';
    this.code = PLAN_ERROR.INVALID;
    this.issues = Object.freeze(issues.map((i) => Object.freeze({ ...i })));
  }
}
