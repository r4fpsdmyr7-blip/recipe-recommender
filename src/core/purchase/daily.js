// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-016 · 日计划四餐明细与执行清单（FR-020 / FR-021 / AC-03）。
 *
 * 四餐（早/午/晚/加餐）给出生重克数、做法要点 Canonical ID、估算热量与蛋白，
 * 并输出全天合计与九项处方对照表；仅 `energy_kcal` / `protein_g` 有注入数据可估算，
 * 其余字段显式标 `plan.notice.not_estimated`，**不编造数值**（P-11 / FR-041）。
 *
 * 「补购缺口」只列当日易腐品（耐储品已在窗口首日买齐），不重复整周清单（FR-020）；
 * 前夜备餐按 `prep_key` 聚合。BMR / 蛋白保肌下限作为硬护栏（§9 不变式 1）。
 *
 * 纯函数：零 IO；自然语言「做法要点」由 T-018 / T-031 渲染。
 */
import { RX_FIELDS } from '../rx/index.js';
import { PURCHASE_ERROR, PurchaseError, purchaseIssue } from './errors.js';
import {
  PURCHASE_SLOTS,
  SHELF_CLASS,
  PREP_TIMING_KEY,
  TOP_UP_NOTICE_KEY,
  NOT_ESTIMATED_KEY,
  validateDay,
  validatePurchasePlan,
  totalsOf,
} from './contract.js';

const DAILY_NOTICE_KEYS = Object.freeze([
  'plan.notice.disclaimer',
  'plan.notice.estimated',
  'plan.marker.aigc',
]);

/** @param {ReadonlyArray<any>} items */
function prepListOf(items) {
  /** @type {Map<string, Set<string>>} */
  const groups = new Map();
  for (const item of items) {
    if (!item.prep_key) continue;
    if (!groups.has(item.prep_key)) groups.set(item.prep_key, new Set());
    /** @type {Set<string>} */ (groups.get(item.prep_key)).add(item.ingredient_id);
  }
  return Object.freeze([...groups.entries()].sort().map(([prep_key, ids]) => Object.freeze({
    prep_key,
    ingredient_ids: Object.freeze([...ids].sort()),
    timing_key: PREP_TIMING_KEY,
  })));
}

/**
 * @param {unknown} day 周计划中的一天（date / dedup / meals）
 * @param {unknown} purchasePlan buildPurchasePlan 的输出
 */
export function buildDailyPlan(day, purchasePlan) {
  const d = validateDay(day);
  const p = validatePurchasePlan(purchasePlan);
  if (d.date <= p.run_date || !p.remaining_dates.includes(d.date)) {
    throw new PurchaseError([
      purchaseIssue(PURCHASE_ERROR.WINDOW, '(day).date', 'action.purchase.timeline_historical'),
    ]);
  }

  const meals = Object.freeze(d.meals.map((meal) => {
    const items = Object.freeze(meal.items.map((it) => Object.freeze({
      ...it,
      energy_kcal: it.raw_g * it.energy_kcal_per_100g / 100,
      protein_g: it.raw_g * it.protein_g_per_100g / 100,
    })));
    const totals = totalsOf(items);
    return Object.freeze({
      slot: meal.slot,
      method_key: meal.method_key,
      items,
      raw_g: totals.raw_g,
      energy_kcal: totals.energy_kcal,
      protein_g: totals.protein_g,
    });
  }));
  if (meals.length !== PURCHASE_SLOTS.length) {
    throw new PurchaseError([
      purchaseIssue(PURCHASE_ERROR.MEAL, '(day).meals', 'action.purchase.meal_count'),
    ]);
  }
  const allItems = Object.freeze(meals.flatMap((m) => [...m.items]));
  const totals = totalsOf(allItems);

  // §9 不变式 1：任一计划的总能量 ≥ BMR、蛋白 ≥ 保肌下限。
  if (totals.energy_kcal < p.guardrails.energy_floor_kcal
    || totals.protein_g < p.guardrails.protein_floor_g) {
    throw new PurchaseError([
      purchaseIssue(PURCHASE_ERROR.GUARDRAIL, '(day).totals', 'action.purchase.guardrail_floor'),
    ]);
  }

  const rxComparison = Object.freeze(RX_FIELDS.map((field) => {
    const range = /** @type {ReadonlyArray<number>} */ (p.prescription[field]);
    const estimated = field === 'energy_kcal' ? totals.energy_kcal
      : field === 'protein_g' ? totals.protein_g : null;
    return Object.freeze({
      field,
      prescribed: Object.freeze([...range]),
      estimated,
      compliant: estimated === null ? null : (estimated >= range[0] && estimated <= range[1]),
      notice_key: estimated === null ? NOT_ESTIMATED_KEY : null,
    });
  }));

  // FR-020：只列周采购计划的缺口 —— 当日易腐品；耐储品不重复整周清单。
  const topUpItems = Object.freeze(allItems.filter((it) => it.shelf_class === SHELF_CLASS.PERISHABLE));
  const topUp = Object.freeze({
    items: topUpItems,
    totals: totalsOf(topUpItems),
    notice_keys: Object.freeze([TOP_UP_NOTICE_KEY]),
  });

  return Object.freeze({
    level: 'day',
    date: d.date,
    run_date: p.run_date,
    meals,
    totals,
    rx_comparison: rxComparison,
    top_up: topUp,
    prep_list: prepListOf(allItems),
    notice_keys: DAILY_NOTICE_KEYS,
  });
}
