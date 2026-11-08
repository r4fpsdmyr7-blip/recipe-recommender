// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-013 · 五级计划生成器单元测试（ATDD 红→绿）。
 *
 * 验收口径：tasks.md T-013 / SPEC.md FR-006～010、FR-009、E-02 / E-05、
 * AC-02 / AC-03、SC-002、§9 不变式 1/2/4、P-05 / P-11；
 * plan.md §5.2 / §6.1 / §7.1 / §7.2 / §7.3。
 *
 * 依赖：T-010（版本集合）、T-011（computeRx）、T-012（切分）、T-002（时钟替身）。
 * T-014 尚未实现：测试注入**完全虚构的只读时令缓存替身**，
 * 不使用任何真实 / 近似节气日期表（FR-012）。
 * 本文件不改变 AC 红态基线（AC-02 / AC-03 仍为 RED：渲染归 T-018、四餐归 T-016）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createFixedClock, createMemoryFs } from '../fixtures/index.js';
import { computeRx } from '../../src/core/rx/index.js';
import {
  PLAN_LEVELS,
  PLAN_ERROR,
  PlanError,
  resolvePlanPeriod,
  resolvePeriodicDispatch,
  buildPeriodicPlan,
  writePeriodicPlan,
  planYear,
  planSeason,
  planMonth,
  planWeek,
  planDay,
  validatePlanHierarchy,
} from '../../src/core/planner/index.js';

const ADAPTER = JSON.parse(readFileSync(
  new URL('../../data/guideline/generic-guideline.json', import.meta.url), 'utf8',
));

/** 完全虚构的身体数据（与 examples/profiles 的虚构量级一致）；不含任何真实个人数值。 */
const BODY = { height_cm: 168, weight_kg: 65, body_fat_pct: 20, bmr_kcal: 1450, sex: 'male' };

function profile(versionTag = 'v1') {
  return {
    versions: Object.fromEntries(
      ['body', 'rx', 'loc', 'st', 'rule'].map((k) => [
        k, { id: `${k}-${versionTag}`, updated_at: '2026-11-01', defaulted: false },
      ]),
    ),
    body: { ...BODY },
  };
}

/** 测试替身：只读时令缓存视图。ID 与日期均为合成值，不是节气近似表。 */
function calendarView(status = 'verified') {
  return {
    cache_id: 'calendar-fixture-2026',
    year: 2026,
    status,
    terms: [
      { id: 'term.fixture_a', at: '2026-02-04T10:00:00+08:00' },
      { id: 'term.fixture_b', at: '2026-04-05T09:00:00+08:00' },
      { id: 'term.fixture_c', at: '2026-11-07T12:00:00+08:00' },
      { id: 'term.fixture_d', at: '2026-12-07T11:00:00+08:00' },
    ],
  };
}

function ctx(iso = '2026-01-01T20:00:00+08:00', overrides = {}) {
  const p = profile();
  return {
    clock: createFixedClock(iso),
    profile: p,
    calendar: calendarView(),
    rx: computeRx(p.body, ADAPTER),
    guideline_id: ADAPTER.id,
    language_tag: 'zh-CN',
    locale_source: 'user',
    ...overrides,
  };
}

const isPlanError = (v) => v instanceof PlanError;
const noChinese = (v) => !/[\u4e00-\u9fff]/.test(JSON.stringify(v));

// ---- FR-007 首日口径 ----

test('T-013 · 年 / 季 / 月首日产出「本周期」而非下一周期（FR-007 / AC-02）', () => {
  const y = resolvePlanPeriod('year', '2026-01-01');
  assert.equal(y.period_id, '2026');
  assert.equal(y.file_name, '2026-annual.md');
  assert.equal(y.start_date, '2026-01-01');
  assert.equal(y.end_date, '2026-12-31');
  assert.equal(y.first_day, true);

  const q = resolvePlanPeriod('season', '2026-04-01');
  assert.equal(q.period_id, '2026-Q2');
  assert.equal(q.file_name, '2026-Q2.md');
  assert.equal(q.start_date, '2026-04-01');
  assert.equal(q.end_date, '2026-06-30');

  const m = resolvePlanPeriod('month', '2026-11-01');
  assert.equal(m.period_id, '2026-11');
  assert.equal(m.file_name, '2026-11-month.md');
  assert.equal(m.start_date, '2026-11-01');
  assert.equal(m.end_date, '2026-11-30');
});

test('T-013 · 周一产出覆盖本周的当周计划，而非下一周（FR-007 / AC-02）', () => {
  const w = resolvePlanPeriod('week', '2026-11-02');
  assert.equal(w.period_id, '2026-W45');
  assert.equal(w.start_date, '2026-11-02');
  assert.equal(w.end_date, '2026-11-08');
  assert.equal(w.file_name, '2026-W45-week.md');
  assert.equal(w.target_date, '2026-11-02');
});

