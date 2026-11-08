// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-019 · `rr acceptance` —— 执行验收场景（FR-029 / AC-14 / P-02）。
 *
 * 驱动放在 `tests/acceptance/`（P0 基线，不得由实现侧改写），
 * 因此本命令只做**参数转发 + 结果汇报**：执行器由调用方注入（默认入口在 M4 的可执行封装里接线），
 * 这样 `src/cli/` 不反向依赖 `tests/`，也不会让 CLI 变成第二个验收驱动器。
 *
 * `--red-check` 语义：确认「实现存在之前场景确实为红」；若此时已出现绿，说明基线被绕过，
 * 按 P-02 / P-09 直接失败（`ERR_CLI_DRIFT`），而不是继续往下跑。
 */
import { CLI_ERROR, CliError, cliIssue } from './errors.js';
import { line, requirePort } from './shared.js';

/**
 * @param {Record<string, unknown>} options
 * @param {Record<string, any>} deps
 * @returns {Promise<string[]>}
 */
export async function runAcceptance(options, deps) {
  const runner = requirePort(deps, 'acceptanceRunner', 'action.cli.port.acceptance');
  const ac = typeof options.ac === 'string' ? options.ac : 'all';
  const redCheck = options.redCheck === true;

  const result = await runner({ ac, redCheck });
  const red = Number(result?.red ?? 0);
  const green = Number(result?.green ?? 0);

  if (redCheck === true && green > 0) {
    throw new CliError([cliIssue(CLI_ERROR.DRIFT, '(acceptance).green', 'action.cli.red_check')]);
  }

  return [
    line('command', 'acceptance'),
    line('ac', ac),
    line('red', red),
    line('green', green),
    line('status', 'ok'),
  ];
}
