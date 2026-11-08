// SPDX-License-Identifier: GPL-3.0-only
/**
 * 可插拔膳食指南适配器契约（FR-003 / FR-032 / E-09 / plan.md §6.1）。
 *
 * 本文件只定义接口、稳定错误码与纯校验函数，不含任何 IO、不含任何指南原文。
 * 适配器数据文件（data/guideline/*.json）只允许固定键集：额外键一律拒绝，
 * 既落实 FR-032「不得复制受版权保护出版物原文 / 图表」，也防注入（E-09）。
 */
export const RX_ERROR = Object.freeze({
  INVALID: 'ERR_RX_INVALID',
  BODY: 'ERR_RX_BODY',
  ADAPTER: 'ERR_RX_ADAPTER',
  JSON: 'ERR_RX_JSON',
  GUARDRAIL: 'ERR_RX_GUARDRAIL',
  LIMIT: 'ERR_RX_LIMIT',
});

export const GUIDELINE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** @type {ReadonlyArray<string>} */
export const GUIDELINE_KEYS = Object.freeze([
  'id', 'version', 'source', 'notice_key',
  'coefficients', 'protein_floor_g_per_kg', 'targets', 'limits',
]);

const COEFF_KEYS = Object.freeze([
  'energy_factor', 'protein_g_per_kg', 'fat_energy_ratio',
  'carb_energy_ratio', 'fiber_g', 'water_ml_per_kg',
]);
const TARGET_KEYS = Object.freeze(['salt_g', 'oil_g', 'added_sugar_g']);
const LIMIT_KEYS = Object.freeze(['salt_g_max_exclusive', 'oil_g', 'added_sugar_g_max_exclusive']);
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const CANONICAL_RE = /^[a-z][a-z0-9._:-]{0,63}$/;

/**
 * @param {string} code @param {string} field @param {string} hint Canonical ID
 * @returns {Readonly<{code: string, field: string, hint: string}>}
 */
export function issue(code, field, hint) {
  return Object.freeze({ code, field, hint });
}

/** 处方 / 适配器校验失败：汇总全部问题，消息只含稳定码（FR-049 / P-11）。 */
export class RxValidationError extends Error {
  /** @param {Array<{code: string, field: string, hint: string}>} issues */
  constructor(issues) {
    super(`${RX_ERROR.INVALID}: ${issues.map((i) => i.code).join(',')}`);
    this.name = 'RxValidationError';
    this.code = RX_ERROR.INVALID;
    this.issues = Object.freeze(issues.map((i) => Object.freeze({ ...i })));
  }
}

const finitePositive = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
/** @param {unknown} v @param {boolean} positive 是否要求 min > 0 */
function isRange(v, positive = false) {
  return Array.isArray(v) && v.length === 2
    && typeof v[0] === 'number' && Number.isFinite(v[0])
    && typeof v[1] === 'number' && Number.isFinite(v[1])
    && (positive ? v[0] > 0 : v[0] >= 0)
    && v[1] >= v[0];
}
const plainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 校验适配器契约，返回问题列表（空数组 = 合法）。纯函数，不修改输入。
 * @param {unknown} adapter
 * @returns {Array<Readonly<{code: string, field: string, hint: string}>>}
 */
export function validateGuidelineAdapter(adapter) {
  /** @type {Array<ReturnType<typeof issue>>} */
  const problems = [];
  const add = (field, hint) => problems.push(issue(RX_ERROR.ADAPTER, field, hint));

  if (!plainObject(adapter)) {
    add('(guidelineAdapter)', 'action.rx.adapter.object');
    return problems;
  }
  const a = /** @type {Record<string, any>} */ (adapter);

  for (const k of Object.keys(a)) {
    if (!GUIDELINE_KEYS.includes(k)) add(`(guidelineAdapter).${k}`, 'action.rx.adapter.unknown_key');
  }
  for (const k of GUIDELINE_KEYS) {
    if (!(k in a)) add(`(guidelineAdapter).${k}`, 'action.rx.adapter.missing_key');
  }
  if (typeof a.id !== 'string' || !GUIDELINE_ID_RE.test(a.id)) add('id', 'action.rx.adapter.id');
  if (typeof a.version !== 'string' || !VERSION_RE.test(a.version)) add('version', 'action.rx.adapter.version');
  if (typeof a.source !== 'string' || !CANONICAL_RE.test(a.source)) add('source', 'action.rx.adapter.source');
  if (typeof a.notice_key !== 'string' || !CANONICAL_RE.test(a.notice_key)) add('notice_key', 'action.rx.adapter.notice_key');
  if (!finitePositive(a.protein_floor_g_per_kg)) add('protein_floor_g_per_kg', 'action.rx.adapter.protein_floor');

  if (!plainObject(a.coefficients)) {
    add('coefficients', 'action.rx.adapter.coefficients');
  } else {
    const c = a.coefficients;
    for (const k of Object.keys(c)) {
      if (!COEFF_KEYS.includes(k)) add(`coefficients.${k}`, 'action.rx.adapter.unknown_key');
    }
    for (const k of COEFF_KEYS) {
      if (!isRange(c[k], true)) add(`coefficients.${k}`, 'action.rx.adapter.range');
    }
  }

  if (!plainObject(a.targets)) {
    add('targets', 'action.rx.adapter.targets');
  } else {
    for (const k of TARGET_KEYS) {
      if (!isRange(a.targets[k])) add(`targets.${k}`, 'action.rx.adapter.range');
    }
  }

  if (!plainObject(a.limits)) {
    add('limits', 'action.rx.adapter.limits');
  } else {
    const l = a.limits;
    for (const k of Object.keys(l)) {
      if (!LIMIT_KEYS.includes(k)) add(`limits.${k}`, 'action.rx.adapter.unknown_key');
    }
    if (!finitePositive(l.salt_g_max_exclusive)) add('limits.salt_g_max_exclusive', 'action.rx.adapter.limit');
    if (!isRange(l.oil_g)) add('limits.oil_g', 'action.rx.adapter.range');
    if (!finitePositive(l.added_sugar_g_max_exclusive)) add('limits.added_sugar_g_max_exclusive', 'action.rx.adapter.limit');
  }

  // FR-003 硬约束：适配器声明的目标必须自身满足其上限，否则一律拒绝加载（E-09）。
  if (plainObject(a.targets) && plainObject(a.limits)) {
    const t = a.targets;
    const l = a.limits;
    if (isRange(t.salt_g) && finitePositive(l.salt_g_max_exclusive)
      && !(t.salt_g[1] < l.salt_g_max_exclusive)) add('targets.salt_g', 'action.rx.adapter.salt_limit');
    if (isRange(t.added_sugar_g) && finitePositive(l.added_sugar_g_max_exclusive)
      && !(t.added_sugar_g[1] < l.added_sugar_g_max_exclusive)) {
      add('targets.added_sugar_g', 'action.rx.adapter.sugar_limit');
    }
    if (isRange(t.oil_g) && isRange(l.oil_g)
      && !(t.oil_g[0] >= l.oil_g[0] && t.oil_g[1] <= l.oil_g[1])) {
      add('targets.oil_g', 'action.rx.adapter.oil_limit');
    }
  }
  return problems;
}
