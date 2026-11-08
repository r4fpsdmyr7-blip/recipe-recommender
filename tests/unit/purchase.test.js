// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-016 · 两栏采购计划、四餐明细与工作区索引单元测试（ATDD 红→绿）。
 *
 * 验收口径：tasks.md T-016；SPEC.md FR-010、FR-019～021、FR-027、FR-041、
 * FR-044、FR-049、AC-03、AC-09、SC-002、E-05 / E-06、§9 不变式 1/3、
 * P-05 / P-11 / P-12 / P-14；plan.md §5.3 / §6.1 / §7.2 / §9。
 *
 * 全部食材 / 做法 / 渠道 / 价格档均为合成 Canonical ID 与中立量化参数，
 * 不含真实菜谱、自然语言、身体数据或 diet-plan/ 内容（P-11 / P-14）。
 * 工作区索引用注入的 createMemoryFs 替身，测试零磁盘写入、零网络请求。
 *
 * 本文件不改变 AC 红态基线（AC-03 / AC-09 仍为 RED：完整 Markdown 渲染与
 * 端到端调度归 T-018 / T-019）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemoryFs } from '../fixtures/index.js';
import { RX_FIELDS } from '../../src/core/rx/index.js';
import {
  PURCHASE_ERROR,
  PurchaseError,
  PURCHASE_SLOTS,
  SHELF_CLASS,
  WEEKLY_PATH,
  DAILY_PATH,
  validateWeekPlan,
  validateRemainingWindow,
  buildPurchasePlan,
  buildDailyPlan,
  renderWeeklyIndex,
  renderDailyIndex,
  writeWeeklyPlan,
  writeDailyPlan,
} from '../../src/core/purchase/index.js';

const isPurchaseError = (v) => v instanceof PurchaseError;
const noChinese = (v) => !/[\u4e00-\u9fff]/.test(JSON.stringify(v));
const pad2 = (n) => String(n).padStart(2, '0');

/** 合成食材参数：每 100g 热量 / 蛋白为项目自撰中立量，不是任何指南原文。 */
const PANTRY = Object.freeze([
  { ingredient_id: 'ing.oats', raw_g: 80, energy_kcal_per_100g: 389, protein_g_per_100g: 16.9, shelf_class: 'durable', storage_key: 'storage.pantry', substitute_ids: [], price_key: 'price.low', prep_key: null },
  { ingredient_id: 'ing.milk', raw_g: 200, energy_kcal_per_100g: 54, protein_g_per_100g: 3.3, shelf_class: 'perishable', storage_key: 'storage.chilled', substitute_ids: ['ing.yogurt'], price_key: 'price.mid', prep_key: 'prep.chill' },
  { ingredient_id: 'ing.chicken', raw_g: 150, energy_kcal_per_100g: 165, protein_g_per_100g: 31, shelf_class: 'perishable', storage_key: 'storage.chilled', substitute_ids: ['ing.turkey'], price_key: 'price.high', prep_key: 'prep.marinate' },
  { ingredient_id: 'ing.rice_brown', raw_g: 150, energy_kcal_per_100g: 111, protein_g_per_100g: 2.6, shelf_class: 'durable', storage_key: 'storage.pantry', substitute_ids: [], price_key: 'price.low', prep_key: null },
  { ingredient_id: 'ing.radish', raw_g: 150, energy_kcal_per_100g: 21, protein_g_per_100g: 0.9, shelf_class: 'perishable', storage_key: 'storage.chilled', substitute_ids: ['ing.turnip'], price_key: 'price.low', prep_key: 'prep.wash_cut' },
  { ingredient_id: 'ing.seabass', raw_g: 150, energy_kcal_per_100g: 105, protein_g_per_100g: 20, shelf_class: 'perishable', storage_key: 'storage.chilled', substitute_ids: ['ing.cod'], price_key: 'price.high', prep_key: 'prep.thaw' },
  { ingredient_id: 'ing.greens', raw_g: 200, energy_kcal_per_100g: 25, protein_g_per_100g: 2, shelf_class: 'perishable', storage_key: 'storage.chilled', substitute_ids: ['ing.spinach'], price_key: 'price.low', prep_key: 'prep.wash' },
  { ingredient_id: 'ing.yogurt', raw_g: 150, energy_kcal_per_100g: 72, protein_g_per_100g: 4, shelf_class: 'perishable', storage_key: 'storage.chilled', substitute_ids: ['ing.milk'], price_key: 'price.mid', prep_key: null },
  { ingredient_id: 'ing.apple', raw_g: 150, energy_kcal_per_100g: 52, protein_g_per_100g: 0.3, shelf_class: 'durable', storage_key: 'storage.cool', substitute_ids: ['ing.pear'], price_key: 'price.low', prep_key: null },
  { ingredient_id: 'ing.oil_olive', raw_g: 25, energy_kcal_per_100g: 884, protein_g_per_100g: 0, shelf_class: 'durable', storage_key: 'storage.pantry', substitute_ids: [], price_key: 'price.mid', prep_key: null },
]);

