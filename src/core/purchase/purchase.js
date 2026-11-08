// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-016 · `buildPurchasePlan(weekPlan, remainingWindow)`（FR-010 / FR-019 / FR-020 / AC-09）。
 *
 * 两栏口径：`theoretical` 汇总整周 7 天，`actual` 只汇总 `date > run_date` 的
 * **剩余执行窗口**，绝不覆盖已过去日期的食材（FR-010 / AC-09 / P-05）。
 *
 * 分批采购日：耐储品在窗口首日一批买齐；易腐品按剩余窗口逐日分批，
 * 建议采购日 = 使用当日。储存方式 / 缺货等价替换 / 渠道与预算参考 /
 * 备餐建议全部来自注入的菜单数据，核心只做分组与透传（E-06 / FR-041）。
 *
 * 纯函数：不触碰 FsPort / ClockPort / NetPort；工作区文件落盘在 workspace.js。
 */
import { PURCHASE_ERROR, PurchaseError, purchaseIssue } from './errors.js';
import {
  SHELF_CLASS,
  SUBSTITUTE_REASON_KEY,
  validateWeekPlan,
  validateRemainingWindow,
  aggregateItems,
  totalsOf,
} from './contract.js';

const BASE_NOTICE_KEYS = Object.freeze([
  'plan.notice.disclaimer',
  'plan.notice.estimated',
  'plan.marker.aigc',
]);

/** @param {ReadonlyArray<any>} days */
function columnOf(days) {
  const items = aggregateItems(days);
  return Object.freeze({
    dates: Object.freeze(days.map((d) => d.date)),
    items,
    totals: totalsOf(items),
  });
}

/**
 * @param {string} batchId @param {string} shelfClass @param {string} purchaseDate
 * @param {ReadonlyArray<any>} items
 */
function batchOf(batchId, shelfClass, purchaseDate, items) {
  return Object.freeze({
    batch_id: batchId,
    shelf_class: shelfClass,
    purchase_date: purchaseDate,
    items: Object.freeze(items.map((i) => Object.freeze({ ...i }))),
    total_raw_g: totalsOf(items).raw_g,
    storage_keys: Object.freeze([...new Set(items.map((i) => i.storage_key))].sort()),
  });
}

/** @param {any} actual @param {ReadonlyArray<string>} remainingDates */
function batchesOf(actual, remainingDates) {
  if (remainingDates.length === 0) return Object.freeze([]);
  const batches = [];
  const durable = actual.items.filter((i) => i.shelf_class === SHELF_CLASS.DURABLE);
  const perishable = actual.items.filter((i) => i.shelf_class === SHELF_CLASS.PERISHABLE);
  if (durable.length > 0) {
    batches.push(batchOf('batch.durable', SHELF_CLASS.DURABLE, remainingDates[0], durable));
  }
  for (const date of remainingDates) {
    const items = perishable
      .map((i) => {
        const raw = i.per_date[date] ?? 0;
        return {
          ...i,
          raw_g: raw,
          energy_kcal: raw * i.energy_kcal_per_100g / 100,
          protein_g: raw * i.protein_g_per_100g / 100,
        };
      })
      .filter((i) => i.raw_g > 0);
    if (items.length > 0) {
      batches.push(batchOf(`batch.perishable.${date}`, SHELF_CLASS.PERISHABLE, date, items));
    }
  }
  return Object.freeze(batches);
}

/** 预算参考只做价格档计数，不编造货币金额（P-11 / FR-041）。 */
function priceBandsOf(items) {
  /** @type {Record<string, number>} */
  const bands = {};
  for (const item of items) bands[item.price_key] = (bands[item.price_key] ?? 0) + 1;
  return Object.freeze(Object.fromEntries(Object.entries(bands).sort()));
}

/** @param {ReadonlyArray<any>} menu @param {string} runDate */
function prepNotesOf(menu, runDate) {
  /** @type {Map<string, {date: string, ids: Set<string>}>} */
  const groups = new Map();
  for (const day of menu) {
    if (day.date <= runDate) continue;
    for (const meal of day.meals) {
      for (const item of meal.items) {
        if (!item.prep_key) continue;
        const key = `${item.prep_key}|${day.date}`;
        if (!groups.has(key)) groups.set(key, { date: day.date, ids: new Set() });
        /** @type {{date: string, ids: Set<string>}} */ (groups.get(key)).ids.add(item.ingredient_id);
      }
    }
  }
  return Object.freeze([...groups.entries()].sort().map(([key, group]) => Object.freeze({
    prep_key: key.split('|')[0],
    date: group.date,
    ingredient_ids: Object.freeze([...group.ids].sort()),
  })));
}

/**
 * 周计划 → 两栏采购计划。
 * @param {unknown} weekPlan T-013 计划对象 + 注入菜单 / 渠道 / 预算（见 contract.js）
 * @param {{run_date: string}} remainingWindow 运行日；剩余日期由 P-05 推导，不可注入
 */
export function buildPurchasePlan(weekPlan, remainingWindow) {
  const wp = validateWeekPlan(weekPlan);
  const w = validateRemainingWindow(remainingWindow);
  const allDates = wp.menu.map((d) => d.date);
  const remaining = Object.freeze(allDates.filter((d) => d > w.run_date));
  const past = Object.freeze(allDates.filter((d) => d <= w.run_date));

  const theoretical = columnOf(wp.menu);
  const actual = columnOf(wp.menu.filter((d) => d.date > w.run_date));
  const batches = batchesOf(actual, remaining);
  const substitutes = Object.freeze(theoretical.items
    .filter((i) => i.substitute_ids.length > 0)
    .map((i) => Object.freeze({
      ingredient_id: i.ingredient_id,
      substitute_ids: i.substitute_ids,
      reason_key: SUBSTITUTE_REASON_KEY,
    })));
  const prepNotes = prepNotesOf(wp.menu, w.run_date);

  if (remaining.length > 0 && batches.length === 0) {
    throw new PurchaseError([
      purchaseIssue(PURCHASE_ERROR.ITEM, '(batches)', 'action.purchase.batch_missing'),
    ]);
  }

  return Object.freeze({
    level: 'week',
    period_id: wp.period_id,
    start_date: wp.period.start_date,
    end_date: wp.period.end_date,
    run_date: w.run_date,
    remaining_dates: remaining,
    past_dates: past,
    theoretical,
    actual,
    batches,
    substitutes,
    channel: Object.freeze({
      channel_key: wp.channel_key,
      budget_key: wp.budget_key,
      locale_source: wp.locale_source,
      price_bands: priceBandsOf(theoretical.items),
    }),
    prep_notes: prepNotes,
    prescription: wp.prescription,
    guardrails: wp.guardrails,
    notice_keys: BASE_NOTICE_KEYS,
  });
}
