// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-020 · `rr export-data`（FR-047 / FR-049 / AC-17）。
 *
 * 数据主体权利的第一半：**用户能把自己的全部本地数据一次性拿走**。
 * - 清单来自 `inventory.js`（用户数据全量，程序数据永不在内）；
 * - 内容逐字节原样导出，不做脱敏 —— 这正是用户的档案，脱敏等于不给他数据；
 * - 但 CLI 输出行与日志行只有一个计数和稳定码：**导出内容不出现在终端与日志里**（FR-049）。
 *
 * 零对外请求：本模块不引用网络端口，导出全程本地完成（FR-048 / SC-013）。
 */
import { EXPORT_PATH, buildExportText, listDataFiles } from './inventory.js';
import { line, requirePort } from './shared.js';

/**
 * @param {Readonly<Record<string, unknown>>} [options]
 * @param {Record<string, any>} [deps] 必需端口：`fsPort` / `logPort`
 * @returns {Promise<string[]>}
 */
export async function runExportData(options = {}, deps = {}) {
  const fsPort = requirePort(deps, 'fsPort', 'action.cli.port_fs');
  const logPort = requirePort(deps, 'logPort', 'action.cli.port_log');
  const target = typeof options.out === 'string' ? options.out : EXPORT_PATH;

  const listed = await listDataFiles(fsPort);
  /** @type {Array<{path: string, text: string}>} */
  const entries = [];
  for (const path of listed) {
    // 目标文件本身可能是上一次的导出：属用户数据，但不得写进自己（自引用会让文档无限膨胀）。
    if (path === target) continue;
    entries.push({ path, text: await fsPort.readText(path) });
  }

  await fsPort.writeText(target, buildExportText(entries));
  logPort.record({ event: 'privacy.export', code: 'ok' });

  return [
    line('command', 'export-data'),
    line('path', target),
    // 报清单条目数（含目标文件自身），与「正文条目数」最多差 1，见 README「导出计数」。
    line('files', listed.length),
    line('status', 'ok'),
  ];
}
