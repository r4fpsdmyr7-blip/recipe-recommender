// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-014 · 历法适配器与节气缓存刷新单元测试（ATDD 红→绿）。
 *
 * 验收口径：tasks.md T-014；SPEC.md FR-011～013、FR-048、E-01 / E-03、
 * AC-04、SC-005、NFR-001、§9 不变式 2、P-11；plan.md §5.3 / §7.1 / §9。
 *
 * 依赖 T-002（createNetPort / createStubNet / createFixedClock / createMemoryFs），
 * 并与 T-013 的只读缓存视图契约对齐。**所有节气数据均为合成测试替身**
 * （term.fixture_*），不是真实 / 近似节气表（FR-012）。
 * 联网全部经注入的 netPort 替身，本测试零真实网络请求。
 *
 * 本文件不改变 AC 红态基线（AC-04 仍为 RED：年计划渲染与端到端调度归 T-018 / T-019）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createFixedClock, createMemoryFs, createStubNet } from '../fixtures/index.js';
import { ERR } from '../../src/io/index.js';
import { readCalendarView } from '../../src/core/planner/calendar.js';
import {
  CALENDAR_ERROR,
  CalendarError,
  CALENDAR_KIND,
  validateCalendarAdapter,
  normalizeUtc8,
  parseTermTable,
  crossCheckSources,
  renderCacheText,
  cachePathFor,
  refreshCalendarData,
  readCalendarCache,
  resolveActiveTerm,
} from '../../src/core/calendar/index.js';

const YEAR = 2027;
const URL_A = 'https://fixture-a.example.org/solar-terms/2027.txt';
const URL_B = 'https://fixture-b.example.org/solar-terms/2027.txt';
const CLOCK = () => createFixedClock('2027-01-01T08:00:00+08:00');

const pad2 = (n) => String(n).padStart(2, '0');

/** 24 条合成时令数据；两种写法表示同一组时刻（UTC+8 与 UTC）。 */
function sourceText(year = YEAR, format = 'utc8', mutate = null) {
  return Array.from({ length: 24 }, (_, i) => {
    const mm = pad2(Math.floor(i / 2) + 1);
    const dd = i % 2 === 0 ? '05' : '20';
    const id = `term.fixture_${pad2(i + 1)}`;
    const longitude = (i * 15).toFixed(1);
    const at = format === 'utc'
      ? `${year}-${mm}-${dd}T02:00:00Z`
      : `${year}-${mm}-${dd}T10:00:00+08:00`;
    const row = { id, longitude_deg: longitude, at };
    const changed = mutate ? mutate(row, i) : row;
    return `term id=${changed.id} longitude_deg=${changed.longitude_deg} at=${changed.at}`;
  }).join('\n');
}

function solarAdapter(overrides = {}) {
  return {
    id: 'solar-terms',
    version: '1.0.0',
    kind: CALENDAR_KIND.SOLAR_TERMS,
    expected_count: 24,
    notice_key: 'calendar.solar_terms.notice',
    sources: [
      { id: 'source.fixture_a', url: URL_A },
      { id: 'source.fixture_b', url: URL_B },
    ],
    ...overrides,
  };
}

function seasonAdapter(overrides = {}) {
  return {
    id: 'gregorian-season',
    version: '1.0.0',
    kind: CALENDAR_KIND.SEASON,
    expected_count: 4,
    notice_key: 'calendar.gregorian_season.notice',
    sources: [
      { id: 'source.season_a', url: 'https://season-a.example.org/2027.txt' },
      { id: 'source.season_b', url: 'https://season-b.example.org/2027.txt' },
    ],
    ...overrides,
  };
}

function seasonText(year = YEAR, format = 'utc8') {
  return ['03', '06', '09', '12'].map((mm, i) => {
    const at = format === 'utc'
      ? `${year}-${mm}-01T02:00:00Z`
      : `${year}-${mm}-01T10:00:00+08:00`;
    return `term id=season.fixture_${pad2(i + 1)} longitude_deg=${(i * 90).toFixed(1)} at=${at}`;
  }).join('\n');
}

function netDouble({ a = sourceText(), b = sourceText(YEAR, 'utc'), offline = false } = {}) {
  return createStubNet({ responses: { [URL_A]: a, [URL_B]: b }, offline, clock: CLOCK() });
}

const ctx = (fs, overrides = {}) => ({ fsPort: fs, clock: CLOCK(), ...overrides });
const isCalendarError = (v) => v instanceof CalendarError;
const noChinese = (v) => !/[\u4e00-\u9fff]/.test(JSON.stringify(v));