test('T-013 · 日级 20:00 产出次日计划，文件名与标题均为目标日（FR-007 / AC-03）', () => {
  const c = ctx('2026-11-06T20:00:00+08:00');
  const plan = planDay(c);
  assert.equal(plan.level, 'day');
  assert.equal(plan.period.target_date, '2026-11-07');
  assert.equal(plan.period.file_name, '2026-11-07.md');
  assert.equal(plan.header.title, '2026-11-07');
  assert.equal(plan.period.start_date, '2026-11-07');
  assert.equal(plan.period.end_date, '2026-11-07');
  assert.equal(plan.header.trigger, 'plan.trigger.daily_2000');
  assert.notEqual(plan.period.target_date, c.clock.today(), '日任务绝不产出运行当日');
});

test('T-013 · 日任务非 20:00 触发一律拒绝（FR-007 唯一例外）', () => {
  assert.throws(
    () => planDay(ctx('2026-11-06T08:00:00+08:00')),
    (e) => isPlanError(e) && e.issues.some((i) => i.code === PLAN_ERROR.WINDOW),
  );
});

// ---- FR-008 三层合并调度 ----

test('T-013 · 年/季/月合并调度按月份条件产出 1–3 层（FR-008 / AC-02）', () => {
  assert.deepEqual(resolvePeriodicDispatch('2026-01-01'), ['year', 'season', 'month']);
  assert.deepEqual(resolvePeriodicDispatch('2026-04-01'), ['season', 'month']);
  assert.deepEqual(resolvePeriodicDispatch('2026-07-01'), ['season', 'month']);
  assert.deepEqual(resolvePeriodicDispatch('2026-10-01'), ['season', 'month']);
  assert.deepEqual(resolvePeriodicDispatch('2026-11-01'), ['month']);
  assert.deepEqual(resolvePeriodicDispatch('2026-11-06'), []);
});

test('T-013 · 三层合并视图含 AC-02 的三份文件名与刷新标记（FR-008 / FR-009）', () => {
  const view = buildPeriodicPlan(ctx('2026-01-01T20:00:00+08:00'));
  assert.equal(view.path, 'periodic-plan.md');
  assert.deepEqual(view.layers.map((l) => l.level), ['year', 'season', 'month']);
  assert.deepEqual(view.layers.map((l) => l.file_name), [
    '2026-annual.md', '2026-Q1.md', '2026-01-month.md',
  ]);
  assert.deepEqual(view.layers.map((l) => l.refreshed), [true, true, true]);
  assert.equal(view.layers[0].parent, null);
  assert.equal(view.layers[1].parent.period_id, '2026');
  assert.equal(view.layers[2].parent.period_id, '2026-Q1');
  assert.deepEqual(Object.keys(view.version_ids).sort(), ['body', 'loc', 'rule', 'rx', 'st']);
  assert.ok(noChinese(view), '核心域只出 Canonical ID，不出现面向人中文（P-11）');
});

test('T-013 · 非首日不刷新低频层，三层视图仍保留只读沿用信息（FR-008）', () => {
  const view = buildPeriodicPlan(ctx('2026-11-06T20:00:00+08:00'));
  assert.deepEqual(view.layers.map((l) => l.refreshed), [false, false, false]);
  assert.equal(view.layers[2].period_id, '2026-11');
});

// ---- FR-009 计划头部五类版本 + 上承/下接 ----

test('T-013 · 计划头部含五类版本、生成日期、上承/下接与免责 Canonical ID（FR-009 / plan.md §5.2）', () => {
  const plan = planYear(ctx('2026-01-01T20:00:00+08:00'));
  assert.equal(plan.header.period_id, '2026');
  assert.equal(plan.header.generated_date, '2026-01-01');
  assert.equal(plan.header.run_date, '2026-01-01');
  assert.equal(plan.header.version_ids.body, 'body-v1');
  assert.equal(plan.header.version_ids.rule, 'rule-v1');
  assert.equal(plan.header.parent, null);
  assert.deepEqual(plan.header.children.map((c) => c.period_id), [
    '2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4',
  ]);
  assert.equal(plan.header.language_tag, 'zh-CN');
  assert.equal(plan.header.locale_source, 'user');
  assert.equal(plan.header.guideline_id, ADAPTER.id);
  assert.ok(plan.header.notice_keys.includes('plan.notice.disclaimer'));
  assert.ok(plan.header.notice_keys.includes('plan.marker.aigc'));
  assert.ok(plan.header.notice_keys.every((k) => /^[a-z][a-z0-9._-]*$/.test(k)));
  assert.ok(noChinese(plan), '计划对象内无自然语言字符串（P-11 / T-018 渲染）');
  assert.ok(!JSON.stringify(plan).includes('body_fat_pct'), '不嵌入身体数据字段（FR-049）');
});

