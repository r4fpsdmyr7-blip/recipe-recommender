// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-019 · `rr validate` —— 计划与处方一致性校验（FR-002 / FR-027 / FR-029）。
 *
 * 做法：读计划文件里的 **`rr-data` 纯 ASCII 规范数据区**（T-018 / FR-044 锚点），
 * 用档案 + 指南适配器当场复算，逐键比对。这样校验只依赖规范数据区，
 * 与输出语言、排版、表格顺序完全解耦（切换语言不会让校验结论漂移）。
 *
 * 比对项固定 28 项（处方 18 + 版本 5 + 护栏 2 + 元数据 3），
 * `--strict` 追加 2 项（三条基类通知齐备、区段计数合法）= 30 项，
 * 让 `checked` 成为可断言的确定值而不是模糊的「查过了」。
 */
import { loadProfile, VERSION_KEYS } from '../core/profile/index.js';
import { loadGuidelineAdapter } from '../core/guideline/index.js';
import { computeRx, RX_FIELDS } from '../core/rx/index.js';
import { resolvePlanPeriod } from '../core/planner/index.js';
import { extractRenderData } from '../core/render/index.js';
import { CLI_ERROR, CliError, cliIssue } from './errors.js';
import { line, requirePort } from './shared.js';

const LOCALE_SOURCES = Object.freeze(['user', 'auto:nationality', 'auto:residence', 'auto:fallback']);
const BASE_NOTICE_COUNT = 3;

/** @param {unknown} value */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {any} entry */
function versionId(entry) {
  if (typeof entry === 'string') return entry;
  return isRecord(entry) && typeof entry.id === 'string' ? entry.id : null;
}

/**
 * @param {Record<string, unknown>} options
 * @param {Record<string, any>} deps
 * @returns {Promise<string[]>}
 */
export async function runValidate(options, deps) {
  const fsPort = requirePort(deps, 'fsPort', 'action.cli.port.fs');
  if (typeof options.profile !== 'string' || options.profile.length === 0) {
    throw new CliError([cliIssue(CLI_ERROR.PROFILE, '(options).profile', 'action.cli.profile_required')]);
  }

  const path = await resolveTargetPath(options, deps);
  let text;
  try {
    text = await fsPort.readText(path);
  } catch {
    throw new CliError([cliIssue(CLI_ERROR.FILE, '(file)', 'action.cli.file_missing')]);
  }

  /** @type {Record<string, string>} */
  let data;
  try {
    data = /** @type {any} */ (extractRenderData(text));
  } catch {
    // 不携带渲染域细节，也不回显正文（FR-049 / P-14）。
    throw new CliError([cliIssue(CLI_ERROR.FILE, '(file)', 'action.cli.file_not_plan')]);
  }

  if (typeof options.level === 'string' && data.level !== options.level) {
    throw new CliError([cliIssue(CLI_ERROR.DRIFT, '(file).level', 'action.cli.drift')]);
  }

  const profile = await loadProfile(options.profile, fsPort);
  const adapter = await loadGuidelineAdapter(fsPort, data.guideline_id);
  const rx = computeRx(profile.body, adapter);

  /** @type {import('./errors.js').CliIssue[]} */
  const drift = [];
  const compare = (key, expected) => {
    if (data[key] !== String(expected)) {
      drift.push(cliIssue(CLI_ERROR.DRIFT, `(file).${key}`, 'action.cli.drift'));
    }
  };

  for (const field of RX_FIELDS) {
    compare(`rx.${field}.min`, /** @type {number[]} */ (rx[field])[0]);
    compare(`rx.${field}.max`, /** @type {any} */ (rx[field])[1]);
  }
  for (const key of VERSION_KEYS) {
    compare(`version.${key}`, versionId(/** @type {any} */ (profile.versions)[key]));
  }
  compare('guardrail.energy_floor_kcal', /** @type {any} */ (rx.guardrails).energy_floor_kcal);
  compare('guardrail.protein_floor_g', /** @type {any} */ (rx.guardrails).protein_floor_g);
  compare('guideline_id', adapter.id);

  let checked = RX_FIELDS.length * 2 + VERSION_KEYS.length + 2 + 1;

  // 元数据两项：语言标签非空 + 来源在允许集合内（FR-046 头部可追溯）。
  if (typeof data.language_tag !== 'string' || data.language_tag.length === 0) {
    drift.push(cliIssue(CLI_ERROR.DRIFT, '(file).language_tag', 'action.cli.drift'));
  }
  if (!LOCALE_SOURCES.includes(data.locale_source)) {
    drift.push(cliIssue(CLI_ERROR.DRIFT, '(file).locale_source', 'action.cli.drift'));
  }
  checked += 2;

  if (options.strict === true) {
    if (Number(data['notices.count']) < BASE_NOTICE_COUNT) {
      drift.push(cliIssue(CLI_ERROR.DRIFT, '(file).notices.count', 'action.cli.drift'));
    }
    const sections = Number(data['sections.count']);
    if (!Number.isInteger(sections) || sections < 0) {
      drift.push(cliIssue(CLI_ERROR.DRIFT, '(file).sections.count', 'action.cli.drift'));
    }
    checked += 2;
  }

  if (drift.length > 0) throw new CliError(drift);

  return [
    line('command', 'validate'),
    line('file', path),
    line('level', data.level),
    line('checked', checked),
    line('status', 'ok'),
  ];
}

/**
 * `--file` 优先；否则由 `--level` + 运行日推导 `plans/<file_name>`（与 `rr plan` 同一口径）。
 * @param {Record<string, unknown>} options
 * @param {Record<string, any>} deps
 */
async function resolveTargetPath(options, deps) {
  if (typeof options.file === 'string' && options.file.length > 0) return options.file;
  if (typeof options.level !== 'string') {
    throw new CliError([cliIssue(CLI_ERROR.OPTION_VALUE, '(options).file', 'action.cli.file_required')]);
  }
  const clock = requirePort(deps, 'clock', 'action.cli.port.clock');
  const runDate = typeof options.date === 'string' ? options.date : clock.today();
  const period = resolvePlanPeriod(options.level, runDate, clock.iso());
  return `plans/${period.file_name}`;
}
