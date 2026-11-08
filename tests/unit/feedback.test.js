// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-017 · 反馈 A/B/C/D 状态机与修订护栏单元测试（ATDD 红→绿）。
 *
 * 验收口径：tasks.md T-017；SPEC.md FR-022～027、FR-041、FR-044、FR-049、
 * AC-10、AC-11、SC-006、E-01 / E-07 / E-09、§9 不变式 3/5、
 * P-05 / P-11 / P-12 / P-14；plan.md §5.3 / §6.1 / §7.2 / §7.3 / §9。
 *
 * 全部问题 / 来源 / 处理 / 状态都是合成 Canonical ID，不含自然语言、真实菜谱、
 * 身体数据或 diet-plan/ 内容（P-11 / P-14）。文件写入只用注入的 createMemoryFs
 * 替身，测试零磁盘落盘、零网络请求；运行日由 createFixedClock 注入。
 *
 * 本文件不改变 AC 红态基线（AC-10 / AC-11 仍为 RED：完整 Markdown 渲染与
 * 端到端调度归 T-018 / T-019）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemoryFs, createFixedClock } from '../fixtures/index.js';
import {
  FEEDBACK_ERROR,
  FeedbackError,
  FEEDBACK_ACTION,
  FEEDBACK_CATEGORY,
  FEEDBACK_STATUS,
  FEEDBACK_COLUMNS,
  CHANGELOG_COLUMNS,
  CHANGELOG_VERSION_KEYS,
  GUARDRAIL_FIELD_KEYS,
  FEEDBACK_PATH,
  CHANGELOG_PATH,
  FEEDBACK_TRANSITIONS,
  validateIssue,
  validateTimeline,
  validatePatch,
  classifyFeedback,
  transitionFeedbackStatus,
  latestStatusById,
  buildFeedbackEntry,
  buildChangelogEntry,
  nextRuleVersionId,
  buildRevisionAnnotation,
  stripRevisionAnnotations,
  renderFeedbackHeader,
  renderFeedbackLine,
  parseFeedbackText,
  appendFeedbackEntry,
  renderChangelogHeader,
  renderChangelogLine,
  parseChangelogText,
  appendChangelogEntry,
  appendFeedbackRecord,
  applyUpstreamRevision,
  applyDownstreamRevision,
  buildFeedbackCheckSection,
  renderFeedbackCheckIndex,
} from '../../src/core/feedback/index.js';

const isFeedbackError = (v) => v instanceof FeedbackError;
const noChinese = (v) => !/[\u4e00-\u9fff]/.test(JSON.stringify(v));

const RUN_DATE = '2026-11-06';
const FUTURE = '2026-11-09';
const PAST = '2026-11-02';
const CLOCK = () => createFixedClock(`${RUN_DATE}T20:00:00+08:00`);
const TIMELINE = Object.freeze({ run_date: RUN_DATE });

const DUAL_SOURCE = Object.freeze(['source.calendar_a', 'source.calendar_b']);

/** 合成问题：只描述「事实」，A/B/C/D 由 classifyFeedback 推导，不由调用方注入。 */
function issue(overrides = {}) {
  return {
    id: 'issue.fact_001',
    date: RUN_DATE,
    kind: 'fact_error',
    direction: 'up',
    origin_level: 'week',
    target_level: 'year',
    plan_date: FUTURE,
    issue_key: 'issue.contradictory_term_at',
    target_key: 'fact.term.lichun.at',
    evidence_ids: [...DUAL_SOURCE],
    ...overrides,
  };
}

const patch = (overrides = {}) => ({
  field_key: 'fact.term.lichun.at',
  from_line: 'fact.term.lichun.at=2026-02-04T12:00:00+08:00',
  to_line: 'fact.term.lichun.at=2026-02-04T11:00:00+08:00',
  ...overrides,
});

const PLAN_LINE = 'fact.term.lichun.at=2026-02-04T12:00:00+08:00';
const USER_NOTE = '<!-- user-note keep-me -->';
const targetText = () => ['# year-plan', PLAN_LINE, USER_NOTE, 'notice_keys=plan.notice.aigc', ''].join('\n');
const otherText = () => ['# week-plan', 'menu=dish.synthetic', ''].join('\n');

