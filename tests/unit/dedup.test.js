// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-015 · 短期去重与只追加台账单元测试（ATDD 红→绿）。
 *
 * 验收口径：tasks.md T-015；SPEC.md FR-015～018、FR-041、FR-044、AC-07、AC-08、
 * SC-004、E-05、§9 不变式 5、P-05 / P-11 / P-14；plan.md §5.3 / §5.4 / §6.1 / §9。
 *
 * 所有菜品 / 主食 / 周期标识均为合成 Canonical ID 测试替身（如 dish.m01），
 * 不含真实菜谱数据、自然语言或 diet-plan/ 身体数据（P-11 / P-14）。
 * 台账全部经注入的 createMemoryFs 替身，测试零磁盘写入、零网络请求。
 *
 * 本文件不改变 AC 红态基线（AC-07 / AC-08 仍需 T-016 / T-018 / T-019 端到端接线）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemoryFs } from '../fixtures/index.js';
import { VERSION_KEYS } from '../../src/core/profile/index.js';
import {
  DEDUP_ERROR,
  DedupError,
  DEDUP_STATUS,
  DEDUP_REASON,
  DEDUP_RULE,
  HISTORY_PATH,
  SHORT_TERM_DAYS,
  LOOKBACK_WEEKS,
  MAX_WEEK_OVERLAP,
  comboFingerprint,
  validateCandidate,
  validateWindow,
  toLedgerEntry,
  renderLedgerHeader,
  renderLedgerLine,
  parseLedgerText,
  appendDedupEntry,
  applyDedup,
  applyDedupWeek,
} from '../../src/core/dedup/index.js';

const V = Object.freeze(Object.fromEntries(VERSION_KEYS.map((k) => [k, `v-${k}`])));
const isDedupError = (v) => v instanceof DedupError;
const noChinese = (v) => !/[\u4e00-\u9fff]/.test(JSON.stringify(v));

function cand(overrides = {}) {
  return {
    date: '2026-11-07',
    level: 'day',
    period_id: '2026-11-07',
    main_id: 'dish.radish_seabass_stew',
    staple_id: 'staple.rice_brown',
    version_ids: { ...V },
    cycle_key: null,
    source: 'daily',
    alternatives: [],
    ...overrides,
  };
}

/** @param {Record<string, unknown>} [overrides] */
function win(overrides = {}) {
  return { run_date: '2026-11-06', ...overrides };
}

/** @param {Array<[string, string, string, string?]>} specs */
function entries(specs) {
  return specs.map(([date, main, staple, cycle]) => toLedgerEntry(cand({
    date,
    period_id: date,
    main_id: main,
    staple_id: staple,
    cycle_key: cycle ?? null,
  })));
}

const RECENT6 = entries([
  ['2026-11-01', 'dish.m01', 'staple.s01'],
  ['2026-11-02', 'dish.m02', 'staple.s02'],
  ['2026-11-03', 'dish.m03', 'staple.s03'],
  ['2026-11-04', 'dish.m04', 'staple.s04'],
  ['2026-11-05', 'dish.m05', 'staple.s05'],
  ['2026-11-06', 'dish.m06', 'staple.s06'],
]);

// ---- 台账结构与 FR-018 登记字段 ----

test('T-015 · 首次运行空台账从表头初始化，不虚构任何历史记录（E-05 / §9 不变式 5）', () => {
  const header = renderLedgerHeader();
  assert.ok(header.startsWith('# dedup-ledger'));
  assert.deepEqual(parseLedgerText(header), []);
  assert.ok(/^[\x20-\x7E\n]+$/.test(header), '纯 ASCII 可 diff');
  assert.equal(HISTORY_PATH, 'history.md');
  assert.equal(SHORT_TERM_DAYS, 7);
  assert.equal(LOOKBACK_WEEKS, 4);
  assert.equal(MAX_WEEK_OVERLAP, 2);
});

test('T-015 · 台账行登记日期 / 层级 / 周期标识 / 主菜 / 主食 / 指纹 / 版本号（FR-018）', () => {
  const e = toLedgerEntry(cand({ cycle_key: 'term.lidong' }));
  assert.equal(e.date, '2026-11-07');
  assert.equal(e.level, 'day');
  assert.equal(e.period_id, '2026-11-07');
  assert.equal(e.main_id, 'dish.radish_seabass_stew');
  assert.equal(e.staple_id, 'staple.rice_brown');
  assert.equal(e.combo_fp, comboFingerprint(e.main_id, e.staple_id));
  assert.deepEqual(e.version_ids, V);
  assert.equal(e.cycle_key, 'term.lidong');
  assert.equal(e.source, 'daily');
  assert.ok(noChinese(e), '台账只处理 Canonical ID（P-11 / FR-041）');
});

