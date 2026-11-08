// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-019 · 覆盖值四层解析（FR-040 / FR-046 / plan.md §6.2）。
 *
 * 优先级严格为 **CLI > 环境变量 > 配置文件 > 自动解析**：
 * 本模块只负责「取值 + 记录来源」，绝不自行决定指南 / 历法 / 语言的值，
 * 自动解析（国籍 → 居住地 → 回退）归 T-032 `resolveLocalePolicy`。
 *
 * 失败关闭：任一层出现非法值即拒绝，不静默忽略该层（否则用户以为覆盖生效而实际没有）。
 * 配置文件是纯数据，键集固定为 `lang / guideline / calendar / country`，
 * 未知键一律拒绝（同 FR-032 的固定键集口径，防注入）。
 */
import { CLI_ERROR, CliError, cliIssue } from './errors.js';

/** 工作区配置文件（相对 FsPort root）。 */
export const CONFIG_PATH = 'rr.config.json';

/** 可被显式覆盖的四类策略（FR-046：指南 / 历法 / 语言 / 单位 → 单位随区域策略派生）。 */
export const OVERRIDE_KEYS = Object.freeze(['lang', 'guideline', 'calendar', 'country']);

/** 环境变量层：变量名是稳定契约，改名属行为变更（需先改 SPEC）。 */
export const ENV_KEYS = Object.freeze({
  lang: 'RR_LANG',
  guideline: 'RR_GUIDELINE',
  calendar: 'RR_CALENDAR',
  country: 'RR_COUNTRY',
});

const BCP47 = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8})*$/;
const SLUG_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const REGION = /^[A-Z]{2}$/;

/** @param {unknown} value */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 单值校验；返回 `null` 表示通过，否则返回稳定码。
 * @param {string} key lang|guideline|calendar|country
 * @param {string} value
 * @returns {string|null}
 */
export function overrideProblem(key, value) {
  if (typeof value !== 'string' || value.length === 0) return CLI_ERROR.OVERRIDE;
  if (key === 'lang') return BCP47.test(value) ? null : CLI_ERROR.OVERRIDE;
  if (key === 'country') return REGION.test(value) ? null : CLI_ERROR.OVERRIDE;
  if (key === 'guideline' || key === 'calendar') {
    return SLUG_ID.test(value) ? null : CLI_ERROR.OVERRIDE;
  }
  return CLI_ERROR.OVERRIDE;
}

/**
 * @param {string} key
 * @param {unknown} value
 * @param {string} field 形如 `(options).lang` / `(env).RR_LANG` / `(config).lang`
 * @throws {CliError}
 */
export function assertOverride(key, value, field) {
  const problem = overrideProblem(key, value);
  if (problem) throw new CliError([cliIssue(problem, field, `action.cli.override.${key}`)]);
}

/**
 * 解析配置文件正文：固定键集、值为字符串或 null，其余一律拒绝。
 * @param {string} text
 * @returns {Readonly<Record<string, string|null>>}
 * @throws {CliError}
 */
export function parseConfigText(text) {
  /** @param {string} field @param {string} hint */
  const fail = (field, hint) => {
    throw new CliError([cliIssue(CLI_ERROR.CONFIG, field, hint)]);
  };
  if (typeof text !== 'string') fail('(config)', 'action.cli.config_text');

  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    // 不透传可能含文件内容的原生 SyntaxError 消息（FR-049）。
    fail('(config)', 'action.cli.config_json');
  }
  if (!isRecord(raw)) fail('(config)', 'action.cli.config_object');

  const record = /** @type {Record<string, unknown>} */ (raw);
  for (const key of Object.keys(record)) {
    if (!OVERRIDE_KEYS.includes(key)) fail('(config)', 'action.cli.config_unknown_key');
  }
  /** @type {Record<string, string|null>} */
  const out = {};
  for (const key of OVERRIDE_KEYS) {
    const value = record[key];
    if (value === undefined || value === null) {
      out[key] = null;
    } else if (typeof value === 'string' && value.length > 0) {
      out[key] = value;
    } else {
      fail(`(config).${key}`, 'action.cli.config_value');
    }
  }
  return Object.freeze(out);
}

/**
 * 四层解析：只回传值与来源，值本身的语义由 T-032 决定。
 * @param {{options?: Record<string, unknown>, env?: Record<string, unknown>, config?: Record<string, unknown>}} [input]
 * @returns {Readonly<{values: Readonly<Record<string, string|null>>, sources: Readonly<Record<string, string|null>>}>}
 * @throws {CliError}
 */
export function resolveOverrides({ options = {}, env = {}, config = {} } = {}) {
  const layers = [
    ['cli', isRecord(options) ? options : {}, (key) => `(options).${key}`],
    ['env', isRecord(env) ? env : {}, (key) => `(env).${ENV_KEYS[key]}`],
    ['config', isRecord(config) ? config : {}, (key) => `(config).${key}`],
  ];

  /** @type {Record<string, string|null>} */
  const values = {};
  /** @type {Record<string, string|null>} */
  const sources = {};

  for (const key of OVERRIDE_KEYS) {
    values[key] = null;
    sources[key] = null;
    for (const [layer, bag, fieldOf] of layers) {
      const raw = layer === 'env' ? bag[ENV_KEYS[key]] : bag[key];
      // 环境变量空缺 == 未设置（shell 常见写法）；CLI / 配置层出现空串属配置错误，失败关闭。
      if (raw === undefined || raw === null || (layer === 'env' && raw === '')) continue;
      assertOverride(key, raw, fieldOf(key));
      if (values[key] === null) {
        values[key] = /** @type {string} */ (raw);
        sources[key] = layer;
      }
    }
  }
  return Object.freeze({ values: Object.freeze(values), sources: Object.freeze(sources) });
}