/** 3 份历史 + 2 份未来，供 D 类级联切分取证。 */
function planFiles() {
  return [
    { path: 'plan.2026-11-02.md', plan_date: '2026-11-02' },
    { path: 'plan.2026-11-04.md', plan_date: '2026-11-04' },
    { path: `plan.${RUN_DATE}.md`, plan_date: RUN_DATE },
    { path: `plan.${FUTURE}.md`, plan_date: FUTURE },
    { path: 'plan.2026-11-10.md', plan_date: '2026-11-10' },
  ];
}

function seededFs({ withTarget = true } = {}) {
  const files = {};
  for (const f of planFiles()) files[f.path] = otherText();
  if (withTarget) files[`plan.${FUTURE}.md`] = targetText();
  return createMemoryFs({ files });
}

// ---- 基础契约 ----

test('T-017 · 常量契约：路径 / 台账列 / 五类版本 / 七类护栏（FR-022 / FR-027）', () => {
  assert.equal(FEEDBACK_PATH, 'feedback.md');
  assert.equal(CHANGELOG_PATH, 'changelog.md');
  assert.equal(FEEDBACK_COLUMNS.length, 8);
  assert.deepEqual([...FEEDBACK_COLUMNS], ['id', 'date', 'category', 'origin_level', 'issue_key', 'handling_key', 'status', 'landing']);
  assert.equal(CHANGELOG_COLUMNS.length, 7);
  assert.deepEqual([...CHANGELOG_VERSION_KEYS], ['body', 'rx', 'loc', 'st', 'rule']);
  assert.equal(GUARDRAIL_FIELD_KEYS.length, 7);
  assert.deepEqual(Object.values(FEEDBACK_ACTION), ['A', 'B', 'C', 'D1', 'D2']);
  assert.deepEqual(Object.values(FEEDBACK_CATEGORY), ['A', 'B', 'C', 'D']);
});

test('T-017 · issue / timeline / patch 固定键集白名单，额外键一律拒绝（FR-041）', () => {
  assert.doesNotThrow(() => validateIssue(issue()));
  assert.doesNotThrow(() => validateTimeline(TIMELINE));
  assert.doesNotThrow(() => validatePatch(patch()));
  assert.throws(() => validateIssue({ ...issue(), extra: 1 }), isFeedbackError);
  assert.throws(() => validateTimeline({ run_date: RUN_DATE, dates: [] }), isFeedbackError);
  assert.throws(() => validateTimeline({}), isFeedbackError);
  assert.throws(() => validatePatch({ ...patch(), whole_plan: true }), isFeedbackError);
});

// ---- A/B/C/D 分类（FR-022） ----

test('T-017 · A 类：事实错误 + 上行 + 双源 → 已即时修订（AC-10）', () => {
  const c = classifyFeedback(issue(), TIMELINE);
  assert.equal(c.action, FEEDBACK_ACTION.A);
  assert.equal(c.category, FEEDBACK_CATEGORY.A);
  assert.equal(c.status, FEEDBACK_STATUS.REVISED_INPLACE);
  assert.equal(c.historical, false);
  assert.equal(c.applicable, true);
  assert.equal(c.writes_plan_file, true);
  assert.deepEqual([...c.evidence_ids], DUAL_SOURCE);
  assert.ok(c.reason_keys.includes('feedback.reason.dual_source'));
  assert.ok(noChinese(c));
});

test('T-017 · A 类双源取证：不足 2 源 / 同源重复 / 非 source 前缀一律拒绝（FR-023）', () => {
  const bad = [
    { evidence_ids: ['source.calendar_a'] },
    { evidence_ids: ['source.calendar_a', 'source.calendar_a'] },
    { evidence_ids: ['calendar_a', 'calendar_b'] },
    { evidence_ids: [] },
  ];
  for (const o of bad) {
    assert.throws(
      () => classifyFeedback(issue(o), TIMELINE),
      (e) => isFeedbackError(e) && e.issues.some((i) => i.code === FEEDBACK_ERROR.EVIDENCE),
    );
  }
});

