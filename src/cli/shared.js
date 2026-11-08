// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-019 · 命令公共装配（组合根，plan.md §4 `src/cli/` 职责）。
 *
 * 三条硬约束：
 * 1. **只经注入端口**：fs / clock / net / 区域解析 / 语言包 / 验收执行器全部由调用方注入，
 *    本目录不 `import 'node:*'`，因此可在内存替身上确定复现、且天然零网络（AC-12）。
 * 2. **端口缺失即失败**：不提供「看起来能跑」的兜底实现，避免把 T-031 / T-032 的职责偷偷复刻一份。
 * 3. **输出只剩稳定码**：行格式固定 `key=value`，值只允许 ASCII；不拼接自然语句（FR-041 / P-11）。
 */
import { CLI_ERROR, CliError, cliIssue } from './errors.js';
import { CONFIG_PATH, OVERRIDE_KEYS, parseConfigText, resolveOverrides } from './config.js';

/** 行格式：`key=value`，value 只允许可打印 ASCII。 */
const KEY = /^[a-z][a-z0-9._-]*$/;
const VALUE = /^[\x20-\x7E]*$/;

/**
 * @param {string} key
 * @param {unknown} value
 * @returns {string}
 */
export function line(key, value) {
  const text = String(value);
  if (!KEY.test(key) || !VALUE.test(text)) {
    throw new CliError([cliIssue(CLI_ERROR.INVALID, `(${key})`, 'action.cli.output_ascii')]);
  }
  return `${key}=${text}`;
}

/**
 * 校验必需端口；缺失即 `ERR_CLI_PORT`，不回退到任何内置实现。
 * @param {Record<string, unknown>} deps
 * @param {string} name
 * @param {string} hint
 */
export function requirePort(deps, name, hint) {
  const value = deps?.[name];
  const usable = typeof value === 'function'
    || (typeof value === 'object' && value !== null);
  if (!usable) throw new CliError([cliIssue(CLI_ERROR.PORT, `(deps).${name}`, hint)]);
  return value;
}

/**
 * 读取工作区配置文件；不存在等价于「本层为空」，不算错误。
 * @param {import('../io/ports.js').FsPort} fsPort
 * @returns {Promise<Readonly<Record<string, string|null>>>}
 */
export async function readConfig(fsPort) {
  const exists = typeof fsPort.exists === 'function' ? await fsPort.exists(CONFIG_PATH) : false;
  if (!exists) {
    return Object.freeze(Object.fromEntries(OVERRIDE_KEYS.map((key) => [key, null])));
  }
  return parseConfigText(await fsPort.readText(CONFIG_PATH));
}

/**
 * CLI > 环境变量 > 配置文件 > 自动解析（FR-046）。
 * @param {Record<string, unknown>} options
 * @param {import('../io/ports.js').FsPort} fsPort
 * @param {Record<string, unknown>} env
 */
export async function resolveCommandOverrides(options, fsPort, env = {}) {
  const config = await readConfig(fsPort);
  return resolveOverrides({ options, env, config });
}

/**
 * 覆盖来源行（按键排序，确定可 diff）。
 * @param {Readonly<Record<string, string|null>>} sources
 * @returns {string[]}
 */
export function overrideLines(sources) {
  return OVERRIDE_KEYS
    .filter((key) => sources[key] !== null)
    .sort()
    .map((key) => line('override', `${key}:${sources[key]}`));
}

/**
 * 把任意错误展开为稳定的 `issue` 行：只取稳定码 / 字段 / 提示，绝不含正文或身体数值。
 * @param {any} error
 * @returns {string[]}
 */
export function issueLines(error) {
  const issues = Array.isArray(error?.issues) ? error.issues : [];
  if (issues.length === 0) {
    const code = typeof error?.code === 'string' && /^ERR_[A-Z_]+$/.test(error.code)
      ? error.code
      : CLI_ERROR.INVALID;
    return [line('issue', code)];
  }
  return issues.map((issue) => {
    const code = typeof issue?.code === 'string' ? issue.code : CLI_ERROR.INVALID;
    const field = typeof issue?.field === 'string' ? issue.field : '(unknown)';
    const hint = typeof issue?.hint === 'string' ? issue.hint : 'action.cli.unknown';
    return line('issue', `${code}:${field}:${hint}`);
  });
}

/**
 * 稳定错误码：优先取 `code`，否则归一为 CLI 通用码。
 * @param {any} error
 */
export function errorCode(error) {
  return typeof error?.code === 'string' && /^ERR_[A-Z_]+$/.test(error.code)
    ? error.code
    : CLI_ERROR.INVALID;
}
