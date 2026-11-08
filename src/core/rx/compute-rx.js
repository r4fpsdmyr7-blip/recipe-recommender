// SPDX-License-Identifier: GPL-3.0-only
/**
 * `computeRx(body, guidelineAdapter)` → 每日营养处方（FR-002 / FR-003 / plan.md §6.1）。
 *
 * 纯函数：不读文件、不注入 clock / net、不执行任何外部表达式字符串。
 * 九项指标由 body + 适配器的量化系数推导；BMR 与保肌下限是硬护栏，
 * 推导值低于护栏时强制抬升并留痕（SC-003 / SPEC §9 不变式 1）。
 * 所有面向人的文案由 T-018 / T-031 渲染，此处只输出 Canonical ID（P-11）。
 */
import {
  RX_ERROR,
  RxValidationError,
  issue,
  validateGuidelineAdapter,
} from '../guideline/contract.js';

/** FR-002 规定的九项每日营养处方字段。 */
export const RX_FIELDS = Object.freeze([
  'energy_kcal', 'protein_g', 'fat_g', 'carb_g', 'fiber_g',
  'water_ml', 'salt_g', 'oil_g', 'added_sugar_g',
]);

const round10 = (x) => Math.round(x / 10) * 10;
const round1 = (x) => Math.round(x * 10) / 10;
const finitePositive = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * @param {Record<string, any>} body Profile.body（至少含 bmr_kcal / weight_kg）
 * @param {Record<string, any>} guidelineAdapter 已通过契约校验的可插拔适配器
 * @returns {Record<string, any>} 处方 + 指南对照表 + 护栏留痕
 */
export function computeRx(body, guidelineAdapter) {
  /** @type {Array<ReturnType<typeof issue>>} */
  const problems = [];
  if (!finitePositive(body?.bmr_kcal)) {
    problems.push(issue(RX_ERROR.BODY, 'body.bmr_kcal', 'action.rx.body.bmr_kcal'));
  }
  if (!finitePositive(body?.weight_kg)) {
    problems.push(issue(RX_ERROR.BODY, 'body.weight_kg', 'action.rx.body.weight_kg'));
  }
  problems.push(...validateGuidelineAdapter(guidelineAdapter));
  if (problems.length > 0) throw new RxValidationError(problems);

  const c = guidelineAdapter.coefficients;
  const t = guidelineAdapter.targets;
  const l = guidelineAdapter.limits;
  const bmr = body.bmr_kcal;
  const weight = body.weight_kg;

  let energy = [round10(bmr * c.energy_factor[0]), round10(bmr * c.energy_factor[1])];
  let protein = [round1(weight * c.protein_g_per_kg[0]), round1(weight * c.protein_g_per_kg[1])];
  const proteinFloor = round1(weight * guidelineAdapter.protein_floor_g_per_kg);
  let energyAdjusted = false;
  let proteinAdjusted = false;

  // 硬护栏（FR-002）：总能量不得低于 BMR、蛋白不得低于保肌下限。
  if (energy[0] < bmr) {
    const floor = Math.ceil(bmr / 10) * 10;
    energy = [floor, Math.max(energy[1], floor)];
    energyAdjusted = true;
  }
  if (protein[0] < proteinFloor) {
    const floor = Math.ceil(proteinFloor);
    protein = [floor, Math.max(protein[1], floor)];
    proteinAdjusted = true;
  }
  if (energy[1] < energy[0] || protein[1] < protein[0]) {
    throw new RxValidationError([issue(RX_ERROR.GUARDRAIL, '(rx)', 'action.rx.guardrail.range')]);
  }

  const values = {
    energy_kcal: energy,
    protein_g: protein,
    fat_g: [round1(energy[0] * c.fat_energy_ratio[0] / 9), round1(energy[1] * c.fat_energy_ratio[1] / 9)],
    carb_g: [round1(energy[0] * c.carb_energy_ratio[0] / 4), round1(energy[1] * c.carb_energy_ratio[1] / 4)],
    fiber_g: [...c.fiber_g],
    water_ml: [round10(weight * c.water_ml_per_kg[0]), round10(weight * c.water_ml_per_kg[1])],
    salt_g: [...t.salt_g],
    oil_g: [...t.oil_g],
    added_sugar_g: [...t.added_sugar_g],
  };

  /** @param {string} key @param {number} limitMin @param {number|null} limitMax @param {boolean} strictMax */
  const row = (key, limitMin, limitMax, strictMax = false) => {
    const lo = values[key][0] >= limitMin;
    const hi = limitMax === null
      ? true
      : (strictMax ? values[key][1] < limitMax : values[key][1] <= limitMax);
    return {
      key,
      min: values[key][0],
      max: values[key][1],
      limit_min: limitMin,
      limit_max: limitMax,
      status: lo && hi ? 'within' : 'violation',
    };
  };

  const rows = [
    row('energy_kcal', bmr, null),
    row('protein_g', proteinFloor, null),
    row('fat_g', 0, null),
    row('carb_g', 0, null),
    row('fiber_g', 0, null),
    row('water_ml', 0, null),
    row('salt_g', 0, l.salt_g_max_exclusive, true),
    row('oil_g', l.oil_g[0], l.oil_g[1]),
    row('added_sugar_g', 0, l.added_sugar_g_max_exclusive, true),
  ];
  const violations = rows.filter((r) => r.status === 'violation').map((r) => r.key);
  if (violations.length > 0) {
    throw new RxValidationError([issue(RX_ERROR.LIMIT, '(comparison)', 'action.rx.comparison.limit')]);
  }

  return {
    ...values,
    floor_rule: 'energy_kcal.min >= body.bmr_kcal',
    guideline: {
      id: guidelineAdapter.id,
      version: guidelineAdapter.version,
      source: guidelineAdapter.source,
      notice_key: guidelineAdapter.notice_key,
    },
    comparison: {
      adapter_id: guidelineAdapter.id,
      adapter_version: guidelineAdapter.version,
      source: guidelineAdapter.source,
      rows,
      violations,
      compliant: violations.length === 0,
    },
    guardrails: {
      energy_floor_kcal: bmr,
      protein_floor_g: proteinFloor,
      energy_adjusted: energyAdjusted,
      protein_adjusted: proteinAdjusted,
    },
  };
}
