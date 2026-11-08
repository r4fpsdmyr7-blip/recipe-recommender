// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-015 · `applyDedup(candidate, ledger, window)` 与周计划批量判定（plan.md §6.1）。
 *
 * 纯函数：不触碰 FsPort / ClockPort / NetPort，全部输入经注入；同输入结果逐字节可复现。
 *
 * 规则优先级（FR-015 明定「去重优先级高于周计划」）：
 * 1. 最近 7 天「主菜 + 主食」组合不重复（FR-015 / SC-004）；
 * 2. 同一 ISO 周内主菜标识互斥（FR-016 / AC-08 第二段）；
 * 3. 近 4 周主菜重合 ≤ 2 道（FR-016，周计划层面由 applyDedupWeek 判定）；
 * 4. 节气 / 月份 / 年度周期性重复只在短期窗口**之外**允许，绝不用周期键豁免护栏（FR-017）。
 *
 * 时间线：候选日期 MUST > window.run_date；计划日期 ≤ 运行日属历史快照，
 * 不得追加台账（P-05 / §9 不变式 3）。返回值只含 Canonical ID 与结构化证据，
 * 自然语言「替换原因」由 T-018 / T-031 渲染（P-11）。
 */
import { DEDUP_ERROR, DedupError, dedupIssue } from './errors.js';
import {
  SHORT_TERM_DAYS,
  LOOKBACK_WEEKS,
  WEEK_DAYS,
  MAX_WEEK_OVERLAP,
  DEDUP_STATUS,
  DEDUP_RULE,
  DEDUP_REASON,
  addDays,
  mondayOf,
  comboFingerprint,
  validateCandidate,
  validateLedgerArray,
  validateWindow,
  toLedgerEntry,
} from './contract.js';

/** @param {string} date */
function checkedWindow(date) {
  const weekStart = mondayOf(date);
  return Object.freeze({
    short_term_start: addDays(date, -SHORT_TERM_DAYS),
    short_term_end: addDays(date, -1),
    week_start: weekStart,
    week_end: addDays(weekStart, WEEK_DAYS - 1),
    lookback_start: addDays(weekStart, -LOOKBACK_WEEKS * WEEK_DAYS),
    lookback_end: addDays(weekStart, -1),
  });
}

/**
 * 单候选冲突判定。短期窗口是 `[date-7, date-1]`（不含未来记录）；
 * 周内互斥看同一 ISO 周内**已登记**的主菜标识。
 */
function conflictsFor(mainId, stapleId, date, rows, cw) {
  const combo = comboFingerprint(mainId, stapleId);
  const shortTerm = rows.filter((e) =>
    e.date >= cw.short_term_start && e.date <= cw.short_term_end && e.date < date);
  const sameWeek = rows.filter((e) =>
    e.date >= cw.week_start && e.date <= cw.week_end && e.date < date);
  return {
    shortTerm: shortTerm.some((e) => e.combo_fp === combo),
    weekMain: sameWeek.some((e) => e.main_id === mainId),
  };
}

/** 周期性复用：同主菜 + 同周期键 + 落在短期窗口之外（FR-017 / AC-08）。 */
function periodicReuseFor(mainId, cycleKey, rows, cw) {
  if (!cycleKey) return false;
  return rows.some((e) =>
    e.main_id === mainId && e.cycle_key === cycleKey && e.date < cw.short_term_start);
}

/**
 * @param {string} status
 * @param {ReturnType<typeof validateCandidate>} original
 * @param {ReturnType<typeof validateCandidate> | null} selected
 * @param {string[]} reasonKeys
 * @param {string[]} conflictKeys
 * @param {boolean} periodicReuse
 * @param {ReturnType<typeof checkedWindow>} cw
 */
function result(status, original, selected, reasonKeys, conflictKeys, periodicReuse, cw) {
  return Object.freeze({
    status,
    selected,
    original,
    combo_fp: comboFingerprint(original.main_id, original.staple_id),
    reason_keys: Object.freeze(reasonKeys),
    conflict_keys: Object.freeze(conflictKeys),
    ledger_entry: selected ? toLedgerEntry(selected) : null,
    periodic_reuse: periodicReuse,
    checked_window: cw,
  });
}

/**
 * 单候选去重判定：通过 / 替换建议 / 阻塞，并给出结构化原因。
 *
 * @param {unknown} candidate 候选（主菜 / 主食 / 日期 / 版本 / 备选等）
 * @param {ReadonlyArray<unknown>} ledger 已解析的只读台账行
 * @param {{run_date: string}} window 运行日；窗口长度是常量，不可注入
 */
