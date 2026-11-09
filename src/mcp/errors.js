// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-030 · MCP 适配层稳定错误码（FR-030 / FR-048 / P-11）。
 *
 * 与 CLI / 日志层同构：`Error.message` 只拼接稳定码，绝不插值请求正文、
 * 参数值、文件正文或原生异常文本（FR-048）。调用方只需读 `code` 即可分类，
 * 因此「工具描述与错误信息均不含个人数值」是类型层结论，而非事后清洗。
 *
 * 本模块零 IO、零 `node:` 导入，离线门禁可直接引用。
 */

/** @type {Readonly<Record<string, string>>} */
export const MCP_ERROR = Object.freeze({
  INVALID: 'ERR_MCP_INVALID',
  REQUEST: 'ERR_MCP_REQUEST',
  PARSE: 'ERR_MCP_PARSE',
  METHOD: 'ERR_MCP_METHOD',
  ARGS: 'ERR_MCP_ARGS',
  TOOL: 'ERR_MCP_TOOL',
  PORT: 'ERR_MCP_PORT',
  PRIVACY: 'ERR_MCP_PRIVACY',
  PAYLOAD: 'ERR_MCP_PAYLOAD',
  TRANSPORT: 'ERR_MCP_TRANSPORT',
});

/**
 * @typedef {Readonly<{code: string, field: string, hint: string}>} McpIssue
 */

/** @param {string} code @param {string} field @param {string} hint @returns {McpIssue} */
export function mcpIssue(code, field, hint) {
  return Object.freeze({ code, field, hint });
}

/** MCP 域错误：`code` 恒为具体稳定码，`issues` 只含稳定码 / Canonical ID。 */
export class McpError extends Error {
  /** @param {string} code @param {McpIssue[]} [issues] */
  constructor(code, issues = []) {
    const list = issues.map((issue) => Object.freeze({ ...issue }));
    super(`${code}:${list.map((issue) => issue.code).join(',')}`);
    this.name = 'McpError';
    this.code = code;
    this.issues = Object.freeze(list);
  }
}

/** @param {string} code @returns {McpError} */
export function mcpError(code) {
  return new McpError(code, []);
}