test('T-015 · 台账渲染 / 解析往返一致，且每行恰为 9 列（plan.md §5.3）', () => {
  const rows = [toLedgerEntry(cand()), RECENT6[0]];
  const text = renderLedgerHeader() + rows.map((r) => `${renderLedgerLine(r)}\n`).join('');
  const parsed = parseLedgerText(text);
  assert.deepEqual(parsed, rows);
  assert.equal(renderLedgerLine(rows[0]).split('|').length - 2, 9);
  assert.ok(/^[\x20-\x7E]+$/.test(renderLedgerLine(rows[0])));
});

test('T-015 · 台账损坏行一律拒绝：列数 / 中文 / 指纹篡改 / 版本缺键 / 非数组（FR-041）', () => {
  const header = renderLedgerHeader();
  const line = renderLedgerLine(toLedgerEntry(cand()));
  const bad = [
    header + line.replace('| dish.radish_seabass_stew', '|') + '\n',
    header + line.replace('dish.radish_seabass_stew', '白萝卜炖鲈鱼') + '\n',
    header + line.replace(/fp-[0-9a-f]{8}/, 'fp-deadbeef') + '\n',
    header + line.replace(/,rule:v-rule/, '') + '\n',
  ];
  for (const text of bad) {
    assert.throws(() => parseLedgerText(text), isDedupError);
  }
  assert.throws(() => applyDedup(cand(), /** @type {any} */ ({ entries: [] }), win()), isDedupError);
});

test('T-015 · 组合指纹只由两个 Canonical ID 决定，语言无关（FR-044 / NFR-011）', () => {
  const a = comboFingerprint('dish.m01', 'staple.s01');
  assert.match(a, /^fp-[0-9a-f]{8}$/);
  assert.equal(a, comboFingerprint('dish.m01', 'staple.s01'));
  assert.notEqual(a, comboFingerprint('dish.m01', 'staple.s02'));
  assert.notEqual(a, comboFingerprint('dish.m02', 'staple.s01'));
  assert.throws(() => comboFingerprint('白萝卜炖鲈鱼', 'staple.s01'), isDedupError);
});

// ---- FR-015 / AC-07 短期去重 ----

test('T-015 · AC-07：最近 6 天台账 + 第 7 天新组合 → 通过且可追加台账', () => {
  const result = applyDedup(cand(), RECENT6, win());
  assert.equal(result.status, DEDUP_STATUS.ACCEPTED);
  assert.deepEqual(result.conflict_keys, []);
  assert.equal(result.combo_fp, comboFingerprint('dish.radish_seabass_stew', 'staple.rice_brown'));
  assert.equal(result.checked_window.short_term_start, '2026-10-31');
  assert.equal(result.checked_window.short_term_end, '2026-11-06');
  assert.ok(result.ledger_entry, '通过时给出待追加台账行');
  assert.equal(result.ledger_entry.date, '2026-11-07');
});

test('T-015 · 组合落在最近 7 天 → 拒绝，且不生成台账追加行（FR-015 / SC-004）', () => {
  const result = applyDedup(
    cand({ main_id: 'dish.m03', staple_id: 'staple.s03' }),
    RECENT6,
    win(),
  );
  assert.equal(result.status, DEDUP_STATUS.BLOCKED);
  assert.ok(result.conflict_keys.includes(DEDUP_RULE.SHORT_TERM_COMBO));
  assert.ok(result.reason_keys.includes(DEDUP_REASON.SHORT_TERM_COMBO));
  assert.equal(result.ledger_entry, null);
  assert.equal(result.selected, null);
});

test('T-015 · 恰好 7 天前仍拒绝、第 8 天前允许；窗口长度不可被注入放宽', () => {
  const target = '2026-11-08';
  const c = (overrides = {}) => cand({ date: target, period_id: target, ...overrides });
  const w = win({ run_date: '2026-11-07' });

  const onBoundary = entries([['2026-11-01', 'dish.m01', 'staple.s01']]);
  const outside = entries([['2026-10-31', 'dish.m01', 'staple.s01']]);
  assert.equal(applyDedup(c({ main_id: 'dish.m01', staple_id: 'staple.s01' }), onBoundary, w).status, DEDUP_STATUS.BLOCKED);
  assert.equal(applyDedup(c({ main_id: 'dish.m01', staple_id: 'staple.s01' }), outside, w).status, DEDUP_STATUS.ACCEPTED);

  assert.throws(
    () => validateWindow({ run_date: '2026-11-06', short_term_days: 1 }),
    (e) => isDedupError(e) && e.issues.some((i) => i.code === DEDUP_ERROR.WINDOW),
  );
});

