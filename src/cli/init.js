// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-019 · `rr init` —— 初始化本地工作区与台账（FR-029 / FR-046 / P-14）。
 *
 * 只做四件事：校验档案（失败即止）、解析四层覆盖、建立三本只追加台账的表头、
 * 落盘 `rr.config.json` 记录**本次生效的覆盖值**（不含任何身体数据）。
 * 幂等：已存在的文件一律保留原字节，绝不重写表头（E-05 只追加）。
 */
import { loadProfile } from '../core/profile/index.js';
import { HISTORY_PATH, renderLedgerHeader } from '../core/dedup/index.js';
import { FEEDBACK_PATH, CHANGELOG_PATH, renderFeedbackHeader, renderChangelogHeader } from '../core/feedback/index.js';
import { CONFIG_PATH } from './config.js';
import { CLI_ERROR, CliError, cliIssue } from './errors.js';
import { line, overrideLines, requirePort, resolveCommandOverrides } from './shared.js';

/**
 * @param {Record<string, unknown>} options
 * @param {Record<string, any>} deps
 * @returns {Promise<string[]>}
 */
export async function runInit(options, deps) {
  const fsPort = requirePort(deps, 'fsPort', 'action.cli.port.fs');
  if (typeof options.profile !== 'string' || options.profile.length === 0) {
    throw new CliError([cliIssue(CLI_ERROR.PROFILE, '(options).profile', 'action.cli.profile_required')]);
  }

  // 先校验档案：非法档案不留下半个工作区。
  await loadProfile(options.profile, fsPort);

  const { values, sources } = await resolveCommandOverrides(options, fsPort, deps.env);
  // `values` 已含配置层（四层合并），重新落盘即为「本次生效的覆盖值」，幂等。
  const merged = {
    lang: values.lang,
    guideline: values.guideline,
    calendar: values.calendar,
    country: values.country,
  };

  /** @type {Array<[string, string]>} */
  const targets = [
    [CHANGELOG_PATH, renderChangelogHeader()],
    [FEEDBACK_PATH, renderFeedbackHeader()],
    [HISTORY_PATH, renderLedgerHeader()],
    [CONFIG_PATH, `${JSON.stringify(merged, null, 2)}\n`],
  ];
  targets.sort((a, b) => (a[0] < b[0] ? -1 : 1));

  const created = [];
  const kept = [];
  for (const [path, text] of targets) {
    if (await fsPort.exists(path)) {
      kept.push(path);
      continue;
    }
    await fsPort.writeText(path, text);
    created.push(path);
  }

  return [
    line('command', 'init'),
    line('profile', options.profile),
    ...overrideLines(sources),
    ...created.map((path) => line('created', path)),
    ...kept.map((path) => line('kept', path)),
    line('status', 'ok'),
  ];
}
