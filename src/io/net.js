// SPDX-License-Identifier: GPL-3.0-only
import { ERR, ioError } from './ports.js';

/**
 * 结构性隐私护栏：时令数据是公开静态文件，下载请求不需要任何参数。
 * 因此禁止 query / fragment / userinfo / 非 HTTPS，使「不含个人参数」可被静态证明（FR-048 / AC-17）。
 * 双源交叉校验与缓存落盘属于 T-014，不在本端口实现。
 * @param {string} url
 * @returns {URL}
 */
export function assertSafeCalendarUrl(url) {
  /** @type {URL} */
  let parsed;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw ioError(ERR.NET_BLOCKED_URL, 'URL 无法解析', error);
  }
  if (parsed.protocol !== 'https:') {
    throw ioError(ERR.NET_BLOCKED_URL, '仅允许 HTTPS');
  }
  if (parsed.username || parsed.password) {
    throw ioError(ERR.NET_BLOCKED_URL, 'URL 不得含凭据');
  }
  if (parsed.search || parsed.hash) {
    throw ioError(ERR.NET_BLOCKED_URL, '时令数据 URL 不得携带查询参数或片段');
  }
  return parsed;
}

/**
 * 唯一对外出口。fetchImpl 可注入；offline 时连请求都不发起，requests() 保持为空。
 * @param {{fetchImpl?: typeof globalThis.fetch, offline?: boolean, allowedHosts?: string[], clock?: import('./ports.js').ClockPort}} [options]
 * @returns {import('./ports.js').NetPort}
 */
export function createNetPort({ fetchImpl = globalThis.fetch, offline = false, allowedHosts = [], clock } = {}) {
  /** @type {import('./ports.js').NetRequest[]} */
  const log = [];
  const isOffline = () => offline || typeof fetchImpl !== 'function';
  const stamp = () => (clock ? clock.iso() : new Date().toISOString());

  return {
    isOffline,
    requests: () => log.map((entry) => ({ ...entry })),
    download: async (url) => {
      const parsed = assertSafeCalendarUrl(url);
      if (allowedHosts.length > 0 && !allowedHosts.includes(parsed.host)) {
        throw ioError(ERR.NET_BLOCKED_URL, '主机不在允许清单内');
      }
      if (isOffline()) {
        throw ioError(ERR.NET_OFFLINE, '离线模式，未发起任何请求');
      }
      log.push({ url, at: stamp() });
      const response = await fetchImpl(url, {
        method: 'GET',
        redirect: 'error',
        headers: { accept: 'text/plain;charset=utf-8, text/markdown, application/json' },
      });
      if (!response.ok) {
        throw ioError(ERR.NET_HTTP, `下载失败，HTTP ${response.status}`);
      }
      return {
        url,
        status: response.status,
        text: await response.text(),
        fetchedAt: stamp(),
      };
    },
  };
}