test('T-013 · 跨月周按「多数天数所属月份」定上承，另一月份仅作衔接参考（E-02）', () => {
  const plan = planWeek(ctx('2026-11-30T08:00:00+08:00'));
  assert.equal(plan.period.period_id, '2026-W49');
  assert.equal(plan.period.start_date, '2026-11-30');
  assert.equal(plan.period.end_date, '2026-12-06');
  assert.equal(plan.header.parent.period_id, '2026-12');
  assert.deepEqual(plan.header.link_references.map((r) => r.period_id), ['2026-11']);
  assert.equal(plan.days.length, 7);
});

// ---- FR-010 非首日补跑 / 执行窗口 ----

test('T-013 · 周中补跑产出完整框架并标注剩余执行窗口（FR-010 / E-05 / P-05）', () => {
  const plan = planWeek(ctx('2026-11-06T08:00:00+08:00'));
  assert.equal(plan.period.period_id, '2026-W45');
  assert.equal(plan.period.first_day, false);
  assert.equal(plan.period.is_catchup, true);
  assert.equal(plan.days.length, 7, '仍产出完整周期框架');
  assert.equal(plan.header.execution_window.total_days, 7);
  assert.equal(plan.header.execution_window.executed_days, 5);
  assert.equal(plan.header.execution_window.remaining_days, 2);
  assert.equal(plan.header.execution_window.start_date, '2026-11-07');
  assert.equal(plan.header.execution_window.end_date, '2026-11-08');
  assert.ok(plan.header.notice_keys.includes('plan.notice.execution_window'));
});

test('T-013 · 首日运行无补跑标注，剩余窗口仍按 T-012 切分（FR-010 / P-05）', () => {
  const plan = planWeek(ctx('2026-11-02T08:00:00+08:00'));
  assert.equal(plan.period.first_day, true);
  assert.equal(plan.period.is_catchup, false);
  assert.equal(plan.header.execution_window.remaining_days, 6);
  assert.equal(plan.header.execution_window.executed_days, 1);
  assert.ok(!plan.header.notice_keys.includes('plan.notice.execution_window'));
});

// ---- T-014 只读缓存边界 ----

test('T-013 · 时令只从注入的只读缓存透传，缺缓存 / 额外键 / 非法状态一律拒绝（FR-012 / T-014 边界）', () => {
  const bad = [
    ctx('2026-01-01T20:00:00+08:00', { calendar: undefined }),
    ctx('2026-01-01T20:00:00+08:00', { calendar: { ...calendarView(), extra: 1 } }),
    ctx('2026-01-01T20:00:00+08:00', { calendar: { ...calendarView(), status: 'unknown' } }),
    ctx('2026-01-01T20:00:00+08:00', { calendar: { ...calendarView(), terms: [{ id: 'term.x' }] } }),
  ];
  for (const c of bad) {
    assert.throws(
      () => planYear(c),
      (e) => isPlanError(e) && e.issues.some((i) => i.code === PLAN_ERROR.CALENDAR),
    );
  }
  const plan = planDay(ctx('2026-11-06T20:00:00+08:00'));
  assert.equal(plan.header.calendar.cache_id, 'calendar-fixture-2026');
  assert.equal(plan.header.calendar.status, 'verified');
});

test('T-013 · FALLBACK 缓存透传标注与人工复核提示，不得静默取近似值（E-03）', () => {
  const plan = planYear(ctx('2026-01-01T20:00:00+08:00', { calendar: calendarView('FALLBACK') }));
  assert.equal(plan.header.calendar.status, 'FALLBACK');
  assert.equal(plan.header.calendar.manual_review_key, 'plan.review.calendar_fallback');
});

// ---- FR-006 上下层一致性 ----

test('T-013 · 五级链路通过处方 / 版本 / 时令一致性校验（FR-006 / §9 不变式 1/2/4）', () => {
  const c = ctx('2026-01-01T20:00:00+08:00');
  const plans = [planYear(c), planSeason(c), planMonth(c), planWeek(c), planDay(c)];
  assert.deepEqual(plans.map((p) => p.level), PLAN_LEVELS);
  for (let i = 0; i < plans.length - 1; i += 1) {
    assert.doesNotThrow(() => validatePlanHierarchy(plans[i], plans[i + 1]));
  }
  assert.equal(plans[4].header.parent.period_id, plans[3].period.period_id);
});