// ---- 可插拔适配器契约 ----

test('T-014 · 历法适配器固定键集白名单，额外键 / 缺键 / 非法源一律拒绝（FR-032 同口径）', () => {
  assert.doesNotThrow(() => validateCalendarAdapter(solarAdapter()));
  const bad = [
    { ...solarAdapter(), extra: 1 },
    { ...solarAdapter(), kind: 'unknown' },
    { ...solarAdapter(), sources: [{ id: 'source.fixture_a', url: URL_A }] },
    { ...solarAdapter(), sources: [{ id: 'source.x', url: 'http://insecure.example.org/a.txt' }] },
    { ...solarAdapter(), sources: [{ id: 'source.x', url: `${URL_A}?token=private` }] },
    { ...solarAdapter(), expected_count: 0 },
  ];
  for (const adapter of bad) {
    assert.throws(() => validateCalendarAdapter(adapter), isCalendarError);
  }
});

test('T-014 · 单源适配器被拒绝，MUST ≥2 个独立来源（FR-011）', () => {
  assert.throws(
    () => validateCalendarAdapter(solarAdapter({ sources: [{ id: 'only', url: URL_A }] })),
    (e) => isCalendarError(e) && e.issues.some((i) => i.code === CALENDAR_ERROR.SOURCES),
  );
});

// Round 6 负向探针暴露的覆盖缺口：以下两条与「单源拒绝」解耦，
// 使 URL 静态护栏与来源独立性各自可被单独弱化检出。
test('T-014 · 双源场景下带 query 的 URL 仍被静态拒绝（FR-048）', () => {
  assert.throws(
    () => validateCalendarAdapter(solarAdapter({
      sources: [
        { id: 'source.fixture_a', url: `${URL_A}?token=private` },
        { id: 'source.fixture_b', url: URL_B },
      ],
    })),
    (e) => isCalendarError(e) && e.issues.some((i) => i.code === CALENDAR_ERROR.URL),
  );
});

test('T-014 · 两个来源 URL / ID 重复视为不独立（FR-011 / E-03）', () => {
  assert.throws(
    () => validateCalendarAdapter(solarAdapter({
      sources: [
        { id: 'source.fixture_a', url: URL_A },
        { id: 'source.fixture_a', url: URL_A },
      ],
    })),
    (e) => isCalendarError(e) && e.issues.some((i) => i.code === CALENDAR_ERROR.SOURCES),
  );
});

// ---- 解析、UTC+8 归一化、双源交叉校验 ----

test('T-014 · 精确交节时刻统一为北京时间 UTC+8（FR-011）', () => {
  assert.equal(normalizeUtc8('2027-02-05T02:00:00Z'), '2027-02-05T10:00:00+08:00');
  assert.equal(normalizeUtc8('2027-02-05T10:00:00+08:00'), '2027-02-05T10:00:00+08:00');
  assert.equal(normalizeUtc8('2027-01-01T00:00:00Z'), '2027-01-01T08:00:00+08:00');
  assert.throws(() => normalizeUtc8('not-an-instant'), isCalendarError);
});

test('T-014 · 解析 24 条节气 / 黄经 / 日期 / 交节时刻，非法行一律拒绝（AC-04 / SC-005）', () => {
  const terms = parseTermTable(sourceText(), YEAR, 24);
  assert.equal(terms.length, 24);
  assert.equal(terms[0].id, 'term.fixture_01');
  assert.equal(terms[0].longitude_deg, 0);
  assert.equal(terms[0].at, '2027-01-05T10:00:00+08:00');
  assert.equal(terms[0].date, '2027-01-05');
  assert.equal(terms[23].longitude_deg, 345);
  assert.throws(() => parseTermTable(sourceText().replace('longitude_deg=0', 'longitude_deg=x'), YEAR, 24), isCalendarError);
  assert.throws(() => parseTermTable(sourceText().replace('2027-01-05T10:00:00+08:00', '2026-01-05T10:00:00+08:00'), YEAR, 24), isCalendarError);
  assert.throws(() => parseTermTable(sourceText().split('\n').slice(0, 23).join('\n'), YEAR, 24), isCalendarError);
});

