// SPDX-License-Identifier: GPL-3.0-only
/**
 * 指南适配器加载器：只经注入的 FsPort 读取 data/guideline/<id>.json。
 * 核心域不直接 import node:fs；id 严格白名单化，防路径穿越。
 */
import {
  GUIDELINE_ID_RE,
  RX_ERROR,
  RxValidationError,
  issue,
  validateGuidelineAdapter,
} from './contract.js';

/**
 * @param {import('../../io/ports.js').FsPort} fsPort
 * @param {string} [id]
 * @returns {Promise<Readonly<Record<string, any>>>}
 */
export async function loadGuidelineAdapter(fsPort, id = 'generic-guideline') {
  if (!fsPort || typeof fsPort.readJson !== 'function') {
    throw new RxValidationError([issue(RX_ERROR.ADAPTER, '(fsPort)', 'action.rx.adapter.inject_fs_port')]);
  }
  if (typeof id !== 'string' || !GUIDELINE_ID_RE.test(id)) {
    throw new RxValidationError([issue(RX_ERROR.ADAPTER, '(id)', 'action.rx.adapter.id')]);
  }

  let raw;
  try {
    raw = await fsPort.readJson(`data/guideline/${id}.json`);
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error)?.code;
    if (typeof code === 'string' && code.startsWith('ERR_FS_')) throw error;
    // 不透传可能含文件内容的原生 SyntaxError.message（FR-049 / plan.md §9）。
    throw new RxValidationError([issue(RX_ERROR.JSON, '(root)', 'action.rx.json.valid_utf8')]);
  }

  const problems = validateGuidelineAdapter(raw);
  if (problems.length > 0) throw new RxValidationError(problems);
  return Object.freeze({ ...structuredClone(raw) });
}
