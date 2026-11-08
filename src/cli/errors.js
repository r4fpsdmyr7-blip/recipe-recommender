// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-019 / T-020 · CLI 域错误码（FR-029 / FR-046 / FR-049 / P-11 / P-14）。
 *
 * 与核心域一致：`code` 恒为 `ERR_CLI_INVALID`，具体码在 `issues[].code`；
 * `field` 是参数 / 端口 / 文件位置的稳定标识，`hint` 是指向语言包键的 Canonical ID。
 * 错误消息只拼接稳定码，绝不插值身体数值、文件正文或原生异常文本（FR-049）。
 */

/** @type {Readonly<Record<string, string>>} */
export const CLI_ERROR = Object.freeze({
  INVALID: 'ERR_CLI_INVALID',
  COMMAND: 'ERR_CLI_COMMAND',
  OPTION: 'ERR_CLI_OPTION',
  OPTION_VALUE: 'ERR_CLI_OPTION_VALUE',
  OPTION_DUP: 'ERR_CLI_OPTION_DUP',
  LEVEL: 'ERR_CLI_LEVEL',
  DATE: 'ERR_CLI_DATE',
  TYPE: 'ERR_CLI_TYPE',
  LIMIT: 'ERR_CLI_LIMIT',
  AC: 'ERR_CLI_AC',
  OVERRIDE: 'ERR_CLI_OVERRIDE',
  CONFIG: 'ERR_CLI_CONFIG',
  PORT: 'ERR_CLI_PORT',
  PROFILE: 'ERR_CLI_PROFILE',
  POLICY: 'ERR_CLI_POLICY',
  FILE: 'ERR_CLI_FILE',
  DRIFT: 'ERR_CLI_DRIFT',
  ARGV: 'ERR_CLI_ARGV',
  // T-020：数据主体权利的两种拒绝理由。
  CONFIRM: 'ERR_CLI_CONFIRM',
  RESIDUE: 'ERR_CLI_RESIDUE',
});

/**
 * @typedef {Readonly<{code: string, field: string, hint: string}>} CliIssue
 */

/** @param {string} code @param {string} field @param {string} hint @returns {CliIssue} */
export function cliIssue(code, field, hint) {
  return Object.freeze({ code, field, hint });
}

/** CLI 输入 / 参数 / 端口缺失：一次性汇总全部问题。 */
export class CliError extends Error {
  /** @param {CliIssue[]} issues */
  constructor(issues) {
    const list = issues.map((issue) => Object.freeze({ ...issue }));
    super(`${CLI_ERROR.INVALID}: ${list.map((issue) => issue.code).join(',')}`);
    this.name = 'CliError';
    this.code = CLI_ERROR.INVALID;
    this.issues = Object.freeze(list);
  }
}