test('T-017 · B 类覆盖缺口 → 待采纳提案；不在本级改写上级（FR-022）', () => {
  const c = classifyFeedback(issue({ id: 'issue.gap_002', kind: 'coverage_gap', evidence_ids: [] }), TIMELINE);
  assert.equal(c.action, FEEDBACK_ACTION.B);
  assert.equal(c.status, FEEDBACK_STATUS.PENDING_ADOPTION);
  assert.equal(c.writes_plan_file, false);
  assert.ok(c.reason_keys.includes('feedback.reason.pending_adoption'));
});

test('T-017 · C 类数据变更 → 走版本机制，只交接不自行重算（FR-022 / E-04）', () => {
  const c = classifyFeedback(issue({ id: 'issue.data_003', kind: 'data_change', evidence_ids: [] }), TIMELINE);
  assert.equal(c.action, FEEDBACK_ACTION.C);
  assert.equal(c.status, FEEDBACK_STATUS.VERSION_RECALC);
  assert.equal(c.writes_plan_file, false);
  assert.ok(c.handoff_keys.includes('feedback.handoff.detect_version_changes'));
});

test('T-017 · D1 事实冲突 / D2 框架调整分类，D 类共同归 category D（FR-024）', () => {
  const d1 = classifyFeedback(issue({ id: 'issue.down_004', kind: 'fact_error', direction: 'down', origin_level: 'year', target_level: 'week' }), TIMELINE);
  assert.equal(d1.action, FEEDBACK_ACTION.D1);
  assert.equal(d1.category, FEEDBACK_CATEGORY.D);
  assert.equal(d1.status, FEEDBACK_STATUS.PENDING_RECEIVE);
  const d2 = classifyFeedback(issue({ id: 'issue.down_005', kind: 'framework_change', direction: 'down', origin_level: 'year', target_level: 'week', evidence_ids: [] }), TIMELINE);
  assert.equal(d2.action, FEEDBACK_ACTION.D2);
  assert.equal(d2.status, FEEDBACK_STATUS.PENDING_ALIGNMENT);
});

test('T-017 · 时间线护栏：计划日期 ≤ 运行日一律「已跳过(已执行)」且不写文件（P-05 / SC-006）', () => {
  for (const date of [PAST, RUN_DATE]) {
    const c = classifyFeedback(issue({ plan_date: date }), TIMELINE);
    assert.equal(c.historical, true);
    assert.equal(c.applicable, false);
    assert.equal(c.writes_plan_file, false);
    assert.equal(c.status, FEEDBACK_STATUS.SKIPPED_EXECUTED);
    assert.ok(c.reason_keys.includes('feedback.reason.timeline_immutable'));
  }
});

test('T-017 · 未定义的 (方向, 类型) 组合 / 中文 / 非法日期一律拒绝（FR-041 / P-11）', () => {
  const bad = [
    { kind: 'coverage_gap', direction: 'down' },
    { kind: 'fact_error', direction: 'sideways' },
    { kind: 'unknown', direction: 'up' },
    { issue_key: '矛盾的上级章节' },
    { plan_date: '2026-02-30' },
    { origin_level: 'century' },
  ];
  for (const o of bad) {
    assert.throws(() => classifyFeedback(issue(o), TIMELINE), isFeedbackError);
  }
});

// ---- 状态机与只追加台账（FR-022 / §9 不变式 5） ----

