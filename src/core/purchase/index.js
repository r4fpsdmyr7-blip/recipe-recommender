// SPDX-License-Identifier: GPL-3.0-only
/** 核心域「两栏采购计划、四餐明细与工作区索引」统一出口（plan.md §4 / §6.1 / FR-019～021）。 */

export { PURCHASE_ERROR, PurchaseError, purchaseIssue } from './errors.js';
export {
  PURCHASE_SLOTS,
  SHELF_CLASS,
  WEEKLY_PATH,
  DAILY_PATH,
  WEEK_DAYS,
  PREP_TIMING_KEY,
  SUBSTITUTE_REASON_KEY,
  TOP_UP_NOTICE_KEY,
  NOT_ESTIMATED_KEY,
  isIsoDate,
  addDays,
  normalizeDay,
  validateWeekPlan,
  validateRemainingWindow,
  validateDay,
  validatePurchasePlan,
  aggregateItems,
  totalsOf,
} from './contract.js';
export { buildPurchasePlan } from './purchase.js';
export { buildDailyPlan } from './daily.js';
export {
  renderWeeklyIndex,
  renderDailyIndex,
  writeWeeklyPlan,
  writeDailyPlan,
} from './workspace.js';
