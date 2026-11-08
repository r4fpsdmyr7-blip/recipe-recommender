// SPDX-License-Identifier: GPL-3.0-only
/**
 * Profile schema 校验（T-010 / E-08 / plan.md §5.1）。
 *
 * 纯函数：只读输入、只返回问题列表，不修改任何对象、不执行 IO、不注入时钟。
 * 必填口径刻意区分两层：
 *   - T-003 对两份 fixture 做的「11 / 7 / 4 字段齐备」是静态示例校验；
 *   - 运行时只强制 E-08 五类护栏与顶层结构，其余字段存在则校验类型、缺失不拒绝，
 *     避免把尚未由后续任务产出的字段误判为非法档案。
 */
import { issue, PROFILE_ERROR } from './errors.js';
import { isIso3166Alpha2 } from './iso3166-1.js';
import { versionIssues } from './versions.js';

/**
 * 体脂「明显异常」的引擎物理可行性边界（闭区间，百分数）。
 * SPEC.md / plan.md 未定义精确阈值；此常量只用于拒绝 E-08「明显异常」的输入，
 * 不构成医学 / 营养学判断，也不写入规格（P-04）。
 * @type {ReadonlyArray<number>}
 */
export const BODY_FAT_PCT_RANGE = Object.freeze([3, 70]);

const SCHEMA_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
// 纯正则而非 Intl.getCanonicalLocales：跨三 OS × 三 Node 结果确定一致（NFR-004）。
// 只校验标签语法；「是否内置语言包」由 T-031 回退链处理，E-11 明确不失败。
const BCP47_RE = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8})*$/;

const BODY_NUMERIC_FIELDS = [
  'height_cm', 'weight_kg', 'bmi', 'water_pct', 'muscle_kg',
  'bone_kg', 'protein_pct', 'age_years',
];
const RX_RANGE_FIELDS = ['fat_g', 'carb_g', 'fiber_g', 'water_ml'];

/** @param {unknown} value */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {unknown} value */
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/** @param {unknown} value 有序的 [min, max] 有限数区间 */
function isRange(value) {
  return Array.isArray(value)
    && value.length === 2
    && isFiniteNumber(value[0])
    && isFiniteNumber(value[1])
    && value[0] <= value[1];
}

/**
 * @param {unknown} raw JSON.parse 后的 Profile 候选
 * @returns {import('./errors.js').ProfileIssue[]} 空数组表示合法
 */
export function validateProfile(raw) {
  /** @type {import('./errors.js').ProfileIssue[]} */
  const problems = [];
  const add = (code, field, hint) => problems.push(issue(code, field, hint));

  if (!isObject(raw)) {
    add(PROFILE_ERROR.SCHEMA, '(root)', 'action.profile.root_object');
    return problems;
  }
  const p = /** @type {Record<string, any>} */ (raw);

  if (typeof p.schema_version !== 'string' || !SCHEMA_VERSION_RE.test(p.schema_version)) {
    add(PROFILE_ERROR.SCHEMA, 'schema_version', 'action.profile.schema_version');
  }

  for (const key of ['body', 'nutrition_rx', 'locale_policy', 'privacy']) {
    if (!isObject(p[key])) add(PROFILE_ERROR.SCHEMA, key, 'action.profile.required_object');
  }
  if (p.goal !== undefined && !isObject(p.goal)) {
    add(PROFILE_ERROR.SCHEMA, 'goal', 'action.profile.goal_object');
  }

  const body = p.body;
  if (isObject(body)) {
    const b = /** @type {Record<string, any>} */ (body);
    if (!isFiniteNumber(b.bmr_kcal) || b.bmr_kcal <= 0) {
      add(PROFILE_ERROR.BMR_MISSING, 'body.bmr_kcal', 'action.profile.provide_bmr_kcal');
    }
    if (
      !isFiniteNumber(b.body_fat_pct)
      || b.body_fat_pct < BODY_FAT_PCT_RANGE[0]
      || b.body_fat_pct > BODY_FAT_PCT_RANGE[1]
    ) {
      add(PROFILE_ERROR.BODY_FAT_RANGE, 'body.body_fat_pct', 'action.profile.body_fat_pct');
    }
    for (const field of BODY_NUMERIC_FIELDS) {
      if (b[field] !== undefined && !isFiniteNumber(b[field])) {
        add(PROFILE_ERROR.SCHEMA, `body.${field}`, 'action.profile.numeric_field');
      }
    }
    if (b.sex !== undefined && typeof b.sex !== 'string') {
      add(PROFILE_ERROR.SCHEMA, 'body.sex', 'action.profile.string_field');
    }
  }

  const rx = p.nutrition_rx;
  if (isObject(rx)) {
    const r = /** @type {Record<string, any>} */ (rx);
    if (!isRange(r.energy_kcal)) {
      add(PROFILE_ERROR.SCHEMA, 'nutrition_rx.energy_kcal', 'action.profile.energy_range');
    } else if (isFiniteNumber(body?.bmr_kcal) && r.energy_kcal[0] < body.bmr_kcal) {
      // 数值护栏由引擎直接计算，不解析也不执行 floor_rule 字符串（注入安全）。
      add(PROFILE_ERROR.ENERGY_FLOOR, 'nutrition_rx.energy_kcal', 'action.profile.energy_floor');
    }
    if (r.protein_g !== undefined && !isRange(r.protein_g)) {
      add(PROFILE_ERROR.SCHEMA, 'nutrition_rx.protein_g', 'action.profile.protein_range');
    }
    for (const field of RX_RANGE_FIELDS) {
      if (r[field] !== undefined && !isRange(r[field])) {
        add(PROFILE_ERROR.SCHEMA, `nutrition_rx.${field}`, 'action.profile.range_field');
      }
    }
    if (typeof r.floor_rule !== 'string' || r.floor_rule.length === 0) {
      add(PROFILE_ERROR.SCHEMA, 'nutrition_rx.floor_rule', 'action.profile.floor_rule');
    }
  }

  const lp = p.locale_policy;
  if (isObject(lp)) {
    const l = /** @type {Record<string, any>} */ (lp);
    if (typeof l.output_language !== 'string' || !BCP47_RE.test(l.output_language)) {
      add(PROFILE_ERROR.LANGUAGE_TAG, 'locale_policy.output_language', 'action.profile.language_tag');
    }
    for (const field of ['declared_nationality', 'declared_residence']) {
      const value = l[field];
      if (value !== undefined && value !== null && !isIso3166Alpha2(value)) {
        add(PROFILE_ERROR.REGION_CODE, `locale_policy.${field}`, 'action.profile.region_code');
      }
    }
  }

  const privacy = p.privacy;
  if (isObject(privacy)) {
    const v = /** @type {Record<string, any> } */ (privacy);
    if (
      v.storage !== 'local-only'
      || v.upload !== false
      || v.telemetry !== false
      || v.real_person_data !== false
    ) {
      add(PROFILE_ERROR.PRIVACY, 'privacy', 'action.profile.privacy_contract');
    }
  }

  problems.push(...versionIssues(p.versions));
  return problems;
}