test('T-017 · 状态机白名单：待采纳 / 待接收 / 待对齐 → 已*，非法跃迁拒绝（plan.md §5.3）', () => {
  assert.ok(FEEDBACK_TRANSITIONS[FEEDBACK_STATUS.PENDING_ADOPTION].includes(FEEDBACK_STATUS.ADOPTED));
  assert.ok(FEEDBACK_TRANSITIONS[FEEDBACK_STATUS.PENDING_RECEIVE].includes(FEEDBACK_STATUS.REVISED_DOWNSTREAM));
  assert.ok(FEEDBACK_TRANSITIONS[FEEDBACK_STATUS.PENDING_ALIGNMENT].includes(FEEDBACK_STATUS.ALIGNED));
  const entry = buildFeedbackEntry(classifyFeedback(issue({ kind: 'coverage_gap', evidence_ids: [] }), TIMELINE), 'plan.year.2026');
  const advanced = transitionFeedbackStatus(entry, FEEDBACK_STATUS.ADOPTED);
  assert.equal(advanced.status, FEEDBACK_STATUS.ADOPTED);
  assert.equal(entry.status, FEEDBACK_STATUS.PENDING_ADOPTION, '原行不被就地改写');
  assert.throws(() => transitionFeedbackStatus(entry, FEEDBACK_STATUS.REVISED_INPLACE), isFeedbackError);
});

test('T-017 · 状态流转按追加行解析，latestStatusById 取最后一条（台账只追加）', () => {
  const first = buildFeedbackEntry(classifyFeedback(issue({ kind: 'coverage_gap', evidence_ids: [] }), TIMELINE), 'plan.year.2026');
  const second = transitionFeedbackStatus(first, FEEDBACK_STATUS.ADOPTED);
  const rows = parseFeedbackText(`${renderFeedbackHeader()}${renderFeedbackLine(first)}\n${renderFeedbackLine(second)}\n`);
  assert.equal(rows.length, 2);
  assert.equal(latestStatusById(rows, first.id), FEEDBACK_STATUS.ADOPTED);
  assert.equal(rows[0].status, FEEDBACK_STATUS.PENDING_ADOPTION);
});

test('T-017 · 反馈台账 E-05 首次只写表头零数据行；再次追加后历史字节逐字不变（FR-022）', async () => {
  const fs = createMemoryFs();
  const b = classifyFeedback(issue({ id: 'issue.gap_002', kind: 'coverage_gap', evidence_ids: [] }), TIMELINE);
  const entry = buildFeedbackEntry(b, 'plan.year.2026');
  const r = await appendFeedbackEntry(fs, FEEDBACK_PATH, entry);
  assert.equal(parseFeedbackText(renderFeedbackHeader()).length, 0);
  assert.equal(r.entries_before, 0);
  assert.equal(r.entries_after, 1);
  assert.equal(r.historical_unchanged, true);
  assert.deepEqual(fs.writes().map((w) => w.kind), ['write', 'append']);
  const before = await fs.readText(FEEDBACK_PATH);
  const advanced = transitionFeedbackStatus(entry, FEEDBACK_STATUS.ADOPTED);
  const r2 = await appendFeedbackEntry(fs, FEEDBACK_PATH, advanced);
  assert.equal(r2.entries_before, 1);
  assert.equal(r2.entries_after, 2);
  const after = await fs.readText(FEEDBACK_PATH);
  assert.ok(after.startsWith(before), '历史字节前缀不变');
  assert.equal(parseFeedbackText(after).length, 2);
  assert.deepEqual(fs.writes().map((w) => w.kind), ['write', 'append', 'append']);
});

test('T-017 · 覆盖写冒充 append 立即抛 ERR_FEEDBACK_APPEND（§9 不变式 5）', async () => {
  const fs = createMemoryFs();
  const lying = {
    ...fs,
    appendText: async (p, text) => { await fs.writeText(p, `clobbered\n${text}`); },
  };
  const entry = buildFeedbackEntry(classifyFeedback(issue(), TIMELINE), 'plan.year.2026');
  await assert.rejects(
    () => appendFeedbackEntry(lying, FEEDBACK_PATH, entry),
    (e) => isFeedbackError(e) && e.issues.some((i) => i.code === FEEDBACK_ERROR.APPEND),
  );
});