test('T-013 · 下层违反上层处方 / 版本 / 层级顺序一律拒绝（FR-006 / FR-027）', () => {
  const c = ctx('2026-01-01T20:00:00+08:00');
  const parent = planYear(c);
  const child = planSeason(c);

  const rxBroken = structuredClone(child);
  rxBroken.prescription.energy_kcal = [1, 2];
  assert.throws(
    () => validatePlanHierarchy(parent, rxBroken),
    (e) => isPlanError(e) && e.issues.some((i) => i.code === PLAN_ERROR.RX),
  );

  const verBroken = structuredClone(child);
  verBroken.header.version_ids.rule = 'rule-other';
  assert.throws(
    () => validatePlanHierarchy(parent, verBroken),
    (e) => isPlanError(e) && e.issues.some((i) => i.code === PLAN_ERROR.VERSION),
  );

  assert.throws(
    () => validatePlanHierarchy(parent, planDay(c)),
    (e) => isPlanError(e) && e.issues.some((i) => i.code === PLAN_ERROR.LEVEL),
  );
});

// ---- periodic-plan.md 结构视图（渲染归 T-018） ----

test('T-013 · periodic-plan.md 写为确定性 ASCII 结构索引且幂等；只指向未来周期才刷新（P-05 / plan.md §5.3）', async () => {
  const fs = createMemoryFs();
  const view = buildPeriodicPlan(ctx('2026-01-01T20:00:00+08:00'));
  const first = await writePeriodicPlan(fs, view, '2026-01-01');
  assert.equal(first.path, 'periodic-plan.md');
  const text = await fs.readText('periodic-plan.md');
  assert.ok(text.includes('2026-annual.md') && text.includes('2026-Q1.md') && text.includes('2026-01-month.md'));
  assert.ok(/^[\x20-\x7E\n]+$/.test(text), '纯 ASCII 结构索引');
  await writePeriodicPlan(fs, view, '2026-01-01');
  assert.equal(await fs.readText('periodic-plan.md'), text, '同输入字节一致');

  const stale = buildPeriodicPlan(ctx('2026-12-31T20:00:00+08:00'));
  await assert.rejects(
    () => writePeriodicPlan(fs, stale, '2026-12-31'),
    (e) => isPlanError(e) && e.issues.some((i) => i.code === PLAN_ERROR.TIMELINE),
  );
  assert.equal(await fs.readText('periodic-plan.md'), text, '被拒绝的刷新零写入');
});

// ---- 确定性 / 纯净性 / 脱敏 ----

test('T-013 · 处方能量低于 BMR 时拒绝生成计划（§9 不变式 1 / FR-027）', () => {
  const base = ctx('2026-01-01T20:00:00+08:00');
  const broken = { ...base.rx, energy_kcal: [1, 2] };
  assert.throws(
    () => planYear(ctx('2026-01-01T20:00:00+08:00', { rx: broken })),
    (e) => isPlanError(e) && e.issues.some((i) => i.code === PLAN_ERROR.RX),
  );
});

test('T-013 · 纯函数确定性、零 IO、不改写入参；错误只含稳定码（FR-049 / P-11）', () => {
  const c = ctx('2026-01-01T20:00:00+08:00');
  const before = JSON.stringify({ v: c.profile.versions, t: c.calendar.terms });
  const a = planYear(c);
  const b = planYear(c);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(JSON.stringify({ v: c.profile.versions, t: c.calendar.terms }), before);
  assert.ok(!JSON.stringify(a).includes('98765'));

  for (const bad of [{}, ctx('2026-01-01T20:00:00+08:00', { clock: undefined })]) {
    assert.throws(
      () => planYear(bad),
      (e) => isPlanError(e) && /^ERR_PLAN_INVALID: ERR_PLAN_[A-Z_,]+$/.test(e.message),
    );
  }
  try {
    planYear(ctx('2026-01-01T20:00:00+08:00', { calendar: undefined }));
    assert.fail('应拒绝');
  } catch (e) {
    assert.ok(isPlanError(e));
    assert.ok(!e.message.includes('98765'));
    for (const i of e.issues) {
      assert.match(i.code, /^ERR_PLAN_[A-Z_]+$/);
      assert.equal(typeof i.field, 'string');
      assert.match(i.hint, /^[a-z][a-z0-9._-]*$/);
    }
  }
});

test('T-013 · 非法层级 / 非法日期 / 非法语言标签一律拒绝', () => {
  assert.throws(() => resolvePlanPeriod('decade', '2026-01-01'),
    (e) => isPlanError(e) && e.issues.some((i) => i.code === PLAN_ERROR.LEVEL));
  assert.throws(() => resolvePlanPeriod('year', '2026-13-01'),
    (e) => isPlanError(e) && e.issues.some((i) => i.code === PLAN_ERROR.DATE));
  assert.throws(() => planYear(ctx('2026-01-01T20:00:00+08:00', { language_tag: '中文' })),
    (e) => isPlanError(e));
  assert.throws(() => planYear(ctx('2026-01-01T20:00:00+08:00', { locale_source: 'auto:inferred' })),
    (e) => isPlanError(e), '不得静默推断来源（P-12）');
});
