// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-016 · 输入契约：周计划 / 剩余窗口 / 食材条目校验与聚合（plan.md §6.1）。
 *
 * FR-019～021 所需的菜品、食材生重、每 100g 营养参数、储存类别、等价替换键、
 * 价格档、前夜备餐动作**全部由上层注入的结构化菜单提供**（T-013 计划对象 +
 * 数据层菜单）；核心域零营养学常量、零内置食材表、零自然语句（P-11 / FR-041）。
 * 核心只做校验、聚合、折算与护栏，所有输出仍是未渲染的结构化对象。
 *
 * 固定键集白名单：额外键一律拒绝，防注入并防止把受版权保护的原文塞入产物。
 */
import { RX_FIELDS } from '../rx/index.js';
import { PURCHASE_ERROR, PurchaseError, purchaseIssue } from './errors.js';

export const PURCHASE_SLOTS = Object.freeze(['breakfast', 'lunch', 'dinner', 'snack']);
export const SHELF_CLASS = Object.freeze({ PERISHABLE: 'perishable', DURABLE: 'durable' });
export const WEEKLY_PATH = 'weekly-plan.md';
export const DAILY_PATH = 'daily-plan.md';
export const WEEK_DAYS = 7;
export const PREP_TIMING_KEY = 'prep.timing.previous_evening';
export const SUBSTITUTE_REASON_KEY = 'purchase.reason.substitute_equivalent';
export const TOP_UP_NOTICE_KEY = 'purchase.notice.top_up_only';
export const NOT_ESTIMATED_KEY = 'plan.notice.not_estimated';

const WEEK_PLAN_KEYS = Object.freeze([
  'level', 'period_id', 'period', 'prescription', 'guardrails',
  'locale_source', 'channel_key', 'budget_key', 'language_tag', 'menu',
]);
const WINDOW_KEYS = Object.freeze(['run_date']);
const PERIOD_KEYS = Object.freeze(['start_date', 'end_date']);
const DAY_KEYS = Object.freeze(['date', 'dedup', 'meals']);
const DEDUP_KEYS = Object.freeze(['status', 'main_id', 'staple_id']);
const MEAL_KEYS = Object.freeze(['slot', 'method_key', 'items']);
const ITEM_KEYS = Object.freeze([
  'ingredient_id', 'raw_g', 'energy_kcal_per_100g', 'protein_g_per_100g',
  'shelf_class', 'storage_key', 'substitute_ids', 'price_key', 'prep_key',
]);
const GUARDRAIL_KEYS = Object.freeze(['energy_floor_kcal', 'protein_floor_g']);
const LOCALE_SOURCES = Object.freeze(['user', 'auto:nationality', 'auto:residence', 'auto:fallback']);

const CANONICAL_ID = /^[a-z][a-z0-9._-]{0,63}$/;
const PERIOD_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const LANGUAGE_TAG = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8})*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** @param {unknown} value */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** @param {Array<import('./errors.js').PurchaseIssue>} problems */
function fail(problems) {
  if (problems.length > 0) throw new PurchaseError(problems);
}
/** @param {unknown} value */
function isCanonicalId(value) {
  return typeof value === 'string' && CANONICAL_ID.test(value);
}
/** @param {unknown} value */
export function isIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
/** @param {string} iso @param {number} days */
export function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
/** @param {unknown} value */
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}
/**
 * @param {unknown} value @param {ReadonlyArray<string>} allowed
 * @param {Array<import('./errors.js').PurchaseIssue>} problems
 * @param {string} field @param {string} code @param {string} hint
 */