const MEALS = Object.freeze([
  { slot: 'breakfast', method_key: 'method.porridge', items: [PANTRY[0], PANTRY[1]] },
  { slot: 'lunch', method_key: 'method.stew', items: [PANTRY[2], PANTRY[3], PANTRY[4], PANTRY[9]] },
  { slot: 'dinner', method_key: 'method.steam', items: [PANTRY[5], PANTRY[6]] },
  { slot: 'snack', method_key: 'method.raw', items: [PANTRY[7], PANTRY[8]] },
]);

const PRESCRIPTION = Object.freeze({
  energy_kcal: [1400, 1700], protein_g: [90, 120], fat_g: [40, 70],
  carb_g: [150, 250], fiber_g: [25, 30], water_ml: [1800, 2300],
  salt_g: [0, 4.5], oil_g: [25, 30], added_sugar_g: [0, 20],
});
const GUARDRAILS = Object.freeze({ energy_floor_kcal: 1450, protein_floor_g: 78 });

const DATES = Array.from({ length: 7 }, (_, i) => `2026-11-${pad2(2 + i)}`);

function weekPlan(overrides = {}) {
  return {
    level: 'week',
    period_id: '2026-W45',
    period: { start_date: DATES[0], end_date: DATES[6] },
    prescription: { ...PRESCRIPTION },
    guardrails: { ...GUARDRAILS },
    locale_source: 'user',
    channel_key: 'channel.local_market',
    budget_key: 'budget.moderate',
    language_tag: 'zh-CN',
    menu: DATES.map((date, i) => ({
      date,
      dedup: { status: 'accepted', main_id: `dish.day_${pad2(i + 1)}`, staple_id: `staple.day_${pad2(i + 1)}` },
      meals: MEALS.map((m) => ({ ...m, items: m.items.map((it) => ({ ...it })) })),
    })),
    ...overrides,
  };
}

const FRIDAY = { run_date: '2026-11-06' };
const SUNDAY = { run_date: '2026-11-01' };

/** @param {Array<{raw_g: number}>} items */
const sumRaw = (items) => items.reduce((n, x) => n + x.raw_g, 0);
const dayRaw = () => sumRaw(PANTRY);

/**
 * 让 7 天的同一食材都带同一处缺陷，避免 aggregateItems 的「跨日参数一致性」
 * 检查把单条食材自身的校验掩盖掉（负向探针 NEG-06 / NEG-07 的独立取证）。
 * @param {Record<string, unknown>} patch
 */
const uniformBadItem = (patch) => {
  const wp = weekPlan();
  return {
    ...wp,
    menu: wp.menu.map((d) => ({
      ...d,
      meals: d.meals.map((m) => ({
        ...m,
        items: m.items.map((it) => it.ingredient_id === 'ing.oats' ? { ...it, ...patch } : { ...it }),
      })),
    })),
  };
};

// ---- 基础契约 ----

test('T-016 · 常量契约：四餐 / 两类储存 / 工作区路径（FR-019～021）', () => {
  assert.deepEqual([...PURCHASE_SLOTS], ['breakfast', 'lunch', 'dinner', 'snack']);
  assert.equal(SHELF_CLASS.PERISHABLE, 'perishable');
  assert.equal(SHELF_CLASS.DURABLE, 'durable');
  assert.equal(WEEKLY_PATH, 'weekly-plan.md');
  assert.equal(DAILY_PATH, 'daily-plan.md');
  assert.equal(RX_FIELDS.length, 9);
});

