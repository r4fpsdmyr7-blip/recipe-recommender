// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-019 · `rr plan` —— 生成指定层级计划的组合根（FR-029 / FR-046 / AC-12）。
 *
 * 一次调用串起既有核心域，本模块**不新增任何业务规则**：
 * 档案（T-010）→ 区域策略（T-032 端口）→ 只读时令缓存（T-014）→ 指南适配器 + 处方（T-011）
 * → 五级计划对象（T-013）→ 语言包（T-031 端口）→ Markdown 渲染（T-018）→ 落盘。
 *
 * 边界：
 * - 只读缓存，**不联网刷新**（年刷新入口不属 T-019 声明的命令集）；因此断网即可产出全部层级（AC-12）。
 * - `--date` 覆盖**运行日**，不伪造运行时刻：日级仍要求业务时区 20:00 触发（FR-007）。
 * - 语言包与区域解析一律注入，缺失即 `ERR_CLI_PORT`，不内置任何映射表 / 译文（T-031 / T-032 边界）。
 */
import { loadProfile } from '../core/profile/index.js';
import { loadGuidelineAdapter } from '../core/guideline/index.js';
import { computeRx } from '../core/rx/index.js';
import { buildPlan } from '../core/planner/index.js';
import { readCalendarCache } from '../core/calendar/index.js';
import { render } from '../core/render/index.js';
import { CLI_ERROR, CliError, cliIssue } from './errors.js';
import { createIntlFormatter } from './intl.js';
import { line, overrideLines, requirePort, resolveCommandOverrides } from './shared.js';

const POLICY_KEYS = Object.freeze([
  'language_tag', 'guideline_id', 'calendar_id', 'unit_system', 'locale_source',
]);
const SLUG_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const LANGUAGE_TAG = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8})*$/;
const LOCALE_SOURCES = Object.freeze(['user', 'auto:nationality', 'auto:residence', 'auto:fallback']);

/** @param {unknown} value */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 区域策略结果是固定键集白名单对象；多键 / 缺键 / 越界值一律拒绝（FR-046 / P-14）。
 * @param {unknown} raw
 */
function assertPolicy(raw) {
  /** @param {string} field @param {string} hint */
  const fail = (field, hint) => {
    throw new CliError([cliIssue(CLI_ERROR.POLICY, field, hint)]);
  };
  if (!isRecord(raw)) fail('(policy)', 'action.cli.policy_object');
  const policy = /** @type {Record<string, unknown>} */ (raw);
  const keys = Object.keys(policy);
  if (keys.length !== POLICY_KEYS.length || !keys.every((key) => POLICY_KEYS.includes(key))) {
    fail('(policy)', 'action.cli.policy_keys');
  }
  if (typeof policy.language_tag !== 'string' || !LANGUAGE_TAG.test(policy.language_tag)) {
    fail('(policy).language_tag', 'action.cli.policy_language');
  }
  if (typeof policy.guideline_id !== 'string' || !SLUG_ID.test(policy.guideline_id)) {
    fail('(policy).guideline_id', 'action.cli.policy_guideline');
  }
  if (typeof policy.calendar_id !== 'string' || !SLUG_ID.test(policy.calendar_id)) {
    fail('(policy).calendar_id', 'action.cli.policy_calendar');
  }
  if (typeof policy.unit_system !== 'string' || !SLUG_ID.test(policy.unit_system)) {
    fail('(policy).unit_system', 'action.cli.policy_units');
  }
  if (typeof policy.locale_source !== 'string' || !LOCALE_SOURCES.includes(policy.locale_source)) {
    fail('(policy).locale_source', 'action.cli.policy_source');
  }
  return policy;
}

/**
 * @param {Record<string, unknown>} options
 * @param {Record<string, any>} deps
 * @returns {Promise<string[]>}
 */
export async function runPlan(options, deps) {
  const fsPort = requirePort(deps, 'fsPort', 'action.cli.port.fs');
  const clock = requirePort(deps, 'clock', 'action.cli.port.clock');
  const resolveLocalePolicy = requirePort(deps, 'resolveLocalePolicy', 'action.cli.port.policy');
  const loadLanguagePack = requirePort(deps, 'loadLanguagePack', 'action.cli.port.locale');

  if (typeof options.level !== 'string') {
    throw new CliError([cliIssue(CLI_ERROR.OPTION_VALUE, '(options).level', 'action.cli.level')]);
  }
  if (typeof options.profile !== 'string' || options.profile.length === 0) {
    throw new CliError([cliIssue(CLI_ERROR.PROFILE, '(options).profile', 'action.cli.profile_required')]);
  }

  const { values, sources } = await resolveCommandOverrides(options, fsPort, deps.env);
  const profile = await loadProfile(options.profile, fsPort);
  const policy = assertPolicy(await resolveLocalePolicy(profile, values));

  const runDate = typeof options.date === 'string' ? options.date : clock.today();
  const year = Number(runDate.slice(0, 4));
  const cachePath = `data/calendar/${policy.calendar_id}-${year}.md`;
  const calendar = await readCalendarCache(fsPort, cachePath, year);

  const adapter = await loadGuidelineAdapter(fsPort, policy.guideline_id);
  const rx = computeRx(profile.body, adapter);

  // 只覆盖运行日；运行时刻仍取注入时钟，避免伪造 20:00 触发窗口（FR-007）。
  const planObject = buildPlan(options.level, {
    clock: { today: () => runDate, iso: () => clock.iso() },
    profile,
    rx,
    calendar,
    guideline_id: policy.guideline_id,
    language_tag: policy.language_tag,
    locale_source: policy.locale_source,
  });

  const pack = await loadLanguagePack(policy.language_tag);
  const intlFormatter = deps.intlFormatter ?? createIntlFormatter({ locale: policy.language_tag });
  const markdown = render(planObject, pack, intlFormatter);

  const outPath = typeof options.out === 'string' ? options.out : `plans/${planObject.file_name}`;
  await fsPort.writeText(outPath, markdown);

  return [
    line('command', 'plan'),
    line('level', planObject.level),
    line('run_date', planObject.header.run_date),
    line('period_id', planObject.period_id),
    ...(typeof planObject.period.target_date === 'string'
      ? [line('target_date', planObject.period.target_date)]
      : []),
    line('file', outPath),
    line('language_tag', policy.language_tag),
    line('guideline_id', policy.guideline_id),
    line('locale_source', policy.locale_source),
    line('calendar_id', policy.calendar_id),
    line('calendar_cache', cachePath),
    ...overrideLines(sources),
    line('status', 'ok'),
  ];
}