test('T-015 · 去重优先级高于周计划：week_plan 来源冲突仍被拒并标注覆盖原因（AC-07）', () => {
  const result = applyDedup(
    cand({
      source: 'week_plan',
      main_id: 'dish.m03',
      staple_id: 'staple.s03',
    }),
    RECENT6,
    win(),
  );
  assert.equal(result.status, DEDUP_STATUS.BLOCKED);
  assert.ok(result.reason_keys.includes(DEDUP_REASON.OVERRIDE_WEEK_PLAN));
  assert.ok(result.reason_keys.includes(DEDUP_REASON.SHORT_TERM_COMBO));
});

test('T-015 · 冲突时给出替换建议并说明原因；备选同样冲突则阻塞（FR-015）', () => {
  const alternatives = [
    { main_id: 'dish.m03', staple_id: 'staple.s03' },
    { main_id: 'dish.alt_01', staple_id: 'staple.alt_01' },
  ];
  const replaced = applyDedup(
    cand({ main_id: 'dish.m03', staple_id: 'staple.s03', alternatives }),
    RECENT6,
    win(),
  );
  assert.equal(replaced.status, DEDUP_STATUS.REPLACED);
  assert.equal(replaced.selected.main_id, 'dish.alt_01');
  assert.notEqual(replaced.selected.main_id, replaced.original.main_id);
  assert.ok(replaced.reason_keys.includes(DEDUP_REASON.REPLACEMENT));
  assert.ok(replaced.ledger_entry.main_id === 'dish.alt_01');

  const blocked = applyDedup(
    cand({ main_id: 'dish.m03', staple_id: 'staple.s03', alternatives: [alternatives[0]] }),
    RECENT6,
    win(),
  );
  assert.equal(blocked.status, DEDUP_STATUS.BLOCKED);
  assert.ok(blocked.reason_keys.includes(DEDUP_REASON.NO_ALTERNATIVE));
  assert.equal(blocked.ledger_entry, null);
});

// ---- FR-016 / FR-017 / AC-08 周内互斥与周期性重复 ----

test('T-015 · 主菜相同但主食不同：不同周允许、同一周内仍拒绝（FR-015 / AC-08 第二段）', () => {
  const c = (main, staple) => cand({ main_id: main, staple_id: staple });
  const previousWeek = entries([['2026-10-28', 'dish.m01', 'staple.s01']]);
  assert.equal(applyDedup(c('dish.m01', 'staple.alt_01'), previousWeek, win()).status, DEDUP_STATUS.ACCEPTED);

  const sameWeek = entries([['2026-11-04', 'dish.m01', 'staple.s01']]);
  const blocked = applyDedup(c('dish.m01', 'staple.alt_01'), sameWeek, win());
  assert.equal(blocked.status, DEDUP_STATUS.BLOCKED);
  assert.ok(blocked.conflict_keys.includes(DEDUP_RULE.WEEK_MAIN_DUPLICATE));
  assert.equal(blocked.checked_window.week_start, '2026-11-02');
});

test('T-015 · AC-08：去年同一节气代表菜今年复用允许，并留周期性复用痕迹（FR-017）', () => {
  const ledger = entries([['2025-11-07', 'dish.radish_seabass_stew', 'staple.rice_brown', 'term.lidong']]);
  const result = applyDedup(cand({ cycle_key: 'term.lidong' }), ledger, win());
  assert.equal(result.status, DEDUP_STATUS.ACCEPTED);
  assert.equal(result.periodic_reuse, true);
  assert.ok(result.reason_keys.includes(DEDUP_REASON.PERIODIC_REUSE));
  assert.equal(result.ledger_entry.cycle_key, 'term.lidong');
});

test('T-015 · 周期性重复不得豁免短期窗口：cycle_key 相同但落在 7 天内仍拒绝（FR-017）', () => {
  const ledger = entries([['2026-11-05', 'dish.radish_seabass_stew', 'staple.rice_brown', 'term.lidong']]);
  const result = applyDedup(cand({ cycle_key: 'term.lidong' }), ledger, win());
  assert.equal(result.status, DEDUP_STATUS.BLOCKED);
  assert.equal(result.periodic_reuse, false);
  assert.ok(result.conflict_keys.includes(DEDUP_RULE.SHORT_TERM_COMBO));
});