test('T-016 · weekPlan / remainingWindow 固定键集白名单，额外键一律拒绝（FR-041）', () => {
  assert.doesNotThrow(() => validateWeekPlan(weekPlan()));
  assert.doesNotThrow(() => validateRemainingWindow(FRIDAY));
  assert.throws(() => validateWeekPlan({ ...weekPlan(), extra: 1 }), isPurchaseError);
  assert.throws(() => validateRemainingWindow({ run_date: '2026-11-06', dates: [] }), isPurchaseError);
  assert.throws(() => validateRemainingWindow({}), isPurchaseError);
});

// ---- AC-09 两栏采购计划 ----

test('T-016 · AC-09：周五补跑给出全周理论用量与剩余窗口实际补购量两栏', () => {
  const plan = buildPurchasePlan(weekPlan(), FRIDAY);
  assert.equal(plan.period_id, '2026-W45');
  assert.equal(plan.run_date, '2026-11-06');
  assert.deepEqual([...plan.remaining_dates], ['2026-11-07', '2026-11-08']);
  assert.equal(plan.theoretical.totals.raw_g, 7 * dayRaw());
  assert.equal(plan.actual.totals.raw_g, 2 * dayRaw());
  assert.ok(plan.actual.totals.raw_g < plan.theoretical.totals.raw_g);
  assert.ok(noChinese(plan));
});

test('T-016 · 实际补购量只汇总未来日期，绝不覆盖已过去日期（FR-010 / AC-09）', () => {
  const plan = buildPurchasePlan(weekPlan(), FRIDAY);
  assert.deepEqual([...plan.past_dates], DATES.slice(0, 5));
  assert.ok(plan.actual.items.every((it) => it.raw_g > 0));
  assert.equal(plan.actual.dates.length, 2);
  assert.ok(plan.actual.dates.every((d) => d > plan.run_date));
});

test('T-016 · 周一生成整周时两栏数量一致，且守恒可复算（FR-010 / SC-002）', () => {
  const plan = buildPurchasePlan(weekPlan(), SUNDAY);
  assert.equal(plan.remaining_dates.length, 7);
  assert.equal(plan.actual.totals.raw_g, plan.theoretical.totals.raw_g);
  assert.equal(plan.theoretical.totals.raw_g - plan.actual.totals.raw_g - sumRaw([]), 0);
});

test('T-016 · 两栏按 ingredient_id 聚合，同一食材不出现重复行（FR-019）', () => {
  const plan = buildPurchasePlan(weekPlan(), FRIDAY);
  for (const column of [plan.theoretical, plan.actual]) {
    const ids = column.items.map((it) => it.ingredient_id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ids.length, PANTRY.length);
    assert.equal(sumRaw(column.items), column.totals.raw_g);
  }
  const oats = plan.theoretical.items.find((it) => it.ingredient_id === 'ing.oats');
  assert.equal(oats.raw_g, 7 * 80);
  assert.ok(Math.abs(oats.energy_kcal - 7 * 80 * 389 / 100) < 1e-9);
});

// ---- FR-019 分批 / 储存 / 替换 / 渠道预算 / 备餐 ----

test('T-016 · 分批采购日：耐储一批、易腐按剩余日分批（FR-019 / AC-09）', () => {
  const plan = buildPurchasePlan(weekPlan(), FRIDAY);
  const durable = plan.batches.filter((b) => b.shelf_class === SHELF_CLASS.DURABLE);
  const perishable = plan.batches.filter((b) => b.shelf_class === SHELF_CLASS.PERISHABLE);
  assert.equal(durable.length, 1);
  assert.equal(durable[0].purchase_date, '2026-11-07');
  assert.equal(perishable.length, 2);
  assert.deepEqual(perishable.map((b) => b.purchase_date), ['2026-11-07', '2026-11-08']);
  for (const b of plan.batches) {
    assert.ok(b.total_raw_g > 0);
    assert.ok(b.storage_keys.length > 0);
    assert.ok(b.purchase_date > plan.run_date);
  }
  assert.equal(sumRaw(plan.batches.flatMap((b) => b.items)), plan.actual.totals.raw_g);
});