test('T-014 · 双源不同偏移但同一时刻判定一致；任一字段冲突即报冲突（FR-011 / E-03）', () => {
  const first = parseTermTable(sourceText(), YEAR, 24);
  const second = parseTermTable(sourceText(YEAR, 'utc'), YEAR, 24);
  const ok = crossCheckSources([{ source_id: 'a', terms: first }, { source_id: 'b', terms: second }]);
  assert.deepEqual(ok.conflicts, []);
  assert.equal(ok.terms.length, 24);

  const shifted = parseTermTable(
    sourceText(YEAR, 'utc8', (row, i) => i === 3 ? { ...row, at: row.at.replace('10:00', '11:00') } : row),
    YEAR, 24,
  );
  const bad = crossCheckSources([{ source_id: 'a', terms: first }, { source_id: 'b', terms: shifted }]);
  assert.ok(bad.conflicts.length > 0);
  assert.ok(bad.conflicts[0].includes('term.fixture_04'));
});

// ---- 刷新成功：落盘缓存 ----

test('T-014 · 下载成功且双源一致 → 24 条缓存含来源 URL / 下载时间 / 版本号（FR-011 / AC-04）', async () => {
  const fs = createMemoryFs();
  const net = netDouble();
  const result = await refreshCalendarData(YEAR, solarAdapter(), net, ctx(fs));

  assert.equal(result.status, 'verified');
  assert.equal(result.year, YEAR);
  assert.equal(result.timezone, 'UTC+08:00');
  assert.equal(result.source_count, 2);
  assert.equal(result.terms.length, 24);
  assert.equal(result.wrote, true);
  assert.equal(result.cache_path, cachePathFor(YEAR));
  assert.equal(result.manual_review_key, null);
  assert.ok(noChinese(result), '核心域只出 Canonical ID（P-11）');

  const text = await fs.readText(result.cache_path);
  assert.equal(text, result.cache_text);
  assert.ok(text.includes(URL_A) && text.includes(URL_B), '来源 URL');
  assert.ok(text.includes('2027-01-01T08:00:00+08:00'), '下载时间');
  assert.ok(text.includes(`version=${result.version}`), '版本号');
  assert.ok(text.includes('diff_vs_previous='), '与上一版缓存差异');
  assert.equal((text.match(/^term id=/gm) ?? []).length, 24, '24 条节气 / 黄经 / 日期 / 交节时刻');
  assert.ok(/^[\x20-\x7E\n]+$/.test(text), '纯 ASCII 可 diff');
});