test('T-015 · 周计划 7 天主标识互不重复 → 通过（FR-016 / SC-004）', () => {
  const candidates = Array.from({ length: 7 }, (_, i) => cand({
    date: `2026-11-${String(2 + i).padStart(2, '0')}`,
    period_id: '2026-W45',
    level: 'week',
    main_id: `dish.w${String(i + 1).padStart(2, '0')}`,
    staple_id: `staple.w${String(i + 1).padStart(2, '0')}`,
  }));
  const result = applyDedupWeek(candidates, [], win({ run_date: '2026-11-01' }));
  assert.equal(result.status, DEDUP_STATUS.ACCEPTED);
  assert.equal(result.entries.length, 7);
  assert.equal(result.ledger_entries.length, 7);
  assert.equal(result.week_start, '2026-11-02');
  assert.equal(result.overlap_count, 0);
});

test('T-015 · 周计划内部出现相同主菜标识 → 阻塞（FR-016）', () => {
  const candidates = Array.from({ length: 7 }, (_, i) => cand({
    date: `2026-11-${String(2 + i).padStart(2, '0')}`,
    period_id: '2026-W45',
    level: 'week',
    main_id: i === 5 ? 'dish.w01' : `dish.w${String(i + 1).padStart(2, '0')}`,
    staple_id: `staple.w${String(i + 1).padStart(2, '0')}`,
  }));
  const result = applyDedupWeek(candidates, [], win({ run_date: '2026-11-01' }));
  assert.equal(result.status, DEDUP_STATUS.BLOCKED);
  assert.ok(result.conflict_keys.includes(DEDUP_RULE.WEEK_MAIN_DUPLICATE));
});

test('T-015 · 近 4 周主菜重合恰好 2 道允许（FR-016 / SC-004）', () => {
  const candidates = Array.from({ length: 7 }, (_, i) => cand({
    date: `2026-11-${String(2 + i).padStart(2, '0')}`,
    period_id: '2026-W45',
    level: 'week',
    main_id: `dish.w${String(i + 1).padStart(2, '0')}`,
    staple_id: `staple.w${String(i + 1).padStart(2, '0')}`,
  }));
  const ledger = entries([
    ['2026-10-08', 'dish.w01', 'staple.s01'],
    ['2026-10-20', 'dish.w02', 'staple.s02'],
  ]);
  const result = applyDedupWeek(candidates, ledger, win({ run_date: '2026-11-01' }));
  assert.equal(result.status, DEDUP_STATUS.ACCEPTED);
  assert.equal(result.overlap_count, 2);
  assert.deepEqual(result.overlap_ids, ['dish.w01', 'dish.w02']);
  assert.equal(result.checked_window.lookback_start, '2026-10-05');
  assert.equal(result.checked_window.lookback_end, '2026-11-01');
});

test('T-015 · 近 4 周主菜重合 3 道 → 阻塞（FR-016 / SC-004）', () => {
  const candidates = Array.from({ length: 7 }, (_, i) => cand({
    date: `2026-11-${String(2 + i).padStart(2, '0')}`,
    period_id: '2026-W45',
    level: 'week',
    main_id: `dish.w${String(i + 1).padStart(2, '0')}`,
    staple_id: `staple.w${String(i + 1).padStart(2, '0')}`,
  }));
  const ledger = entries([
    ['2026-10-08', 'dish.w01', 'staple.s01'],
    ['2026-10-20', 'dish.w02', 'staple.s02'],
    ['2026-10-28', 'dish.w03', 'staple.s03'],
  ]);
  const result = applyDedupWeek(candidates, ledger, win({ run_date: '2026-11-01' }));
  assert.equal(result.status, DEDUP_STATUS.BLOCKED);
  assert.equal(result.overlap_count, 3);
  assert.ok(result.conflict_keys.includes(DEDUP_RULE.WEEK_OVERLAP));
  assert.ok(result.reason_keys.includes(DEDUP_REASON.WEEK_OVERLAP));
});

// ---- 台账只追加（§9 不变式 5 / P-05） ----

