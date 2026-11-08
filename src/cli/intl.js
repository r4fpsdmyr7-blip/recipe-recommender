// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-019 · 零依赖区域格式化器（FR-043 / FR-028 / T-018 契约）。
 *
 * `render(plan, pack, intlFormatter)` 只要求两件事：输出确定、单行、不含竖线与反引号。
 * 本模块用运行时内置 `Intl`（不是第三方依赖、不是在线服务）实现，
 * 只影响**呈现**：切换语言不会改变营养数值、去重指纹或台账哈希（FR-044）。
 */

/** 数值输出上限：超长输出会破坏 Markdown 表格，按契约直接截断为稳定形态。 */
const MAX_LENGTH = 32;

/**
 * @param {{locale?: string}} [options]
 * @returns {Readonly<{number: (value: number, unitKey: string) => string, date: (value: string) => string}>}
 */
export function createIntlFormatter({ locale = 'en' } = {}) {
  const tag = typeof locale === 'string' && locale.length > 0 ? locale : 'en';
  const numbers = new Intl.NumberFormat(tag, { maximumFractionDigits: 2 });
  const dates = new Intl.DateTimeFormat(tag, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'UTC',
  });

  /** @param {string} out */
  const clean = (out) => out.replace(/[\r\n|`]/g, ' ').trim().slice(0, MAX_LENGTH);

  return Object.freeze({
    /** @param {number} value @param {string} _unitKey */
    number: (value, _unitKey) => {
      const numeric = typeof value === 'number' && Number.isFinite(value) ? value : Number(value);
      if (!Number.isFinite(numeric)) return '0';
      return clean(numbers.format(numeric));
    },
    /** @param {string} value YYYY-MM-DD（业务时区日期，按 UTC 零点格式化避免跨日漂移） */
    date: (value) => {
      const at = Date.parse(`${value}T00:00:00Z`);
      if (Number.isNaN(at)) return clean(String(value));
      return clean(dates.format(new Date(at)));
    },
  });
}
