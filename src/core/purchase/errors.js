// SPDX-License-Identifier: GPL-3.0-only
/** T-016 · 采购与执行域稳定错误码与脱敏错误对象（FR-049 / plan.md §9 / P-11）。 */

export const PURCHASE_ERROR = Object.freeze({
  INVALID: 'ERR_PURCHASE_INVALID',
  WEEK_PLAN: 'ERR_PURCHASE_WEEK_PLAN',
  WINDOW: 'ERR_PURCHASE_WINDOW',
  DATE: 'ERR_PURCHASE_DATE',
  MENU: 'ERR_PURCHASE_MENU',
  MEAL: 'ERR_PURCHASE_MEAL',
  ITEM: 'ERR_PURCHASE_ITEM',
  ID: 'ERR_PURCHASE_ID',
  NUTRITION: 'ERR_PURCHASE_NUTRITION',
  DEDUP: 'ERR_PURCHASE_DEDUP',
  LOCALE: 'ERR_PURCHASE_LOCALE',
  GUARDRAIL: 'ERR_PURCHASE_GUARDRAIL',
  FS: 'ERR_PURCHASE_FS',
});

/**
 * @typedef {Readonly<{code: string, field: string, hint: string}>} PurchaseIssue
 */

/** @param {string} code @param {string} field @param {string} hint */
export function purchaseIssue(code, field, hint) {
  return Object.freeze({ code, field, hint });
}

export class PurchaseError extends Error {
  /** @param {ReadonlyArray<PurchaseIssue>} issues */
  constructor(issues) {
    super(`${PURCHASE_ERROR.INVALID}: ${issues.map((i) => i.code).join(',')}`);
    this.name = 'PurchaseError';
    this.code = PURCHASE_ERROR.INVALID;
    this.issues = Object.freeze(issues.map((i) => Object.freeze({ ...i })));
  }
}