test('T-016 · 储存方式、缺货等价替换、渠道与预算参考、备餐建议齐备（FR-019）', () => {
  const plan = buildPurchasePlan(weekPlan(), FRIDAY);
  assert.ok(plan.substitutes.length > 0);
  assert.ok(plan.substitutes.every((s) => s.reason_key === 'purchase.reason.substitute_equivalent'));
  assert.equal(plan.channel.channel_key, 'channel.local_market');
  assert.equal(plan.channel.budget_key, 'budget.moderate');
  assert.equal(plan.channel.locale_source, 'user');
  assert.ok(Object.keys(plan.channel.price_bands).length > 0);
  assert.ok(plan.prep_notes.length > 0);
  assert.ok(plan.theoretical.items.every((it) => it.storage_key));
});

test('T-016 · 预算参考是结构化分档，不编造货币金额（FR-019 / P-11）', () => {
  const plan = buildPurchasePlan(weekPlan(), FRIDAY);
  assert.equal('amount' in plan.channel, false);
  assert.equal('currency' in plan.channel, false);
  for (const [key, value] of Object.entries(plan.channel.price_bands)) {
    assert.match(key, /^price\.[a-z0-9._-]+$/);
    assert.ok(Number.isInteger(value) && value > 0);
  }
  assert.ok(noChinese(plan.channel));
});

test('T-016 · 缺货替换只透传注入的等价键，不自行推断或替换自身（E-06 / FR-027）', () => {
  const plan = buildPurchasePlan(weekPlan(), FRIDAY);
  const radish = plan.substitutes.find((s) => s.ingredient_id === 'ing.radish');
  assert.deepEqual([...radish.substitute_ids], ['ing.turnip']);
  assert.ok(plan.substitutes.every((s) => !s.substitute_ids.includes(s.ingredient_id)));
  assert.ok(plan.substitutes.every((s) => s.substitute_ids.every((id) => /^ing\.[a-z0-9._-]+$/.test(id))));
});

// ---- FR-021 / AC-03 四餐明细 ----

test('T-016 · 日计划四餐生重克数、做法要点、估算热量与蛋白（FR-021 / AC-03）', () => {
  const plan = buildPurchasePlan(weekPlan(), FRIDAY);
  const daily = buildDailyPlan(weekPlan().menu[5], plan);
  assert.equal(daily.date, '2026-11-07');
  assert.deepEqual(daily.meals.map((m) => m.slot), [...PURCHASE_SLOTS]);
  assert.ok(daily.meals.every((m) => m.method_key && m.raw_g > 0 && m.energy_kcal > 0 && m.protein_g >= 0));
  assert.equal(daily.totals.raw_g, dayRaw());
  assert.ok(daily.meals.every((m) => sumRaw(m.items) === m.raw_g));
  assert.ok(noChinese(daily));
});

test('T-016 · 全天合计与处方对照表覆盖九项，能量 / 蛋白可估算（FR-021）', () => {
  const plan = buildPurchasePlan(weekPlan(), FRIDAY);
  const daily = buildDailyPlan(weekPlan().menu[5], plan);
  assert.deepEqual(daily.rx_comparison.map((c) => c.field), [...RX_FIELDS]);
  const energy = daily.rx_comparison.find((c) => c.field === 'energy_kcal');
  assert.equal(energy.estimated, daily.totals.energy_kcal);
  assert.equal(typeof energy.compliant, 'boolean');
  assert.deepEqual([...energy.prescribed], PRESCRIPTION.energy_kcal);
  const water = daily.rx_comparison.find((c) => c.field === 'water_ml');
  assert.equal(water.estimated, null);
  assert.equal(water.notice_key, 'plan.notice.not_estimated');
});

test('T-016 · 处方区间变窄只影响对照结论，不改变任何营养数值（FR-044 / §9 不变式 1）', () => {
  const narrow = weekPlan({ prescription: { ...PRESCRIPTION, energy_kcal: [2000, 2100] } });
  const plan = buildPurchasePlan(narrow, FRIDAY);
  const daily = buildDailyPlan(narrow.menu[5], plan);
  const energy = daily.rx_comparison.find((c) => c.field === 'energy_kcal');
  assert.equal(energy.compliant, false);
  assert.ok(daily.totals.energy_kcal >= GUARDRAILS.energy_floor_kcal);
  assert.ok(daily.totals.protein_g >= GUARDRAILS.protein_floor_g);
});

