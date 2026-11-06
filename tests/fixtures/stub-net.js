// SPDX-License-Identifier: GPL-3.0-only
import { ERR, ioError } from '../../src/io/ports.js';

/**
 * 下载替身：按 URL 注入成功正文、失败、离线或按调用顺序变化的多源响应，
 * 供 AC-04（下载失败 / 双源冲突）、AC-12 / AC-17（断网零对外请求）确定性复现。
 *
 * responses 的值可以是：
 *   - string 或 {status?, text?}：成功响应
 *   - Error 实例或 {error: IoErrorCode}：注入失败
 *   - 上述值组成的数组：按调用顺序依次返回（模拟多次刷新 / 双源不一致）
 *
 * @param {{responses?: Record<string, unknown>, offline?: boolean, clock?: import('../../src/io/ports.js').ClockPort}} [options]
 * @returns {import('../../src/io/ports.js').NetPort}
 */
export function createStubNet({ responses = {}, offline = false, clock } = {}) {
  /** @type {import('../../src/io/ports.js').NetRequest[]} */
  const log = [];
  /** @type {Map<string, number>} */
  const consumed = new Map();
  const stamp = () => (clock ? clock.iso() : new Date().toISOString());

  return {
    isOffline: () => offline,
    requests: () => log.map((entry) => ({ ...entry })),
    download: async (url) => {
      if (offline) throw ioError(ERR.NET_OFFLINE, '离线模式，未发起任何请求');
      log.push({ url, at: stamp() });
      const configured = responses[url];
      let value = configured;
      if (Array.isArray(configured)) {
        const index = Math.min(consumed.get(url) ?? 0, configured.length - 1);
        value = configured[index];
        consumed.set(url, (consumed.get(url) ?? 0) + 1);
      }
      if (value === undefined) throw ioError(ERR.NET_HTTP, '未配置的下载源');
      if (value instanceof Error) throw value;
      if (typeof value === 'object' && value !== null && 'error' in value) {
        throw ioError(/** @type {any} */ (value).error, '注入的下载失败');
      }
      /** @type {{status?: number, text?: string}} */
      const shaped = typeof value === 'string' ? { text: value } : /** @type {any} */ (value);
      return {
        url,
        status: shaped.status ?? 200,
        text: String(shaped.text ?? ''),
        fetchedAt: stamp(),
      };
    },
  };
}