test('T-017 · 变更记录只追加五类版本，A 类追加 rule- 版本且序号可复算（AC-10 / FR-023）', async () => {
  assert.equal(nextRuleVersionId([]), 'rule-0001');
  assert.equal(nextRuleVersionId([{ version_key: 'rule', version_id: 'rule-0007' }]), 'rule-0008');
  const fs = createMemoryFs();
  const c = classifyFeedback(issue(), TIMELINE);
  const r = await appendFeedbackRecord(fs, {
    classification: c, landing: 'plan.year.2026', ruleVersionId: 'rule-0001',
  });
  assert.equal(parseFeedbackText(await fs.readText(FEEDBACK_PATH)).length, 1);
  const rows = parseChangelogText(await fs.readText(CHANGELOG_PATH));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].version_key, 'rule');
  assert.equal(rows[0].version_id, 'rule-0001');
  assert.equal(rows[0].feedback_id, c.issue_id);
  assert.equal(r.rule_version_id, 'rule-0001');
  assert.deepEqual(fs.writes().map((w) => w.kind), ['write', 'append', 'write', 'append']);
});

test('T-017 · 台账行解析拒绝损坏行 / 未知状态 / 中文，不静默跳过（FR-041）', () => {
  const header = renderFeedbackHeader();
  assert.throws(() => parseFeedbackText(`${header}| only-three | cols |\n`), isFeedbackError);
  assert.throws(() => parseFeedbackText(`${header}| a | b | c | d | e | f | g | 中文 |\n`), isFeedbackError);
  const cl = renderChangelogHeader();
  assert.throws(() => parseChangelogText(`${cl}| a | b | c | d | e | f | g |\n`), isFeedbackError);
});

test('T-017 · 两本台账表头 / 数据行是确定性纯 ASCII，语言无关（FR-044 / P-11）', () => {
  const c = classifyFeedback(issue(), TIMELINE);
  const fe = buildFeedbackEntry(c, 'plan.year.2026');
  const ce = buildChangelogEntry(c, 'rule-0001');
  for (const text of [renderFeedbackHeader(), renderFeedbackLine(fe), renderChangelogHeader(), renderChangelogLine(ce)]) {
    assert.match(text, /^[\x20-\x7E\n]+$/);
  }
  assert.equal(renderFeedbackLine(fe), renderFeedbackLine(buildFeedbackEntry(c, 'plan.year.2026')));
});

// ---- 修订标注与只改错误点（FR-023 / FR-025 / E-07） ----

test('T-017 · 修订标注是单行纯 ASCII，幂等剥离不误删用户批注（E-07 / P-11）', () => {
  const c = classifyFeedback(issue(), TIMELINE);
  const line = buildRevisionAnnotation(c, 'rule-0001');
  assert.ok(line.startsWith('<!-- rr-feedback '));
  assert.match(line, /^[\x20-\x7E]+$/);
  assert.ok(line.includes(`id=${c.issue_id}`) && line.includes('action=A') && line.includes('rule=rule-0001'));
  const text = `${line}\n${line}\n${targetText()}`;
  assert.equal(stripRevisionAnnotations(text), targetText());
  assert.ok(stripRevisionAnnotations(text).includes(USER_NOTE));
});

test('T-017 · patch 不得触碰七类护栏字段，不得多行 / 非 ASCII / 空改（FR-027）', () => {
  for (const field_key of GUARDRAIL_FIELD_KEYS) {
    assert.throws(
      () => validatePatch({ field_key, from_line: `${field_key}=a`, to_line: `${field_key}=b` }),
      (e) => isFeedbackError(e) && e.issues.some((i) => i.code === FEEDBACK_ERROR.GUARDRAIL),
    );
  }
  const bad = [
    { from_line: `${PLAN_LINE}\nextra=1` },
    { from_line: '中文=1' },
    { from_line: PLAN_LINE, to_line: PLAN_LINE },
  ];
  for (const o of bad) assert.throws(() => validatePatch(patch(o)), isFeedbackError);
});