test('T-016 · 补购缺口只列易腐品，不重复整周清单（FR-020 / AC-09）', () => {
  const plan = buildPurchasePlan(weekPlan(), FRIDAY);
  const daily = buildDailyPlan(weekPlan().menu[5], plan);
  assert.ok(daily.top_up.items.length > 0);
  assert.ok(daily.top_up.items.every((it) => it.shelf_class === SHELF_CLASS.PERISHABLE));
  assert.ok(daily.top_up.totals.raw_g < daily.totals.raw_g);
  assert.ok(daily.top_up.totals.raw_g < plan.theoretical.totals.raw_g);
  assert.ok(daily.top_up.notice_keys.includes('purchase.notice.top_up_only'));
});

test('T-016 · 前夜备餐清单按 prep_key 聚合，含执行时机（FR-020）', () => {
  const plan = buildPurchasePlan(weekPlan(), FRIDAY);
  const daily = buildDailyPlan(weekPlan().menu[5], plan);
  assert.ok(daily.prep_list.length > 0);
  assert.ok(daily.prep_list.every((p) => p.timing_key === 'prep.timing.previous_evening'));
  assert.ok(daily.prep_list.every((p) => p.ingredient_ids.length > 0));
  const thaw = daily.prep_list.find((p) => p.prep_key === 'prep.thaw');
  assert.deepEqual([...thaw.ingredient_ids], ['ing.seabass']);
});

// ---- 护栏 ----

test('T-016 · 低于 BMR / 蛋白保肌下限的日计划被拒绝（§9 不变式 1）', () => {
  const low = weekPlan({
    guardrails: { energy_floor_kcal: 99999, protein_floor_g: 78 },
  });
  const plan = buildPurchasePlan(low, FRIDAY);
  assert.throws(
    () => buildDailyPlan(low.menu[5], plan),
    (e) => isPurchaseError(e) && e.issues.some((i) => i.code === PURCHASE_ERROR.GUARDRAIL),
  );
});

test('T-016 · 历史日期不产日计划，工作区文件不回改历史（P-05 / §9 不变式 3）', () => {
  const plan = buildPurchasePlan(weekPlan(), FRIDAY);
  assert.throws(
    () => buildDailyPlan(weekPlan().menu[0], plan),
    (e) => isPurchaseError(e) && e.issues.some((i) => i.code === PURCHASE_ERROR.WINDOW),
  );
});

test('T-016 · 未通过去重的菜单不得进入采购折算（T-015 依赖 / FR-027）', () => {
  const wp = weekPlan();
  const broken = { ...wp, menu: wp.menu.map((d, i) => i === 5 ? { ...d, dedup: { ...d.dedup, status: 'blocked' } } : d) };
  assert.throws(
    () => buildPurchasePlan(broken, FRIDAY),
    (e) => isPurchaseError(e) && e.issues.some((i) => i.code === PURCHASE_ERROR.DEDUP),
  );
});

test('T-016 · locale_source 拒绝静默推断，渠道 / 预算键必须是 Canonical ID（P-12 / FR-041）', () => {
  const bad = [
    weekPlan({ locale_source: 'auto:inferred' }),
    weekPlan({ channel_key: '附近菜市场' }),
    weekPlan({ budget_key: 'Budget.High' }),
    weekPlan({ language_tag: 'zh_CN' }),
  ];
  for (const wp of bad) assert.throws(() => buildPurchasePlan(wp, FRIDAY), isPurchaseError);
});

test('T-016 · 额外键 / 中文 / 负克数 / 非法餐次一律拒绝（FR-041 / P-11）', () => {
  const withBadItem = (item) => {
    const wp = weekPlan();
    const menu = wp.menu.map((d) => ({ ...d, meals: d.meals.map((m) => ({ ...m, items: m.items.map((it) => ({ ...it })) })) }));
    menu[0].meals[0].items[0] = item;
    return { ...wp, menu };
  };
  const bad = [
    { ...PANTRY[0], extra: 1 },
    { ...PANTRY[0], ingredient_id: '白萝卜' },
    { ...PANTRY[0], raw_g: -1 },
    { ...PANTRY[0], energy_kcal_per_100g: -1 },
    { ...PANTRY[0], shelf_class: 'fresh' },
  ];
  for (const item of bad) {
    assert.throws(() => buildPurchasePlan(withBadItem(item), FRIDAY), isPurchaseError);
  }
  const wp = weekPlan();
  const badSlots = { ...wp, menu: wp.menu.map((d) => ({ ...d, meals: [d.meals[0], d.meals[1], d.meals[2], { ...d.meals[3], slot: 'brunch' }] })) };
  assert.throws(() => buildPurchasePlan(badSlots, FRIDAY), isPurchaseError);
});