test('T-014 · 请求 MUST NOT 携带任何个人参数；核心链路不接收 Profile（FR-048）', async () => {
  const fs = createMemoryFs();
  const net = netDouble();
  await refreshCalendarData(YEAR, solarAdapter(), net, ctx(fs));
  const requests = net.requests();
  assert.equal(requests.length, 2);
  for (const r of requests) {
    assert.ok(!/[?&#]/.test(r.url), 'URL 无 query / fragment');
    assert.ok(!r.url.includes('profile') && !r.url.includes('token'));
    assert.ok(r.url.startsWith('https://'));
  }
  const signature = refreshCalendarData.toString().split(')')[0];
  assert.ok(!/profile|\bbody\b|bmr/i.test(signature), '签名不含任何个人数据参数');
});

test('T-014 · 缓存路径可注入以兼容 _data/ 口径（SPEC FR-011 / plan.md §5.3 差异）', async () => {
  const fs = createMemoryFs();
  const path = `_data/solar-terms-${YEAR}.md`;
  const result = await refreshCalendarData(YEAR, solarAdapter(), netDouble(), ctx(fs, { cachePath: path }));
  assert.equal(result.cache_path, path);
  assert.ok(await fs.readText(path));
});

// ---- FALLBACK：失败 / 冲突 / 离线 / 无上一版缓存 ----

test('T-014 · 下载失败 → 沿用上一版缓存并标注 FALLBACK / 未校验 + 人工复核（FR-013 / AC-04）', async () => {
  const fs = createMemoryFs();
  const verified = await refreshCalendarData(YEAR, solarAdapter(), netDouble(), ctx(fs));
  const hashBefore = await fs.hash(verified.cache_path);
  const writesBefore = fs.writes().length;

  const failing = createStubNet({
    responses: { [URL_A]: { error: ERR.NET_HTTP }, [URL_B]: { error: ERR.NET_HTTP } },
    clock: CLOCK(),
  });
  const result = await refreshCalendarData(YEAR, solarAdapter(), failing, ctx(fs));

  assert.equal(result.status, 'FALLBACK');
  assert.equal(result.status_label, 'FALLBACK / 未校验');
  assert.equal(result.manual_review_key, 'calendar.review.manual');
  assert.ok(result.notice_keys.includes('calendar.notice.manual_review'));
  assert.deepEqual(result.terms.map((t) => t.id), verified.terms.map((t) => t.id), '沿用上一版缓存');
  assert.ok(result.reason_keys.includes('calendar.fallback.download_failed'));
  assert.equal(result.wrote, false, 'FALLBACK 零写入');
  assert.equal(fs.writes().length, writesBefore, 'FALLBACK 未新增任何写入');
  assert.equal(await fs.hash(verified.cache_path), hashBefore, '上一版缓存逐字节不变');
});

test('T-014 · 部分来源冲突 → FALLBACK，不得静默取近似值（E-03）', async () => {
  const fs = createMemoryFs();
  const conflicted = netDouble({
    b: sourceText(YEAR, 'utc8', (row, i) => i === 7 ? { ...row, at: row.at.replace('10:00', '12:00') } : row),
  });
  const result = await refreshCalendarData(YEAR, solarAdapter(), conflicted, ctx(fs));
  assert.equal(result.status, 'FALLBACK');
  assert.ok(result.reason_keys.includes('calendar.fallback.source_conflict'));
  assert.deepEqual(result.terms, [], '无上一版缓存时不填任何近似值');
  assert.equal(result.wrote, false);
  assert.ok(result.manual_review_key);
});

test('T-014 · 离线时零对外请求，年计划仍可回退（NFR-001 / FR-048）', async () => {
  const fs = createMemoryFs();
  const net = createStubNet({ offline: true, clock: CLOCK() });
  const result = await refreshCalendarData(YEAR, solarAdapter(), net, ctx(fs));
  assert.equal(result.status, 'FALLBACK');
  assert.deepEqual(net.requests(), []);
  assert.ok(result.reason_keys.includes('calendar.fallback.offline'));
  assert.deepEqual(result.terms, [], '绝不静默使用近似值');
});

test('T-014 · 无上一版缓存且失败 → 空时令集 + 人工复核，绝不内置近似表（FR-012 / AC-04）', async () => {
  const fs = createMemoryFs();
  const net = createStubNet({ offline: true, clock: CLOCK() });
  const result = await refreshCalendarData(YEAR, solarAdapter(), net, ctx(fs));
  assert.deepEqual(result.terms, []);
  assert.ok(result.reason_keys.includes('calendar.fallback.no_previous_cache'));
  assert.equal(result.status_label, 'FALLBACK / 未校验');
});

// ---- 下层只读 / 与 T-013 契约衔接 ----

test('T-014 · 下层只读缓存且日期与缓存完全一致，可直接喂给 T-013 只读视图（FR-012 / SC-005 / §9 不变式 2）', async () => {
  const fs = createMemoryFs();
  const verified = await refreshCalendarData(YEAR, solarAdapter(), netDouble(), ctx(fs));
  const view = await readCalendarCache(fs, verified.cache_path, YEAR);
  assert.equal(view.cache_id, verified.calendar_id);
  assert.equal(view.status, 'verified');
  assert.equal(view.terms.length, 24);
  assert.deepEqual(
    view.terms.map((t) => t.at),
    verified.terms.map((t) => t.at),
    '下层日期与缓存完全一致',
  );
  assert.deepEqual(fs.writes().slice(1), [], '读取缓存零写入');

  const plannerView = readCalendarView(view, `${YEAR}-01-01`, `${YEAR}-12-31`);
  assert.equal(plannerView.term_ids.length, 24);
  assert.equal(plannerView.status, 'verified');
});

test('T-014 · FALLBACK 缓存被下层读取时透传人工复核提示（E-03）', async () => {
  const fs = createMemoryFs();
  const fallbackText = renderCacheText({
    year: YEAR, calendar_id: 'solar-terms-2027', adapter_id: 'solar-terms',
    adapter_version: '1.0.0', kind: CALENDAR_KIND.SOLAR_TERMS,
    status: 'FALLBACK', version: 'calendar-2027-fallback',
    downloaded_at: '2027-01-01T08:00:00+08:00',
    sources: [URL_A, URL_B], terms: parseTermTable(sourceText(), YEAR, 24),
    diff_vs_previous: null,
  });
  const path = cachePathFor(YEAR);
  await fs.writeText(path, fallbackText);
  const view = await readCalendarCache(fs, path, YEAR);
  assert.equal(view.status, 'FALLBACK');
  assert.equal(view.terms.length, 24, '沿用上一版缓存的 24 条');
  const plannerView = readCalendarView(view, `${YEAR}-01-01`, `${YEAR}-12-31`);
  assert.equal(plannerView.status, 'FALLBACK');
  assert.equal(plannerView.manual_review_key, 'plan.review.calendar_fallback',
    'T-013 只读视图把 FALLBACK 映射为计划域的复核键');
});

// ---- 通用季节历同等约束 ----

test('T-014 · 通用季节历同等遵守「双源 / 落盘 / 失败 FALLBACK」约束（FR-011～013 注）', async () => {
  const fs = createMemoryFs();
  const adapter = seasonAdapter();
  const net = createStubNet({
    responses: {
      [adapter.sources[0].url]: seasonText(),
      [adapter.sources[1].url]: seasonText(YEAR, 'utc'),
    },
    clock: CLOCK(),
  });
  const result = await refreshCalendarData(YEAR, adapter, net, ctx(fs, { cachePath: 'data/calendar/seasons-2027.md' }));
  assert.equal(result.status, 'verified');
  assert.equal(result.terms.length, 4);
  assert.equal(result.wrote, true);

  const offline = createStubNet({ offline: true, clock: CLOCK() });
  const fallback = await refreshCalendarData(YEAR, adapter, offline, ctx(fs, { cachePath: 'data/calendar/seasons-2027.md' }));
  assert.equal(fallback.status, 'FALLBACK');
  assert.equal(fallback.terms.length, 4, '沿用上一版季节缓存');
});

// ---- E-01 暂行规则 ----

test('T-014 · 交节 ≥12:00 当日沿用旧节气、次日起新节气（E-01 B 类提案暂行）', () => {
  const cache = {
    year: YEAR,
    terms: [
      { id: 'term.fixture_prev', at: `${YEAR}-01-05T10:00:00+08:00` },
      { id: 'term.fixture_noon', at: `${YEAR}-02-04T14:00:00+08:00` },
      { id: 'term.fixture_next', at: `${YEAR}-02-20T09:00:00+08:00` },
    ],
  };
  const before = resolveActiveTerm(cache, `${YEAR}-02-03`);
  assert.equal(before.term_id, 'term.fixture_prev');
  const onDay = resolveActiveTerm(cache, `${YEAR}-02-04`);
  assert.equal(onDay.term_id, 'term.fixture_prev', '当日沿用旧节气');
  assert.equal(onDay.rule, 'E-01-provisional');
  const after = resolveActiveTerm(cache, `${YEAR}-02-05`);
  assert.equal(after.term_id, 'term.fixture_noon', '次日起新节气');
});

// ---- 输入护栏 / 确定性 / 脱敏 ----

test('T-014 · 非法年份 / 端口缺失 / 缓存格式损坏一律拒绝，错误只含稳定码（FR-049）', async () => {
  const fs = createMemoryFs();
  const bad = [
    [0, solarAdapter(), netDouble(), ctx(fs)],
    [YEAR, solarAdapter(), netDouble(), { fsPort: fs }],
    [YEAR, solarAdapter(), netDouble(), { clock: CLOCK() }],
  ];
  for (const args of bad) {
    await assert.rejects(async () => refreshCalendarData(...args), isCalendarError);
  }
  await fs.writeText(cachePathFor(YEAR), 'garbage');
  await assert.rejects(() => readCalendarCache(fs, cachePathFor(YEAR), YEAR), isCalendarError);
  await assert.rejects(
    async () => refreshCalendarData(YEAR, solarAdapter({ extra: 1 }), netDouble(), ctx(fs)),
    (e) => {
      assert.ok(isCalendarError(e));
      assert.match(e.message, /^ERR_CALENDAR_INVALID: ERR_CALENDAR_[A-Z_,]+$/);
      for (const i of e.issues) {
        assert.match(i.code, /^ERR_CALENDAR_[A-Z_]+$/);
        assert.equal(typeof i.field, 'string');
        assert.match(i.hint, /^[a-z][a-z0-9._-]*$/);
      }
      return true;
    },
  );
});

test('T-014 · 同输入两次刷新结果一致、缓存字节一致，且错误 / 结果不含身体数值（FR-049 / P-11）', async () => {
  const fs1 = createMemoryFs();
  const fs2 = createMemoryFs();
  const a = await refreshCalendarData(YEAR, solarAdapter(), netDouble(), ctx(fs1));
  const b = await refreshCalendarData(YEAR, solarAdapter(), netDouble(), ctx(fs2));
  assert.equal(a.version, b.version);
  assert.equal(a.cache_text, b.cache_text);
  assert.equal(await fs1.readText(a.cache_path), await fs2.readText(b.cache_path));
  assert.ok(!JSON.stringify(a).includes('98765'));
  assert.ok(!JSON.stringify(a).includes('bmr_kcal'));
});