test('T-017 · A 类上行修订：只改一个错误点、头部加标注、历史哈希不变（AC-10 / SC-006）', async () => {
  const fs = seededFs();
  const c = classifyFeedback(issue(), TIMELINE);
  const files = planFiles();
  const historicalBefore = await Promise.all(files.filter((f) => f.plan_date <= RUN_DATE).map((f) => fs.hash(f.path)));
  const r = await applyUpstreamRevision(fs, {
    clock: CLOCK(), classification: c, target: `plan.${FUTURE}.md`,
    patch: patch(), planFiles: files, ruleVersionId: 'rule-0001',
  });
  assert.equal(r.changed_lines, 1);
  assert.equal(r.rule_version_id, 'rule-0001');
  assert.ok(r.annotation.includes('action=A'));
  const text = await fs.readText(`plan.${FUTURE}.md`);
  assert.ok(text.includes(patch().to_line));
  assert.ok(!text.includes(PLAN_LINE));
  assert.ok(text.includes(USER_NOTE), '用户批注逐字保留（E-07）');
  assert.equal(text.split('\n').length, targetText().split('\n').length + 1, '只新增一行标注，未整篇重写');
  assert.deepEqual(
    await Promise.all(files.filter((f) => f.plan_date <= RUN_DATE).map((f) => fs.hash(f.path))),
    historicalBefore,
  );
  assert.deepEqual([...r.untouched], files.filter((f) => f.plan_date <= RUN_DATE).map((f) => f.path));
});

test('T-017 · A 类拒绝历史目标 / 拒绝非 A 分类 / 拒绝 0 或多次命中（FR-023 / P-05）', async () => {
  const c = classifyFeedback(issue(), TIMELINE);
  await assert.rejects(
    () => applyUpstreamRevision(seededFs(), {
      clock: CLOCK(), classification: c, target: `plan.${PAST}.md`,
      patch: patch(), planFiles: planFiles(), ruleVersionId: 'rule-0002',
    }),
    (e) => isFeedbackError(e) && e.issues.some((i) => i.code === FEEDBACK_ERROR.TIMELINE),
  );
  const notA = classifyFeedback(issue({ kind: 'coverage_gap', evidence_ids: [] }), TIMELINE);
  await assert.rejects(
    () => applyUpstreamRevision(seededFs(), {
      clock: CLOCK(), classification: notA, target: `plan.${FUTURE}.md`,
      patch: patch(), planFiles: planFiles(), ruleVersionId: 'rule-0002',
    }),
    isFeedbackError,
  );
  await assert.rejects(
    () => applyUpstreamRevision(seededFs(), {
      clock: CLOCK(), classification: c, target: `plan.${FUTURE}.md`,
      patch: patch({ from_line: 'fact.term.lichun.at=missing-value' }), planFiles: planFiles(), ruleVersionId: 'rule-0002',
    }),
    isFeedbackError,
  );
  const dupFs = seededFs();
  await dupFs.writeText(`plan.${FUTURE}.md`, ['# year-plan', PLAN_LINE, PLAN_LINE, ''].join('\n'));
  await assert.rejects(
    () => applyUpstreamRevision(dupFs, {
      clock: CLOCK(), classification: c, target: `plan.${FUTURE}.md`,
      patch: patch(), planFiles: planFiles(), ruleVersionId: 'rule-0002',
    }),
    isFeedbackError,
  );
});

// ---- D 类下发与时间线护栏（FR-024 / FR-025 / AC-11） ----

test('T-017 · D1 只修订未来下级的事实冲突点，已执行计划哈希完全不变（AC-11 / SC-006）', async () => {
  const fs = seededFs();
  const files = planFiles();
  const c = classifyFeedback(issue({ id: 'issue.down_004', direction: 'down', origin_level: 'year', target_level: 'week' }), TIMELINE);
  const pastFiles = files.filter((f) => f.plan_date <= RUN_DATE);
  const before = await Promise.all(pastFiles.map((f) => fs.hash(f.path)));
  const future = files.filter((f) => f.plan_date > RUN_DATE);
  await fs.writeText('plan.2026-11-10.md', targetText());
  const patches = Object.fromEntries(future.map((f) => [f.path, patch()]));
  const r = await applyDownstreamRevision(fs, {
    clock: CLOCK(), classification: c, planFiles: files, patches, ruleVersionId: 'rule-0003',
  });
  assert.equal(r.updated.length, 2);
  assert.equal(r.skipped.length, 3);
  assert.ok(r.skipped.includes(`plan.${RUN_DATE}.md`), '等号归历史');
  assert.deepEqual(await Promise.all(pastFiles.map((f) => fs.hash(f.path))), before);
  for (const f of future) {
    const text = await fs.readText(f.path);
    assert.ok(text.includes(patch().to_line));
    assert.ok(text.includes('action=D1'));
    assert.equal(text.split('\n').length, targetText().split('\n').length + 1, 'FR-025：未整篇重写、未生成新菜单');
  }
  assert.ok(noChinese(r));
});