test('T-016 · 每 100g 营养参数非负护栏独立于聚合一致性（FR-021）', () => {
  const wp = uniformBadItem({ energy_kcal_per_100g: -1 });
  assert.throws(
    () => validateWeekPlan(wp),
    (e) => isPurchaseError(e)
      && e.issues.some((i) => i.code === PURCHASE_ERROR.NUTRITION && i.hint === 'action.purchase.per_100g'),
  );
});

test('T-016 · 储存类别枚举护栏独立于聚合一致性（FR-019）', () => {
  const wp = uniformBadItem({ shelf_class: 'fresh' });
  assert.throws(
    () => validateWeekPlan(wp),
    (e) => isPurchaseError(e)
      && e.issues.some((i) => i.code === PURCHASE_ERROR.ITEM && i.hint === 'action.purchase.shelf_class'),
  );
});

// ---- 工作区索引与脱敏 ----

test('T-016 · 工作区索引是确定性纯 ASCII 结构索引，零中文（T-018 前占位）', () => {
  const plan = buildPurchasePlan(weekPlan(), FRIDAY);
  const daily = buildDailyPlan(weekPlan().menu[5], plan);
  const w = renderWeeklyIndex(plan);
  const d = renderDailyIndex(daily);
  assert.ok(w.startsWith('# weekly-plan'));
  assert.ok(d.startsWith('# daily-plan'));
  assert.ok(/^[\x20-\x7E\n]+$/.test(w) && /^[\x20-\x7E\n]+$/.test(d));
  assert.ok(w.includes('theoretical_total_raw_g=') && w.includes('actual_total_raw_g='));
  assert.ok(d.includes('date=2026-11-07') && d.includes('energy_kcal='));
  assert.equal(renderWeeklyIndex(buildPurchasePlan(weekPlan(), FRIDAY)), w, '同输入逐字节一致');
});

test('T-016 · 写工作区文件只经注入端口且只写未来日期（P-05 / P-14）', async () => {
  const fs = createMemoryFs();
  const plan = buildPurchasePlan(weekPlan(), FRIDAY);
  const daily = buildDailyPlan(weekPlan().menu[5], plan);
  await writeWeeklyPlan(fs, WEEKLY_PATH, plan);
  await writeDailyPlan(fs, DAILY_PATH, daily);
  assert.equal(await fs.readText(WEEKLY_PATH), renderWeeklyIndex(plan));
  assert.equal(await fs.readText(DAILY_PATH), renderDailyIndex(daily));
  assert.deepEqual(fs.writes().map((x) => x.kind), ['write', 'write']);
  assert.deepEqual(await fs.list(), [DAILY_PATH, WEEKLY_PATH]);

  const past = { ...daily, date: '2026-11-01' };
  await assert.rejects(() => writeDailyPlan(fs, DAILY_PATH, past), isPurchaseError);
  assert.equal(await fs.readText(DAILY_PATH), renderDailyIndex(daily), '拒绝后历史文件未被覆写');
});

test('T-016 · 错误只含稳定码 + Canonical ID；语言标签不影响任何数值（FR-044 / FR-049）', () => {
  let caught;
  try {
    validateWeekPlan({ ...weekPlan(), extra: 1, channel_key: '98765' });
  } catch (e) {
    caught = e;
  }
  assert.ok(isPurchaseError(caught));
  assert.match(caught.message, /^ERR_PURCHASE_INVALID: ERR_PURCHASE_[A-Z_,]+$/);
  assert.ok(!caught.message.includes('98765'));
  for (const i of caught.issues) {
    assert.match(i.code, /^ERR_PURCHASE_[A-Z_]+$/);
    assert.match(i.hint, /^[a-z][a-z0-9._-]*$/);
  }

  const zh = buildPurchasePlan(weekPlan({ language_tag: 'zh-CN' }), FRIDAY);
  const la = buildPurchasePlan(weekPlan({ language_tag: 'la' }), FRIDAY);
  const strip = (p) => { const { language_tag, ...rest } = p; return rest; };
  assert.deepEqual(strip(zh), strip(la), '切换语言后两栏用量 / 营养数值 / 指纹完全不变');
  assert.ok(noChinese(zh) && !JSON.stringify(zh).includes('bmr_kcal'));
});
