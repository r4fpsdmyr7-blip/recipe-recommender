// SPDX-License-Identifier: GPL-3.0-only
/**
 * Profile 校验错误码（T-010 / E-08 / FR-049 / plan.md §9）。
 *
 * 与 src/io/ports.js 的 IO 错误码分离：端口错误描述「读不到」，
 * 本文件描述「读到了但不合法」。所有码均为 ASCII 稳定键，
 * 错误对象 MUST NOT 携带任何身体数值或个人数据。
 */

/** @type {Readonly<Record<string, string>>} */
export const PROFILE_ERROR = Object.freeze({
  INVALID: 'ERR_PROFILE_INVALID',
  JSON: 'ERR_PROFILE_JSON',
  SCHEMA: 'ERR_PROFILE_SCHEMA',
  BMR_MISSING: 'ERR_PROFILE_BMR_MISSING',
  BODY_FAT_RANGE: 'ERR_PROFILE_BODY_FAT_RANGE',
  ENERGY_FLOOR: 'ERR_PROFILE_ENERGY_FLOOR',
  LANGUAGE_TAG: 'ERR_PROFILE_LANGUAGE_TAG',
  REGION_CODE: 'ERR_PROFILE_REGION_CODE',
  VERSION: 'ERR_PROFILE_VERSION',
  PRIVACY: 'ERR_PROFILE_PRIVACY',
});

/**
 * 单条可操作校验错误。hint 是 Canonical ID（ASCII），
 * 面向人的文案由 T-031 语言包 / T-019 CLI 渲染（P-11）。
 * @typedef {Readonly<{code: string, field: string, hint: string}>} ProfileIssue
 */

/**
 * @param {string} code PROFILE_ERROR 中的稳定码
 * @param {string} field 字段路径（如 `body.bmr_kcal`）
 * @param {string} hint 修复动作的 Canonical ID
 * @returns {ProfileIssue}
 */
export function issue(code, field, hint) {
  return Object.freeze({ code, field, hint });
}

/** Profile 校验失败：一次性汇总全部问题，便于用户逐项修正。 */
export class ProfileValidationError extends Error {
  /** @param {ProfileIssue[]} issues */
  constructor(issues) {
    // 消息只由稳定码组成，绝不插值输入值（FR-049 / plan.md §9）。
    super(`${PROFILE_ERROR.INVALID}: ${issues.map((i) => i.code).join(',')}`);
    this.name = 'ProfileValidationError';
    this.code = PROFILE_ERROR.INVALID;
    this.issues = Object.freeze(issues.map((i) => Object.freeze({ ...i })));
  }
}