test('T-017 · D2 框架调整只在未来计划头部加提示并登记待对齐（FR-024 / AC-11）', async () => {
  const fs = seededFs();
  const c = classifyFeedback(issue({ id: 'issue.down_005', kind: 'framework_change', direction: 'down', origin_level: 'year', target_level: 'week', evidence_ids: [] }), TIMELINE);
  const r = await applyDownstreamRevision(fs, {
    clock: CLOCK(), classification: c, planFiles: planFiles(), patches: {}, ruleVersionId: 'rule-0004',
  });
  assert.equal(r.updated.length, 2);
  assert.equal(r.changed_lines, 0, 'D2 零正文改动');
  for (const p of r.updated) {
    const text = await fs.readText(p);
    assert.ok(text.includes('action=D2'));
    assert.ok(text.includes(`status=${FEEDBACK_STATUS.PENDING_ALIGNMENT}`));
    assert.ok(text.includes(USER_NOTE) || text.includes('menu=dish.synthetic'));
  }
  assert.equal(r.skipped.length, 3);
});

test('T-017 · FR-025：上级不得替下级生成尚不存在的具体菜单（patch 未命中即拒绝）', async () => {
  const fs = seededFs();
  const c = classifyFeedback(issue({ id: 'issue.down_006', direction: 'down', origin_level: 'year', target_level: 'week' }), TIMELINE);
  await assert.rejects(
    () => applyDownstreamRevision(fs, {
      clock: CLOCK(), classification: c, planFiles: planFiles(),
      patches: {
        [`plan.${FUTURE}.md`]: {
          field_key: 'menu.synthetic',
          from_line: 'menu.synthetic=dish.does_not_exist',
          to_line: 'menu.synthetic=dish.replacement',
        },
      },
      ruleVersionId: 'rule-0005',
    }),
    (e) => isFeedbackError(e) && e.issues.some((i) => i.code === FEEDBACK_ERROR.PATCH),
  );
});

test('T-017 · D 类拒绝把 patch 指向历史文件，历史计划零写入（P-05）', async () => {
  const fs = seededFs();
  const c = classifyFeedback(issue({ id: 'issue.down_007', direction: 'down', origin_level: 'year', target_level: 'week' }), TIMELINE);
  await assert.rejects(
    () => applyDownstreamRevision(fs, {
      clock: CLOCK(), classification: c, planFiles: planFiles(),
      patches: { [`plan.${PAST}.md`]: patch() }, ruleVersionId: 'rule-0006',
    }),
    (e) => isFeedbackError(e) && e.issues.some((i) => i.code === FEEDBACK_ERROR.TIMELINE),
  );
  assert.equal((await fs.readText(`plan.${PAST}.md`)), otherText());
});

test('T-017 · A 类写入期间历史文件被改动 → 复验抛 ERR_FEEDBACK_TIMELINE（SC-006）', async () => {
  const fs = seededFs();
  const meddling = {
    ...fs,
    writeText: async (p, text) => {
      await fs.writeText(p, text);
      await fs.writeText(`plan.${PAST}.md`, 'tampered');
    },
  };
  await assert.rejects(
    () => applyUpstreamRevision(meddling, {
      clock: CLOCK(), classification: classifyFeedback(issue(), TIMELINE),
      target: `plan.${FUTURE}.md`, patch: patch(), planFiles: planFiles(), ruleVersionId: 'rule-0010',
    }),
    (e) => isFeedbackError(e) && e.issues.some((i) => i.code === FEEDBACK_ERROR.TIMELINE),
  );
});