export function applyDedup(candidate, ledger, window) {
  const w = validateWindow(window);
  const rows = validateLedgerArray(ledger);
  const c = validateCandidate(candidate);
  if (c.date <= w.run_date) {
    throw new DedupError([
      dedupIssue(DEDUP_ERROR.WINDOW, '(candidate).date', 'action.dedup.timeline_historical'),
    ]);
  }
  const cw = checkedWindow(c.date);
  const hit = conflictsFor(c.main_id, c.staple_id, c.date, rows, cw);
  /** @type {string[]} */
  const conflictKeys = [];
  if (hit.shortTerm) conflictKeys.push(DEDUP_RULE.SHORT_TERM_COMBO);
  if (hit.weekMain) conflictKeys.push(DEDUP_RULE.WEEK_MAIN_DUPLICATE);

  /** @type {string[]} */
  const reasons = [];
  if (c.source === 'week_plan' && conflictKeys.length > 0) {
    reasons.push(DEDUP_REASON.OVERRIDE_WEEK_PLAN);
  }
  if (hit.shortTerm) reasons.push(DEDUP_REASON.SHORT_TERM_COMBO);
  if (hit.weekMain) reasons.push(DEDUP_REASON.WEEK_MAIN_DUPLICATE);

  const periodicReuse = periodicReuseFor(c.main_id, c.cycle_key, rows, cw);
  if (conflictKeys.length === 0) {
    if (periodicReuse) reasons.push(DEDUP_REASON.PERIODIC_REUSE);
    return result(DEDUP_STATUS.ACCEPTED, c, c, reasons, conflictKeys, periodicReuse, cw);
  }

  for (const alt of c.alternatives) {
    const altHit = conflictsFor(alt.main_id, alt.staple_id, c.date, rows, cw);
    if (altHit.shortTerm || altHit.weekMain) continue;
    const selected = Object.freeze({
      ...c,
      main_id: alt.main_id,
      staple_id: alt.staple_id,
      cycle_key: alt.cycle_key,
    });
    reasons.push(DEDUP_REASON.REPLACEMENT);
    return result(DEDUP_STATUS.REPLACED, c, selected, reasons, conflictKeys, periodicReuse, cw);
  }

  reasons.push(DEDUP_REASON.NO_ALTERNATIVE);
  return result(DEDUP_STATUS.BLOCKED, c, null, reasons, conflictKeys, periodicReuse, cw);
}

/**
 * 周计划批量判定（FR-016 / SC-004）：恰好 7 天、同一 ISO 周、主标识互不重复、
 * 与最近 4 周主菜重合 ≤ 2 道；逐条仍走 `applyDedup` 的短期与周内护栏。
 *
 * @param {ReadonlyArray<unknown>} candidates
 * @param {ReadonlyArray<unknown>} ledger
 * @param {{run_date: string}} window
 */
export function applyDedupWeek(candidates, ledger, window) {
  validateWindow(window);
  const rows = validateLedgerArray(ledger);
  if (!Array.isArray(candidates) || candidates.length !== WEEK_DAYS) {
    throw new DedupError([
      dedupIssue(DEDUP_ERROR.WEEK, '(week).candidates', 'action.dedup.week_count'),
    ]);
  }
  const cs = candidates.map(validateCandidate);
  const weekStart = mondayOf(cs[0].date);
  for (let i = 0; i < cs.length; i += 1) {
    if (cs[i].date !== addDays(weekStart, i) || cs[i].level !== 'week') {
      throw new DedupError([
        dedupIssue(DEDUP_ERROR.WEEK, `(week).candidates[${i}]`, 'action.dedup.week_span'),
      ]);
    }
  }
  const cw = checkedWindow(weekStart);
  /** @type {string[]} */
  const conflictKeys = [];
  /** @type {string[]} */
  const reasons = [];
  if (new Set(cs.map((c) => c.main_id)).size !== WEEK_DAYS) {
    conflictKeys.push(DEDUP_RULE.WEEK_MAIN_DUPLICATE);
    reasons.push(DEDUP_REASON.WEEK_MAIN_DUPLICATE);
  }

  const weekMains = cs.map((c) => c.main_id);
  const lookback = rows.filter((e) =>
    e.date >= cw.lookback_start && e.date <= cw.lookback_end);
  const overlapIds = [...new Set(lookback.map((e) => e.main_id))]
    .filter((id) => weekMains.includes(id)).sort();
  if (overlapIds.length > MAX_WEEK_OVERLAP) {
    conflictKeys.push(DEDUP_RULE.WEEK_OVERLAP);
    reasons.push(DEDUP_REASON.WEEK_OVERLAP);
  }

  const entries = Object.freeze(cs.map((c) => applyDedup(c, rows, window)));
  for (const entry of entries) {
    for (const key of entry.conflict_keys) {
      if (!conflictKeys.includes(key)) conflictKeys.push(key);
    }
    for (const key of entry.reason_keys) {
      if (!reasons.includes(key)) reasons.push(key);
    }
  }
  const ledgerEntries = Object.freeze(entries
    .filter((e) => e.ledger_entry !== null)
    .map((e) => e.ledger_entry));
  const blocked = conflictKeys.length > 0
    || entries.some((e) => e.status === DEDUP_STATUS.BLOCKED);

  return Object.freeze({
    status: blocked ? DEDUP_STATUS.BLOCKED : DEDUP_STATUS.ACCEPTED,
    entries,
    ledger_entries: ledgerEntries,
    conflict_keys: Object.freeze(conflictKeys),
    reason_keys: Object.freeze(reasons),
    overlap_count: overlapIds.length,
    overlap_ids: Object.freeze(overlapIds),
    week_start: weekStart,
    checked_window: cw,
  });
}
