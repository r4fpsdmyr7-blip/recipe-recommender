// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-019 · 参数解析（FR-029 / FR-046 / plan.md §6.2）。
 *
 * 只做「命令 → 选项白名单 → 类型校验」三件事，不产生任何副作用：
 * - 每个命令有显式选项白名单，越界参数一律拒绝（`init --level` 是错误而非忽略）；
 * - 重复选项拒绝，避免「后者覆盖前者」的隐性歧义；
 * - 值不得含控制字符 / 竖线 / 反引号 / 绝对路径，保证输出 `key=value` 与台账可 diff（FR-028）。
 *
 * 越界命令（`locales` / `serve-mcp` / `feedback`）不在本任务命令集内，
 * 分别归 T-031 / T-030 / M2 细化。
 */
import { PLAN_LEVELS } from '../core/planner/index.js';
import { CLI_ERROR, CliError, cliIssue } from './errors.js';
import { OVERRIDE_KEYS, assertOverride } from './config.js';

/** 已实现的可执行命令集（T-019 五条核心命令 + T-020 两条数据主体命令）。 */
export const COMMANDS = Object.freeze([
  'init',
  'plan',
  'validate',
  'ledger',
  'acceptance',
  'export-data',
  'delete-data',
]);

/** 布尔开关（不带值）。`confirm` 只属于 `delete-data`，不会泄漏给其它命令。 */
export const FLAG_KEYS = Object.freeze(['strict', 'red-check', 'confirm']);

/** 分析类命令共用的开关（`confirm` 不在此列：只对删除有意义）。 */
const ANALYSIS_FLAGS = Object.freeze(['strict', 'red-check']);

/** 每命令的选项白名单（含 FR-046 的四类覆盖入口）。 */
export const COMMAND_OPTIONS = Object.freeze({
  init: Object.freeze(['profile', ...OVERRIDE_KEYS]),
  plan: Object.freeze(['level', 'date', 'profile', 'out', ...OVERRIDE_KEYS]),
  validate: Object.freeze(['level', 'date', 'profile', 'file', ...ANALYSIS_FLAGS, ...OVERRIDE_KEYS]),
  ledger: Object.freeze(['type', 'last']),
  acceptance: Object.freeze(['ac', ...ANALYSIS_FLAGS]),
  'export-data': Object.freeze(['out']),
  'delete-data': Object.freeze(['confirm']),
});

/** 需要作为工作区相对路径校验的选项。 */
const PATH_KEYS = Object.freeze(['profile', 'file', 'out']);

const UNSAFE = /[\x00-\x1F\x7F|`]/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LEDGER_TYPES = Object.freeze(['dedup', 'feedback', 'changelog']);
const AC = /^(?:AC-)?(\d{2})$/;

/** @param {unknown} value */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {string} mm @param {string} dd */
function validDay(mm, dd) {
  const month = Number(mm);
  const day = Number(dd);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(2000, month - 1, day, 0, 0, 0));
  return probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/** @param {string} value */
export function isIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  return validDay(value.slice(5, 7), value.slice(8, 10));
}

/** @param {string} value */
function isRelativePath(value) {
  if (value.length === 0) return false;
  if (value.startsWith('/')) return false;
  if (/^[A-Za-z]:\//.test(value)) return false;
  return !value.split('/').includes('..');
}

/** @param {string} name @param {unknown} value @param {string} field */
function assertValue(name, value, field) {
  /** @param {string} code @param {string} hint */
  const fail = (code, hint) => {
    throw new CliError([cliIssue(code, field, hint)]);
  };

  if (typeof value !== 'string' || value.length === 0 || UNSAFE.test(value)) {
    fail(CLI_ERROR.OPTION_VALUE, 'action.cli.value');
  }
  if (PATH_KEYS.includes(name) && !isRelativePath(value)) {
    fail(CLI_ERROR.OPTION_VALUE, 'action.cli.relative_path');
  }
  if (name === 'level' && !PLAN_LEVELS.includes(value)) fail(CLI_ERROR.LEVEL, 'action.cli.level');
  if (name === 'date' && !isIsoDate(value)) fail(CLI_ERROR.DATE, 'action.cli.date');
  if (name === 'type' && !LEDGER_TYPES.includes(value)) fail(CLI_ERROR.TYPE, 'action.cli.type');
  if (name === 'last') {
    const limit = /^\d{1,6}$/.test(value) ? Number(value) : NaN;
    if (!Number.isInteger(limit)) fail(CLI_ERROR.LIMIT, 'action.cli.last');
  }
  if (name === 'ac') {
    if (value === 'all') return;
    const matched = AC.exec(value);
    const index = matched ? Number(matched[1]) : 0;
    if (index < 1 || index > 19) fail(CLI_ERROR.AC, 'action.cli.ac');
  }
  if (OVERRIDE_KEYS.includes(name)) assertOverride(name, value, field);
}

/**
 * 解析 argv（不含 node / 脚本路径）。
 * @param {unknown} argv
 * @returns {Readonly<{command: string, options: Readonly<Record<string, unknown>>}>}
 * @throws {CliError}
 */
export function parseArgs(argv) {
  /** @param {string} code @param {string} field @param {string} hint */
  const fail = (code, field, hint) => {
    throw new CliError([cliIssue(code, field, hint)]);
  };

  if (!Array.isArray(argv) || argv.some((token) => typeof token !== 'string')) {
    fail(CLI_ERROR.ARGV, '(argv)', 'action.cli.argv');
  }
  const tokens = /** @type {string[]} */ (argv);
  const command = tokens[0];
  if (typeof command !== 'string' || !COMMANDS.includes(command)) {
    fail(CLI_ERROR.COMMAND, '(command)', 'action.cli.command');
  }
  const allowed = COMMAND_OPTIONS[/** @type {string} */ (command)];

  /** @type {Record<string, unknown>} */
  const options = {};
  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token.startsWith('--') || token === '--') {
      fail(CLI_ERROR.OPTION, '(options)', 'action.cli.option_shape');
    }
    const body = token.slice(2);
    const at = body.indexOf('=');
    const name = at < 0 ? body : body.slice(0, at);
    const inline = at < 0 ? undefined : body.slice(at + 1);

    if (!allowed.includes(name)) fail(CLI_ERROR.OPTION, `(options).${name}`, 'action.cli.option');
    if (Object.hasOwn(options, name)) {
      fail(CLI_ERROR.OPTION_DUP, `(options).${name}`, 'action.cli.option_dup');
    }

    if (FLAG_KEYS.includes(name)) {
      if (inline !== undefined) {
        fail(CLI_ERROR.OPTION_VALUE, `(options).${name}`, 'action.cli.flag_value');
      }
      options[name === 'red-check' ? 'redCheck' : name] = true;
      continue;
    }

    let value = inline;
    if (value === undefined) {
      const next = tokens[i + 1];
      if (next === undefined || next.startsWith('--')) {
        fail(CLI_ERROR.OPTION_VALUE, `(options).${name}`, 'action.cli.option_value');
      }
      value = /** @type {string} */ (next);
      i += 1;
    }
    assertValue(name, value, `(options).${name}`);
    options[name] = name === 'last' ? Number(value) : value;
  }

  return Object.freeze({ command: /** @type {string} */ (command), options: Object.freeze(options) });
}

/** 供命令实现复用的校验入口。 */
export { assertValue, isRecord };
