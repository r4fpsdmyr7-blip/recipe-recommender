// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-020 · `rr delete-data`（FR-047 / FR-049 / AC-17）。
 *
 * 数据主体权利的第二半：**删干净，并当场自证删干净**。
 * - 未显式 `--confirm` 一律零删除：删除不可撤销，不能靠「没传参数就当他不要了」；
 * - 只删用户数据，`data/guideline/` 等程序数据保留（删了程序无法运行，且那不是用户数据）；
 * - 删除后重新扫一遍清单，`residue` 必须为 0；非 0 即失败关闭（SC-013「无残留」）。
 *
 * 删除幂等：数据已清空时再跑一次 `deleted=0`、`residue=0`、退出码 0。
 * 零对外请求：本模块不引用网络端口（FR-048 / SC-013）。
 */
import { CLI_ERROR, CliError, cliIssue } from './errors.js';
import { listDataFiles } from './inventory.js';
import { line, requirePort } from './shared.js';

/**
 * @param {Readonly<Record<string, unknown>>} [options]
 * @param {Record<string, any>} [deps] 必需端口：`fsPort` / `logPort`
 * @returns {Promise<string[]>}
 */
export async function runDeleteData(options = {}, deps = {}) {
  const fsPort = requirePort(deps, 'fsPort', 'action.cli.port_fs');
  const logPort = requirePort(deps, 'logPort', 'action.cli.port_log');

  // 先判意图再碰文件：缺失确认时连一次读都不做，保证「零删除」可静态证明。
  if (options.confirm !== true) {
    throw new CliError([cliIssue(CLI_ERROR.CONFIRM, '(options).confirm', 'action.cli.confirm')]);
  }

  const listed = await listDataFiles(fsPort);
  for (const path of listed) await fsPort.remove(path);

  // 复验：删除后清单必须为空。残留即失败关闭 —— 「报告成功但没删净」是最坏的结果。
  const residue = await listDataFiles(fsPort);
  if (residue.length > 0) {
    throw new CliError([cliIssue(CLI_ERROR.RESIDUE, '(data).residue', 'action.cli.residue')]);
  }

  logPort.record({ event: 'privacy.delete', code: 'ok' });

  return [
    line('command', 'delete-data'),
    line('deleted', listed.length),
    line('residue', residue.length),
    line('status', 'ok'),
  ];
}
