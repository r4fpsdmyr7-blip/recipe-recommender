// SPDX-License-Identifier: GPL-3.0-only
/**
 * IO 端口契约（plan.md §3 / §9 / §10）。
 *
 * 核心域不得直接调用 Node API：时间、文件、网络一律通过注入端口。
 * 本文件只定义 JSDoc 契约、错误码与错误构造器，不含任何 IO 实现。
 */

/**
 * 端口错误码。日志与异常只允许出现这些 ASCII 稳定码，不得包含身体数值或个人信息（FR-049）。
 * @typedef {'ERR_CLOCK_INVALID'|'ERR_FS_PATH_ESCAPE'|'ERR_FS_NOT_FOUND'|'ERR_NET_OFFLINE'|'ERR_NET_BLOCKED_URL'|'ERR_NET_HTTP'} IoErrorCode
 */

/** @type {Readonly<Record<string, IoErrorCode>>} */
export const ERR = Object.freeze({
  CLOCK_INVALID: 'ERR_CLOCK_INVALID',
  FS_PATH_ESCAPE: 'ERR_FS_PATH_ESCAPE',
  FS_NOT_FOUND: 'ERR_FS_NOT_FOUND',
  NET_OFFLINE: 'ERR_NET_OFFLINE',
  NET_BLOCKED_URL: 'ERR_NET_BLOCKED_URL',
  NET_HTTP: 'ERR_NET_HTTP',
});

/**
 * 构造仅携带错误码的端口错误。
 * @param {IoErrorCode} code
 * @param {string} detail 面向开发者的简短说明，MUST NOT 含个人数据
 * @param {unknown} [cause]
 * @returns {Error & {code: IoErrorCode}}
 */
export function ioError(code, detail, cause) {
  const error = new Error(`${code}: ${detail}`);
  // @ts-expect-error 为 Node 风格错误附加稳定码
  error.code = code;
  if (cause !== undefined) {
    // @ts-expect-error 保留原始异常供开发期诊断，不写入用户日志
    error.cause = cause;
  }
  return /** @type {Error & {code: IoErrorCode}} */ (error);
}

/**
 * @typedef {object} ClockPort
 * @property {() => Date} now 当前绝对时刻（UTC）
 * @property {(timeZone?: string) => string} today 业务时区下的 YYYY-MM-DD
 * @property {(timeZone?: string) => string} iso 业务时区下带偏移的完整时间戳
 * @property {string} timeZone 默认业务时区
 */

/**
 * @typedef {object} FsPort
 * @property {(relPath: string) => Promise<string>} readText 读取 UTF-8 文本
 * @property {(relPath: string) => Promise<unknown>} readJson 读取并解析 UTF-8 JSON
 * @property {(relPath: string, text: string) => Promise<void>} writeText 覆盖写入（自动建父目录）
 * @property {(relPath: string, text: string) => Promise<void>} appendText 只追加写入（台账）
 * @property {(relPath: string) => Promise<boolean>} exists 判断存在
 * @property {(relDir?: string) => Promise<string[]>} list 递归列出相对路径（POSIX 分隔）
 * @property {(relPath: string) => Promise<void>} remove 删除文件（数据主体权利，T-020）
 * @property {(relPath: string) => Promise<string>} hash 文件内容的 SHA-256（历史快照基线）
 * @property {(relPath: string) => string} resolve 解析为绝对/规范路径
 */

/**
 * 日志端口（T-020 / FR-041 / FR-049 / NFR-002）。
 * 值只接受 Canonical ID 与稳定码，行内零时间戳；落地仅经注入的 `sink`，缺省不写任何地方。
 * @typedef {object} LogPort
 * @property {string} level 当前级别（info / warn / error）
 * @property {((line: string) => void) | undefined} sink 唯一落地通道
 * @property {(entry: unknown) => string} record 记录一条事件，返回最终写入的行
 * @property {() => string[]} lines 已记录的行（按记录顺序）
 * @property {() => ReadonlyArray<Readonly<Record<string, string>>>} entries 结构化条目（冻结）
 */

/**
 * @typedef {object} NetResponse
 * @property {string} url 实际请求的 URL
 * @property {number} status HTTP 状态码
 * @property {string} text UTF-8 响应正文
 * @property {string} fetchedAt 下载时刻（由注入的 clock 提供，便于确定性断言）
 */

/**
 * @typedef {object} NetRequest
 * @property {string} url
 * @property {string} at
 */

/**
 * 唯一对外出口：时令数据下载。请求 MUST NOT 携带任何个人参数（FR-048）。
 * @typedef {object} NetPort
 * @property {(url: string) => Promise<NetResponse>} download 下载公开静态数据
 * @property {() => boolean} isOffline 是否处于离线模式
 * @property {() => NetRequest[]} requests 已实际发起的请求记录（断网断言用）
 */
