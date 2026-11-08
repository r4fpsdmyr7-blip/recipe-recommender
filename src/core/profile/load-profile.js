// SPDX-License-Identifier: GPL-3.0-only
/**
 * `loadProfile(path, fsPort)` → Profile（plan.md §6.1 / tasks.md T-010）。
 *
 * 核心域不直接 import node:fs：文件读取只经注入的 FsPort.readJson。
 * 不注入 clock / net，加载过程零对外请求、结果确定可复现（plan.md §3 / FR-048）。
 */
import { issue, PROFILE_ERROR, ProfileValidationError } from './errors.js';
import { validateProfile } from './validate.js';
import { normalizeVersions } from './versions.js';

/**
 * 纯函数入口：校验并规范化一个已解析的 Profile 候选。
 * 成功返回新对象（输入不被改写）；失败抛 ProfileValidationError，
 * issues 汇总全部问题，且不含任何身体数值（FR-049）。
 *
 * @param {unknown} raw
 * @returns {Record<string, any>}
 */
export function parseProfile(raw) {
  const problems = validateProfile(raw);
  if (problems.length > 0) throw new ProfileValidationError(problems);

  const original = /** @type {Record<string, any>} */ (raw);
  const profile = structuredClone(original);
  const { versions, meta } = normalizeVersions(original.versions);
  profile.versions = versions;
  profile.versioning = meta;
  return profile;
}

/**
 * 从注入的文件端口加载 Profile。
 * IO 端口错误（ERR_FS_*）原样传播；JSON 解析失败包装为稳定码，
 * 绝不透传可能含文件内容的原生 SyntaxError 消息。
 *
 * @param {string} path 相对 FsPort root 的路径
 * @param {import('../io/ports.js').FsPort} fsPort
 * @returns {Promise<Record<string, any>>}
 */
export async function loadProfile(path, fsPort) {
  if (!fsPort || typeof fsPort.readJson !== 'function') {
    throw new ProfileValidationError([
      issue(PROFILE_ERROR.SCHEMA, '(fsPort)', 'action.profile.inject_fs_port'),
    ]);
  }

  let raw;
  try {
    raw = await fsPort.readJson(path);
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error)?.code;
    if (typeof code === 'string' && code.startsWith('ERR_FS_')) throw error;
    throw new ProfileValidationError([
      issue(PROFILE_ERROR.JSON, '(root)', 'action.profile.valid_utf8_json'),
    ]);
  }
  return parseProfile(raw);
}