test('T-017 · D 类写入期间历史文件被改动 → 复验抛 ERR_FEEDBACK_TIMELINE（SC-006）', async () => {
  const fs = seededFs();
  const meddling = {
    ...fs,
    writeText: async (p, text) => {
      await fs.writeText(p, text);
      await fs.writeText(`plan.${PAST}.md`, 'tampered');
    },
  };
  const c = classifyFeedback(issue({ id: 'issue.down_008', direction: 'down', origin_level: 'year', target_level: 'week' }), TIMELINE);
  await assert.rejects(
    () => applyDownstreamRevision(meddling, {
      clock: CLOCK(), classification: c, planFiles: planFiles(),
      patches: { [`plan.${FUTURE}.md`]: patch() }, ruleVersionId: 'rule-0011',
    }),
    (e) => isFeedbackError(e) && e.issues.some((i) => i.code === FEEDBACK_ERROR.TIMELINE),
  );
});

// ---- FR-026 上级反馈检查章节 ----

test('T-017 · 每份周 / 日计划的「上级反馈检查」覆盖 A/B/C/D 四类与登记 ID（FR-026）', () => {
  const cs = [
    classifyFeedback(issue(), TIMELINE),
    classifyFeedback(issue({ id: 'issue.gap_002', kind: 'coverage_gap', evidence_ids: [] }), TIMELINE),
    classifyFeedback(issue({ id: 'issue.data_003', kind: 'data_change', evidence_ids: [] }), TIMELINE),
    classifyFeedback(issue({ id: 'issue.down_004', direction: 'down', origin_level: 'year', target_level: 'week' }), TIMELINE),
    classifyFeedback(issue({ id: 'issue.down_005', kind: 'framework_change', direction: 'down', origin_level: 'year', target_level: 'week', evidence_ids: [] }), TIMELINE),
  ];
  const section = buildFeedbackCheckSection(cs);
  assert.deepEqual(Object.keys(section.checks), ['A', 'B', 'C', 'D']);
  assert.equal(section.checks.A.checked, 1);
  assert.equal(section.checks.D.checked, 2);
  assert.deepEqual([...section.checks.D.ids], ['issue.down_004', 'issue.down_005']);
  assert.ok(section.notice_keys.length > 0);
  const index = renderFeedbackCheckIndex(section);
  assert.ok(index.startsWith('# feedback-check'));
  assert.match(index, /^[\x20-\x7E\n]+$/);
  assert.ok(index.includes('A_count=1') && index.includes('D_count=2'));
  assert.equal(renderFeedbackCheckIndex(buildFeedbackCheckSection(cs)), index, '同输入逐字节一致');
  assert.ok(noChinese(section) && noChinese(index));
});

test('T-017 · 空反馈也输出四类齐全的检查章节，不虚构记录（E-05 / FR-026）', () => {
  const section = buildFeedbackCheckSection([]);
  assert.deepEqual(Object.keys(section.checks), ['A', 'B', 'C', 'D']);
  for (const c of Object.values(section.checks)) {
    assert.equal(c.checked, 0);
    assert.deepEqual([...c.ids], []);
  }
});

// ---- 脱敏与语言无关性 ----

test('T-017 · 错误只含稳定码 + Canonical ID；分类结果与语言 / 身体数据完全解耦（FR-044 / FR-049）', () => {
  let caught;
  try {
    validateIssue({ ...issue(), extra: 1, id: 'SECRET-98765' });
  } catch (e) {
    caught = e;
  }
  assert.ok(isFeedbackError(caught));
  assert.match(caught.message, /^ERR_FEEDBACK_INVALID: ERR_FEEDBACK_[A-Z_,]+$/);
  assert.ok(!caught.message.includes('98765'));
  for (const i of caught.issues) {
    assert.match(i.code, /^ERR_FEEDBACK_[A-Z_]+$/);
    assert.match(i.hint, /^[a-z][a-z0-9._-]*$/);
  }
  const c = classifyFeedback(issue(), TIMELINE);
  assert.ok(!JSON.stringify(c).includes('bmr_kcal'));
  assert.ok(!JSON.stringify(c).includes('diet-plan'));
});