function keysOk(value, allowed, problems, field, code, hint) {
  if (!isRecord(value)) {
    problems.push(purchaseIssue(code, field, hint));
    return null;
  }
  const keys = Object.keys(/** @type {Record<string, unknown>} */ (value));
  if (keys.some((k) => !allowed.includes(k)) || !allowed.every((k) => keys.includes(k))) {
    problems.push(purchaseIssue(code, field, hint));
    return null;
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * 规范化单个食材条目（固定 9 键）。
 * @param {unknown} raw @param {Array<import('./errors.js').PurchaseIssue>} problems @param {string} field
 */
function normalizeItem(raw, problems, field) {
  const r = keysOk(raw, ITEM_KEYS, problems, field, PURCHASE_ERROR.ITEM, 'action.purchase.item_keys');
  if (!r) return null;
  if (!isCanonicalId(r.ingredient_id)) {
    problems.push(purchaseIssue(PURCHASE_ERROR.ID, `${field}.ingredient_id`, 'action.purchase.canonical_id'));
  }
  if (!isFiniteNumber(r.raw_g) || /** @type {number} */ (r.raw_g) <= 0) {
    problems.push(purchaseIssue(PURCHASE_ERROR.NUTRITION, `${field}.raw_g`, 'action.purchase.raw_weight'));
  }
  for (const key of ['energy_kcal_per_100g', 'protein_g_per_100g']) {
    if (!isFiniteNumber(r[key]) || /** @type {number} */ (r[key]) < 0) {
      problems.push(purchaseIssue(PURCHASE_ERROR.NUTRITION, `${field}.${key}`, 'action.purchase.per_100g'));
    }
  }
  if (!Object.values(SHELF_CLASS).includes(/** @type {string} */ (r.shelf_class))) {
    problems.push(purchaseIssue(PURCHASE_ERROR.ITEM, `${field}.shelf_class`, 'action.purchase.shelf_class'));
  }
  if (!isCanonicalId(r.storage_key) || !isCanonicalId(r.price_key)) {
    problems.push(purchaseIssue(PURCHASE_ERROR.ID, `${field}.storage_key`, 'action.purchase.canonical_id'));
  }
  if (r.prep_key !== null && !isCanonicalId(r.prep_key)) {
    problems.push(purchaseIssue(PURCHASE_ERROR.ID, `${field}.prep_key`, 'action.purchase.canonical_id'));
  }
  const subs = r.substitute_ids;
  if (!Array.isArray(subs) || subs.some((s) => !isCanonicalId(s)) || subs.includes(r.ingredient_id)) {
    problems.push(purchaseIssue(PURCHASE_ERROR.ID, `${field}.substitute_ids`, 'action.purchase.substitutes'));
  }
  return Object.freeze({
    ingredient_id: r.ingredient_id,
    raw_g: r.raw_g,
    energy_kcal_per_100g: r.energy_kcal_per_100g,
    protein_g_per_100g: r.protein_g_per_100g,
    shelf_class: r.shelf_class,
    storage_key: r.storage_key,
    substitute_ids: Object.freeze(Array.isArray(subs) ? [...subs] : []),
    price_key: r.price_key,
    prep_key: r.prep_key ?? null,
  });
}

/** @param {unknown} raw @param {Array<import('./errors.js').PurchaseIssue>} problems @param {string} field */
function normalizeMeals(raw, problems, field) {
  if (!Array.isArray(raw) || raw.length !== PURCHASE_SLOTS.length) {
    problems.push(purchaseIssue(PURCHASE_ERROR.MEAL, field, 'action.purchase.meal_count'));
    return Object.freeze([]);
  }
  const meals = [];
  raw.forEach((meal, index) => {
    const at = `${field}[${index}]`;
    const m = keysOk(meal, MEAL_KEYS, problems, at, PURCHASE_ERROR.MEAL, 'action.purchase.meal_keys');
    if (!m) return;
    if (m.slot !== PURCHASE_SLOTS[index]) {
      problems.push(purchaseIssue(PURCHASE_ERROR.MEAL, `${at}.slot`, 'action.purchase.meal_slot'));
    }
    if (!isCanonicalId(m.method_key)) {
      problems.push(purchaseIssue(PURCHASE_ERROR.ID, `${at}.method_key`, 'action.purchase.canonical_id'));
    }
    if (!Array.isArray(m.items) || m.items.length === 0) {
      problems.push(purchaseIssue(PURCHASE_ERROR.ITEM, `${at}.items`, 'action.purchase.item_count'));
      return;
    }
    const items = m.items.map((it, i) => normalizeItem(it, problems, `${at}.items[${i}]`));
    meals.push(Object.freeze({
      slot: m.slot,
      method_key: m.method_key,
      items: Object.freeze(items.filter(Boolean)),
    }));
  });
  return Object.freeze(meals);
}

/** @param {unknown} raw @param {Array<import('./errors.js').PurchaseIssue>} problems @param {string} field */
export function normalizeDay(raw, problems, field) {
  const d = keysOk(raw, DAY_KEYS, problems, field, PURCHASE_ERROR.MENU, 'action.purchase.day_keys');
  if (!d) return null;
  if (!isIsoDate(d.date)) {
    problems.push(purchaseIssue(PURCHASE_ERROR.DATE, `${field}.date`, 'action.purchase.date'));
  }
  const dedup = keysOk(d.dedup, DEDUP_KEYS, problems, `${field}.dedup`, PURCHASE_ERROR.DEDUP, 'action.purchase.dedup_object');
  if (dedup) {
    if (dedup.status !== 'accepted') {
      problems.push(purchaseIssue(PURCHASE_ERROR.DEDUP, `${field}.dedup.status`, 'action.purchase.dedup_status'));
    }
    if (!isCanonicalId(dedup.main_id) || !isCanonicalId(dedup.staple_id)) {
      problems.push(purchaseIssue(PURCHASE_ERROR.ID, `${field}.dedup`, 'action.purchase.canonical_id'));
    }
  }
  const meals = normalizeMeals(d.meals, problems, `${field}.meals`);
  return Object.freeze({
    date: d.date,
    dedup: dedup ? Object.freeze({ ...dedup }) : null,
    meals,
  });
}

/** 周计划顶层校验与规范化（T-013 计划对象 + 注入菜单 / 渠道 / 预算）。 */
export function validateWeekPlan(raw) {
  /** @type {Array<import('./errors.js').PurchaseIssue>} */
  const problems = [];
  const w = keysOk(raw, WEEK_PLAN_KEYS, problems, '(weekPlan)', PURCHASE_ERROR.WEEK_PLAN, 'action.purchase.week_plan_keys');
  if (!w) fail(problems);
  const record = /** @type {Record<string, unknown>} */ (w);
  if (record.level !== 'week') {
    problems.push(purchaseIssue(PURCHASE_ERROR.WEEK_PLAN, '(weekPlan).level', 'action.purchase.week_level'));
  }
  if (typeof record.period_id !== 'string' || !PERIOD_ID.test(record.period_id)) {
    problems.push(purchaseIssue(PURCHASE_ERROR.ID, '(weekPlan).period_id', 'action.purchase.period_id'));
  }
  const period = keysOk(record.period, PERIOD_KEYS, problems, '(weekPlan).period', PURCHASE_ERROR.DATE, 'action.purchase.period_keys');
  if (period) {
    if (!isIsoDate(period.start_date) || !isIsoDate(period.end_date)) {
      problems.push(purchaseIssue(PURCHASE_ERROR.DATE, '(weekPlan).period', 'action.purchase.date'));
    } else if (addDays(/** @type {string} */ (period.start_date), WEEK_DAYS - 1)
      !== period.end_date) {
      problems.push(purchaseIssue(PURCHASE_ERROR.DATE, '(weekPlan).period', 'action.purchase.period_span'));
    }
  }

  const rx = record.prescription;
  if (!isRecord(rx) || Object.keys(rx).length !== RX_FIELDS.length) {
    problems.push(purchaseIssue(PURCHASE_ERROR.NUTRITION, '(weekPlan).prescription', 'action.purchase.prescription'));
  } else {
    for (const field of RX_FIELDS) {
      const range = /** @type {Record<string, unknown>} */ (rx)[field];
      if (!Array.isArray(range) || range.length !== 2
        || !isFiniteNumber(range[0]) || !isFiniteNumber(range[1]) || range[0] > range[1]) {
        problems.push(purchaseIssue(PURCHASE_ERROR.NUTRITION, `(weekPlan).prescription.${field}`, 'action.purchase.prescription_range'));
      }
    }
  }
  const gr = keysOk(record.guardrails, GUARDRAIL_KEYS, problems, '(weekPlan).guardrails', PURCHASE_ERROR.NUTRITION, 'action.purchase.guardrails');
  if (gr) {
    for (const key of GUARDRAIL_KEYS) {
      if (!isFiniteNumber(gr[key]) || /** @type {number} */ (gr[key]) < 0) {
        problems.push(purchaseIssue(PURCHASE_ERROR.NUTRITION, `(weekPlan).guardrails.${key}`, 'action.purchase.guardrail_value'));
      }
    }
  }
  if (!LOCALE_SOURCES.includes(/** @type {string} */ (record.locale_source))) {
    problems.push(purchaseIssue(PURCHASE_ERROR.LOCALE, '(weekPlan).locale_source', 'action.purchase.locale_source'));
  }
  if (!isCanonicalId(record.channel_key) || !isCanonicalId(record.budget_key)) {
    problems.push(purchaseIssue(PURCHASE_ERROR.ID, '(weekPlan).channel', 'action.purchase.canonical_id'));
  }
  if (typeof record.language_tag !== 'string' || !LANGUAGE_TAG.test(record.language_tag)) {
    problems.push(purchaseIssue(PURCHASE_ERROR.ID, '(weekPlan).language_tag', 'action.purchase.language_tag'));
  }
  if (!Array.isArray(record.menu) || record.menu.length !== WEEK_DAYS) {
    problems.push(purchaseIssue(PURCHASE_ERROR.MENU, '(weekPlan).menu', 'action.purchase.menu_count'));
  }

  /** @type {Array<ReturnType<typeof normalizeDay>>} */
  const days = [];
  if (Array.isArray(record.menu)) {
    record.menu.forEach((day, i) => {
      const normalized = normalizeDay(day, problems, `(weekPlan).menu[${i}]`);
      if (!normalized) return;
      days.push(normalized);
      if (period && isIsoDate(period.start_date)
        && normalized.date !== addDays(/** @type {string} */ (period.start_date), i)) {
        problems.push(purchaseIssue(PURCHASE_ERROR.DATE, `(weekPlan).menu[${i}].date`, 'action.purchase.menu_date'));
      }
    });
  }
  fail(problems);
  return Object.freeze({
    level: 'week',
    period_id: record.period_id,
    period: Object.freeze({ start_date: period.start_date, end_date: period.end_date }),
    prescription: Object.freeze(Object.fromEntries(RX_FIELDS.map((k) => [k, Object.freeze([.../** @type {Array<number>} */ (/** @type {Record<string, unknown>} */ (rx)[k])])]))),
    guardrails: Object.freeze({ ...gr }),
    locale_source: record.locale_source,
    channel_key: record.channel_key,
    budget_key: record.budget_key,
    language_tag: record.language_tag,
    menu: Object.freeze(days),
  });
}

/** 剩余窗口固定键集只有 run_date；剩余日期由周计划按 P-05 推导，不可注入放宽。 */
export function validateRemainingWindow(raw) {
  /** @type {Array<import('./errors.js').PurchaseIssue>} */
  const problems = [];
  const w = keysOk(raw, WINDOW_KEYS, problems, '(remainingWindow)', PURCHASE_ERROR.WINDOW, 'action.purchase.window_keys');
  if (!w) fail(problems);
  if (!isIsoDate(w.run_date)) {
    problems.push(purchaseIssue(PURCHASE_ERROR.DATE, '(remainingWindow).run_date', 'action.purchase.date'));
  }
  fail(problems);
  return Object.freeze({ run_date: /** @type {string} */ (w.run_date) });
}

/** 单日入口的输入校验（buildDailyPlan 用）。 */
export function validateDay(raw) {
  /** @type {Array<import('./errors.js').PurchaseIssue>} */
  const problems = [];
  const day = normalizeDay(raw, problems, '(day)');
  fail(problems);
  return day;
}

/** buildPurchasePlan 输出的必要键，供 buildDailyPlan 独立取证。 */
export function validatePurchasePlan(raw) {
  const needed = [
    'period_id', 'start_date', 'end_date', 'run_date',
    'remaining_dates', 'past_dates', 'theoretical', 'actual',
    'batches', 'substitutes', 'channel', 'prescription', 'guardrails', 'notice_keys',
  ];
  if (!isRecord(raw) || needed.some((k) => !Object.hasOwn(/** @type {object} */ (raw), k))) {
    throw new PurchaseError([
      purchaseIssue(PURCHASE_ERROR.WEEK_PLAN, '(purchasePlan)', 'action.purchase.plan_object'),
    ]);
  }
  return /** @type {Record<string, any>} */ (raw);
}

/** @param {ReadonlyArray<any>} days */
export function aggregateItems(days) {
  /** @type {Map<string, any>} */
  const map = new Map();
  for (const day of days) {
    for (const meal of day.meals) {
      for (const item of meal.items) {
        const id = item.ingredient_id;
        const existing = map.get(id);
        if (!existing) {
          map.set(id, {
            ...item,
            raw_g: item.raw_g,
            substitute_ids: new Set(item.substitute_ids),
            per_date: new Map([[day.date, item.raw_g]]),
          });
          continue;
        }
        const stable = ['energy_kcal_per_100g', 'protein_g_per_100g', 'shelf_class', 'storage_key', 'price_key', 'prep_key'];
        if (stable.some((k) => existing[k] !== item[k])) {
          throw new PurchaseError([
            purchaseIssue(PURCHASE_ERROR.ITEM, `(aggregate).${id}`, 'action.purchase.item_inconsistent'),
          ]);
        }
        existing.raw_g += item.raw_g;
        for (const s of item.substitute_ids) existing.substitute_ids.add(s);
        existing.per_date.set(day.date, (existing.per_date.get(day.date) ?? 0) + item.raw_g);
      }
    }
  }
  return Object.freeze([...map.entries()].map(([id, e]) => Object.freeze({
    ingredient_id: id,
    raw_g: e.raw_g,
    energy_kcal_per_100g: e.energy_kcal_per_100g,
    protein_g_per_100g: e.protein_g_per_100g,
    energy_kcal: e.raw_g * e.energy_kcal_per_100g / 100,
    protein_g: e.raw_g * e.protein_g_per_100g / 100,
    shelf_class: e.shelf_class,
    storage_key: e.storage_key,
    price_key: e.price_key,
    prep_key: e.prep_key,
    substitute_ids: Object.freeze([...e.substitute_ids].sort()),
    per_date: Object.freeze(Object.fromEntries([...e.per_date.entries()].sort())),
  })).sort((a, b) => a.ingredient_id.localeCompare(b.ingredient_id)));
}

/** @param {ReadonlyArray<any>} items */
export function totalsOf(items) {
  return Object.freeze({
    raw_g: items.reduce((n, x) => n + x.raw_g, 0),
    energy_kcal: items.reduce((n, x) => n + (x.energy_kcal ?? 0), 0),
    protein_g: items.reduce((n, x) => n + (x.protein_g ?? 0), 0),
    item_count: items.length,
  });
}