test('T-015 · 台账只追加：历史行逐字节不变、后续写入全部为 append 类型（FR-018）', async () => {
  const fs = createMemoryFs();
  const e1 = toLedgerEntry(cand());
  const e2 = toLedgerEntry(cand({ date: '2026-11-08', period_id: '2026-11-08', main_id: 'dish.m02', staple_id: 'staple.s02' }));

  const first = await appendDedupEntry(fs, HISTORY_PATH, e1);
  assert.equal(first.historical_unchanged, true);
  const text1 = await fs.readText(HISTORY_PATH);
  assert.equal(parseLedgerText(text1).length, 1);

  const second = await appendDedupEntry(fs, HISTORY_PATH, e2);
  assert.equal(second.historical_unchanged, true);
  const text2 = await fs.readText(HISTORY_PATH);
  assert.ok(text2.startsWith(text1), '历史字节前缀完全不变');
  assert.equal(text2.slice(text1.length), second.line, '新增部分恰好只有一行');
  assert.deepEqual(parseLedgerText(text2)[0], parseLedgerText(text1)[0], '历史行未被回改');
  assert.equal(parseLedgerText(text2).length, 2);
  assert.deepEqual(fs.writes().map((w) => w.kind), ['write', 'append', 'append']);
});

test('T-015 · 若追加端口实际覆盖写 → 检出历史被破坏并拒绝（§9 不变式 5）', async () => {
  const fs = createMemoryFs();
  await appendDedupEntry(fs, HISTORY_PATH, toLedgerEntry(cand()));
  const broken = {
    ...fs,
    appendText: async (path, text) => fs.writeText(path, text),
  };
  await assert.rejects(
    () => appendDedupEntry(broken, HISTORY_PATH, toLedgerEntry(cand({ main_id: 'dish.m02', staple_id: 'staple.s02' }))),
    (e) => isDedupError(e) && e.issues.some((i) => i.code === DEDUP_ERROR.APPEND),
  );
});

// ---- 输入护栏 / 脱敏 / 确定性 ----

test('T-015 · 版本号固定键集：缺键 / 多键 / 非法 ID 一律拒绝（FR-018 / FR-001）', () => {
  const missing = { ...V };
  delete missing.rule;
  const cases = [missing, { ...V, extra: 'x' }, { ...V, body: 'not valid!' }];
  for (const version_ids of cases) {
    assert.throws(
      () => validateCandidate(cand({ version_ids })),
      (e) => isDedupError(e) && e.issues.some((i) => i.code === DEDUP_ERROR.VERSION),
    );
  }
  assert.deepEqual(Object.keys(V).sort(), [...VERSION_KEYS].sort());
});

test('T-015 · Canonical ID / 固定键集 / 周期键 / 时间线护栏（FR-041 / P-05 / P-11）', () => {
  const bad = [
    cand({ main_id: '白萝卜炖鲈鱼' }),
    cand({ staple_id: 'Staple.Upper' }),
    cand({ extra: 1 }),
    cand({ cycle_key: 'term.立冬' }),
    cand({ source: 'unknown' }),
  ];
  for (const c of bad) assert.throws(() => validateCandidate(c), isDedupError);
  assert.throws(() => validateWindow({}), isDedupError);
  assert.throws(
    () => applyDedup(cand({ date: '2026-11-06', period_id: '2026-11-06' }), [], win()),
    (e) => isDedupError(e) && e.issues.some((i) => i.code === DEDUP_ERROR.WINDOW),
    '计划日期 ≤ 运行日属历史，不得追加台账',
  );
});

test('T-015 · 错误只含稳定码 + Canonical ID；纯函数确定、零 IO 注入（FR-049 / P-11）', () => {
  let caught;
  try {
    validateCandidate(cand({ main_id: '98765', extra: 1 }));
  } catch (e) {
    caught = e;
  }
  assert.ok(isDedupError(caught));
  assert.match(caught.message, /^ERR_DEDUP_INVALID: ERR_DEDUP_[A-Z_,]+$/);
  assert.ok(!caught.message.includes('98765'), '错误不含身体数值 / 原始输入');
  for (const i of caught.issues) {
    assert.match(i.code, /^ERR_DEDUP_[A-Z_]+$/);
    assert.match(i.hint, /^[a-z][a-z0-9._-]*$/);
  }

  const a = applyDedup(cand(), RECENT6, win());
  const b = applyDedup(cand(), RECENT6, win());
  assert.deepEqual(a, b, '同输入结果完全一致');
  assert.ok(noChinese(a), '结果零自然语句');
  assert.ok(!JSON.stringify(a).includes('98765') && !JSON.stringify(a).includes('bmr_kcal'));
  assert.equal(RECENT6.length, 6, '台账入参未被改写');
});
