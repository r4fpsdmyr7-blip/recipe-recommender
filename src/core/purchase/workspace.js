// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-016 · 工作区 `weekly-plan.md` / `daily-plan.md` 的确定性 ASCII 结构索引。
 *
 * 与 T-013 `periodic-plan.md` 同口径：本任务只写**结构索引**（周期 / 两栏总量 /
 * 四餐字段计数 / 稳定 notice_keys），完整 Markdown 表格、免责声明、语言包渲染
 * 归 T-018 / T-031。因此 AC-03 / AC-09 在本任务完成后仍为 RED（P-02）。
 *
 * 纯函数渲染 + 经 FsPort 写入；日索引在写前校验「目标日期 > 运行日」，
 * 拒绝回改历史快照（P-05 / §9 不变式 3），且拒绝发生在任何写入之前。
 */
import { PURCHASE_ERROR, PurchaseError, purchaseIssue } from './errors.js';
import { validatePurchasePlan } from './contract.js';

/** @param {unknown} plan */
export function renderWeeklyIndex(plan) {
  const p = validatePurchasePlan(plan);
  return [
    '# weekly-plan',
    `period_id=${p.period_id}`,
    `start_date=${p.start_date}`,
    `end_date=${p.end_date}`,
    `run_date=${p.run_date}`,
    `remaining_dates=${p.remaining_dates.join(',')}`,
    `past_dates=${p.past_dates.join(',')}`,
    `theoretical_total_raw_g=${p.theoretical.totals.raw_g}`,
    `actual_total_raw_g=${p.actual.totals.raw_g}`,
    `theoretical_energy_kcal=${p.theoretical.totals.energy_kcal}`,
    `actual_energy_kcal=${p.actual.totals.energy_kcal}`,
    `batch_count=${p.batches.length}`,
    `substitute_count=${p.substitutes.length}`,
    `channel_key=${p.channel.channel_key}`,
    `budget_key=${p.channel.budget_key}`,
    `locale_source=${p.channel.locale_source}`,
    `notice_keys=${p.notice_keys.join(',')}`,
    '',
  ].join('\n');
}

/** @param {unknown} daily */
export function renderDailyIndex(daily) {
  if (!daily || typeof daily !== 'object') {
    throw new PurchaseError([
      purchaseIssue(PURCHASE_ERROR.MENU, '(daily)', 'action.purchase.daily_object'),
    ]);
  }
  const d = /** @type {Record<string, any>} */ (daily);
  return [
    '# daily-plan',
    `date=${d.date}`,
    `run_date=${d.run_date}`,
    `meal_count=${d.meals.length}`,
    `raw_g=${d.totals.raw_g}`,
    `energy_kcal=${d.totals.energy_kcal}`,
    `protein_g=${d.totals.protein_g}`,
    `top_up_total_raw_g=${d.top_up.totals.raw_g}`,
    `prep_count=${d.prep_list.length}`,
    `rx_field_count=${d.rx_comparison.length}`,
    `notice_keys=${d.notice_keys.join(',')}`,
    '',
  ].join('\n');
}

/** @param {unknown} fsPort @param {unknown} path */
function validateWriteTarget(fsPort, path) {
  if (!fsPort || typeof /** @type {any} */ (fsPort).writeText !== 'function') {
    throw new PurchaseError([
      purchaseIssue(PURCHASE_ERROR.FS, '(fsPort)', 'action.purchase.inject_fs_port'),
    ]);
  }
  if (typeof path !== 'string' || path.length === 0) {
    throw new PurchaseError([
      purchaseIssue(PURCHASE_ERROR.FS, '(path)', 'action.purchase.plan_path'),
    ]);
  }
}

/** @param {any} fsPort @param {string} path @param {unknown} plan */
export async function writeWeeklyPlan(fsPort, path, plan) {
  validateWriteTarget(fsPort, path);
  const text = renderWeeklyIndex(plan);
  await fsPort.writeText(path, text);
  return Object.freeze({ path, bytes: text.length });
}

/** @param {any} fsPort @param {string} path @param {unknown} daily */
export async function writeDailyPlan(fsPort, path, daily) {
  validateWriteTarget(fsPort, path);
  const d = /** @type {Record<string, any>} */ (daily ?? {});
  // P-05：校验必须先于任何写入，历史日计划不得被回改。
  if (typeof d.date !== 'string' || typeof d.run_date !== 'string' || d.date <= d.run_date) {
    throw new PurchaseError([
      purchaseIssue(PURCHASE_ERROR.WINDOW, '(daily).date', 'action.purchase.timeline_historical'),
    ]);
  }
  const text = renderDailyIndex(daily);
  await fsPort.writeText(path, text);
  return Object.freeze({ path, bytes: text.length });
}
