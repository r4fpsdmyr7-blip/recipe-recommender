// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-018 · render(planObject, languagePack, intlFormatter) unit tests (ATDD red -> green).
 *
 * Spec: tasks.md T-018; SPEC.md FR-006, FR-009, FR-028, FR-033, FR-040..044,
 * NFR-006, AC-12, AC-13, SC-011, section 9 invariants, P-02 / P-05 / P-11 / P-14;
 * plan.md 5.2 / 5.4 / 6.1 / 8; constitution.md P-11 gate.
 *
 * All human-readable strings are injected synthetic placeholders. This file and
 * src/core/render/*.js contain no natural-language literals (P-11). No real body
 * data, no real dish names, no network and no disk writes (P-14).
 *
 * Boundary: language packs and the fallback chain belong to T-031; end-to-end
 * scheduling and file writes belong to T-019. AC-12 / AC-13 therefore stay RED.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

import {
  RENDER_ERROR,
  RenderError,
  RENDER_VERSION,
  RENDER_PREFIX,
  LANGUAGE_PACK_KEYS,
  REQUIRED_NOTICE_KEYS,
  PLAN_LEVELS,
  RX_FIELDS,
  VERSION_KEYS,
  validateLanguagePack,
  validateIntlFormatter,
  validatePlanObject,
  resolvePackKey,
  render,
  buildRenderData,
  extractRenderData,
  extractCanonicalBlock,
} from '../../src/core/render/index.js';
import { planYear } from '../../src/core/planner/index.js';
import { computeRx } from '../../src/core/rx/index.js';
import { createFixedClock } from '../fixtures/index.js';

const ADAPTER = JSON.parse(readFileSync(
  new URL('../../data/guideline/generic-guideline.json', import.meta.url), 'utf8',
));

const DISCLAIMER = 'plan.notice.disclaimer';
const ESTIMATED = 'plan.notice.estimated';
const AIGC = 'plan.marker.aigc';

const isRenderError = (v) => v instanceof RenderError;
const hasCode = (e, code) => isRenderError(e) && e.issues.some((i) => i.code === code);
const noCjk = (v) => !/[^\x00-\x7F]/.test(JSON.stringify(v));
const codeTokens = (md) => [...md.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

/** Synthetic language pack: every required key maps to a deterministic ASCII placeholder. */
function pack(tag = 'xx', prefix = 'LA', overrides = {}) {
  const strings = {};
  for (const k of LANGUAGE_PACK_KEYS) strings[k] = `${prefix}:${k}`;
  for (const k of [
    DISCLAIMER, ESTIMATED, AIGC, 'plan.notice.execution_window',
    'plan.notice.calendar_fallback', 'plan.review.calendar_fallback',
    'purchase.section.actual', 'purchase.col.date', 'purchase.col.item',
  ]) strings[k] = `${prefix}:${k}`;
  return {
    tag,
    strings: { ...strings, ...(overrides.strings ?? {}) },
    fallback_keys: overrides.fallback_keys ?? [],
  };
}

/** Synthetic intl formatter: output is deterministic, ASCII, table-safe. */
function intl(tag = 'F') {
  return {
    number: (v, unitKey) => `${tag}:n:${v}:${unitKey}`,
    date: (v) => `${tag}:d:${v}`,
  };
}

const BRIEF = Object.freeze({
  level: 'month', period_id: '2026-11', title: 'plan.title.month',
  file_name: '2026-11.md', start_date: '2026-11-01', end_date: '2026-11-30',
});

const CALENDAR = Object.freeze({
  cache_id: 'calendar-fixture-2026', year: 2026, status: 'verified',
  term_ids: Object.freeze(['term.fixture_a']), active_term_id: 'term.fixture_a',
  manual_review_key: null,
});

function planObject(overrides = {}) {
  return {
    level: 'week',
    period_id: '2026-W45',
    file_name: '2026-W45.md',
    header: {
      level: 'week',
      period_id: '2026-W45',
      title: 'plan.title.week',
      file_name: '2026-W45.md',
      generated_date: '2026-11-06',
      generated_at: '2026-11-06T20:00:00+08:00',
      run_date: '2026-11-06',
      trigger: 'plan.trigger.period_first_day',
      version_ids: Object.fromEntries(VERSION_KEYS.map((k) => [k, `${k}-v1`])),
      parent: BRIEF,
      children: [Object.freeze({
        level: 'day', period_id: '2026-11-09', title: 'plan.title.day',
        file_name: '2026-11-09.md', start_date: '2026-11-09', end_date: '2026-11-09',
      })],
      link_references: [],
      language_tag: 'xx',
      locale_source: 'user',
      guideline_id: 'generic-guideline',
      calendar: CALENDAR,
      execution_window: Object.freeze({
        start_date: '2026-11-09', end_date: '2026-11-15',
        total_days: 7, executed_days: 4, remaining_days: 3,
      }),
      notice_keys: [DISCLAIMER, ESTIMATED, AIGC],
    },
    prescription: Object.fromEntries(RX_FIELDS.map((k, i) => [k, [100 + i, 200 + i]])),
    comparison: Object.freeze({ adapter_id: 'generic-guideline', compliant: true }),
    guardrails: Object.freeze({ energy_floor_kcal: 1450, protein_floor_g: 78 }),
    calendar: CALENDAR,
    days: [Object.freeze({ plan_date: '2026-11-09', file_name: '2026-11-09.md' })],
    recalc: null,
    ...overrides,
  };
}

const output = (o = {}, p = pack(), f = intl()) => render(planObject(o), p, f);

// ---- Contract: key sets ----

test('T-018 · language pack key set is frozen, canonical, sorted and unique', () => {
  assert.ok(Object.isFrozen(LANGUAGE_PACK_KEYS));
  assert.ok(Object.isFrozen(REQUIRED_NOTICE_KEYS));
  assert.equal(new Set(LANGUAGE_PACK_KEYS).size, LANGUAGE_PACK_KEYS.length);
  assert.deepEqual([...LANGUAGE_PACK_KEYS].sort(), [...LANGUAGE_PACK_KEYS]);
  for (const k of LANGUAGE_PACK_KEYS) {
    assert.match(k, /^[a-z][a-z0-9._-]{0,63}$/);
  }
  for (const k of REQUIRED_NOTICE_KEYS) assert.ok(LANGUAGE_PACK_KEYS.includes(k));
  assert.deepEqual(REQUIRED_NOTICE_KEYS, [DISCLAIMER, ESTIMATED, AIGC]);
  assert.equal(RENDER_VERSION, 'v=1');
  assert.equal(RENDER_PREFIX, '<!-- rr-render ');
});

test('T-018 · level / rx / version key sets come from T-013 / T-011 / T-010', () => {
  assert.deepEqual(PLAN_LEVELS, ['year', 'season', 'month', 'week', 'day']);
  assert.equal(RX_FIELDS.length, 9);
  assert.deepEqual(VERSION_KEYS, ['body', 'rx', 'loc', 'st', 'rule']);
  for (const l of PLAN_LEVELS) assert.ok(LANGUAGE_PACK_KEYS.includes(`render.title.${l}`));
  for (const k of RX_FIELDS) assert.ok(LANGUAGE_PACK_KEYS.includes(`render.field.${k}`));
  for (const k of VERSION_KEYS) assert.ok(LANGUAGE_PACK_KEYS.includes(`render.version.${k}`));
});

// ---- Contract: language pack validation ----

test('T-018 · validateLanguagePack accepts a complete frozen view', () => {
  const v = validateLanguagePack(pack('zh-Hans', 'ZH'));
  assert.equal(v.tag, 'zh-Hans');
  assert.ok(Object.isFrozen(v));
  assert.ok(Object.isFrozen(v.strings));
  assert.ok(Object.isFrozen(v.fallback_keys));
  assert.equal(v.strings[DISCLAIMER], `ZH:${DISCLAIMER}`);
});

test('T-018 · missing required pack key is rejected with a stable code', () => {
  const p = pack();
  delete p.strings['render.section.metadata'];
  assert.throws(() => validateLanguagePack(p), (e) => isRenderError(e)
    && hasCode(e, RENDER_ERROR.PACK_KEY));
});

test('T-018 · unknown outer pack key / injected field is rejected', () => {
  const p = { ...pack(), injected: 'x' };
  assert.throws(() => validateLanguagePack(p), (e) => isRenderError(e)
    && hasCode(e, RENDER_ERROR.PACK));
  assert.throws(() => validateLanguagePack({ tag: 'en', strings: pack().strings }),
    (e) => isRenderError(e) && hasCode(e, RENDER_ERROR.PACK));
});

test('T-018 · invalid BCP 47 tag is rejected', () => {
  for (const tag of ['', '123', 'zh_ Hans', 'en!', 12, null]) {
    assert.throws(() => validateLanguagePack(pack(tag === null ? '' : tag)), (e) => isRenderError(e)
      && hasCode(e, RENDER_ERROR.PACK_TAG));
  }
});

test('T-018 · non-canonical string key / empty / table-breaking string is rejected', () => {
  const bad = (strings) => assert.throws(() => validateLanguagePack(pack('en', 'E', { strings })),
    (e) => isRenderError(e) && (hasCode(e, RENDER_ERROR.PACK_STRING)));
  bad({ 'Render.Meta.Level': 'x' });
  bad({ 'render.extra': '' });
  bad({ 'render.extra': 'a|b' });
  bad({ 'render.extra': 'a\nb' });
  bad({ 'render.extra': 42 });
});

test('T-018 · fallback_keys must be unique and resolvable within strings', () => {
  assert.throws(() => validateLanguagePack(pack('en', 'E', { fallback_keys: ['a', 'a'] })),
    (e) => isRenderError(e) && hasCode(e, RENDER_ERROR.PACK));
  assert.throws(() => validateLanguagePack(pack('en', 'E', { fallback_keys: ['render.missing.ghost'] })),
    (e) => isRenderError(e) && hasCode(e, RENDER_ERROR.PACK));
  assert.throws(() => validateLanguagePack(pack('en', 'E', { fallback_keys: [DISCLAIMER, DISCLAIMER] })),
    (e) => isRenderError(e) && hasCode(e, RENDER_ERROR.PACK));
  const v = validateLanguagePack(pack('en', 'E', { fallback_keys: [DISCLAIMER] }));
  assert.deepEqual(v.fallback_keys, [DISCLAIMER]);
});

test('T-018 · resolvePackKey reports direct / fallback / missing without throwing', () => {
  const v = validateLanguagePack(pack('en', 'E', { fallback_keys: [ESTIMATED] }));
  assert.deepEqual(resolvePackKey(v, DISCLAIMER), { state: 'direct', text: `E:${DISCLAIMER}` });
  assert.deepEqual(resolvePackKey(v, ESTIMATED), { state: 'fallback', text: `E:${ESTIMATED}` });
  assert.deepEqual(resolvePackKey(v, 'plan.ghost.key'), { state: 'missing', text: 'plan.ghost.key' });
  assert.ok(Object.isFrozen(resolvePackKey(v, DISCLAIMER)));
});

// ---- Contract: intl formatter validation ----

test('T-018 · validateIntlFormatter accepts deterministic table-safe functions', () => {
  const v = validateIntlFormatter(intl());
  assert.ok(Object.isFrozen(v));
  assert.equal(typeof v.number, 'function');
  assert.equal(typeof v.date, 'function');
});

test('T-018 · formatter missing / non-function / extra key is rejected', () => {
  const bad = (f) => assert.throws(() => validateIntlFormatter(f), (e) => isRenderError(e)
    && hasCode(e, RENDER_ERROR.FORMATTER));
  bad(null);
  bad({ number: () => '1' });
  bad({ ...intl(), date: null });
  bad({ ...intl(), extra: 1 });
});

test('T-018 · non-deterministic or table-breaking formatter output is rejected', () => {
  let n = 0;
  const flaky = { number: () => `x${n++}`, date: () => 'd' };
  assert.throws(() => validateIntlFormatter(flaky), (e) => isRenderError(e)
    && hasCode(e, RENDER_ERROR.FORMATTER_OUTPUT));
  const breaking = { number: () => 'a|b', date: () => 'd' };
  assert.throws(() => validateIntlFormatter(breaking), (e) => isRenderError(e)
    && hasCode(e, RENDER_ERROR.FORMATTER_OUTPUT));
  const multiline = { number: () => '1', date: () => 'a\nb' };
  assert.throws(() => validateIntlFormatter(multiline), (e) => isRenderError(e)
    && hasCode(e, RENDER_ERROR.FORMATTER_OUTPUT));
});

// ---- Contract: plan object validation ----

test('T-018 · validatePlanObject rejects injected body data and unknown top-level keys', () => {
  assert.throws(() => validatePlanObject({ ...planObject(), body: { weight_kg: 65 } }),
    (e) => isRenderError(e) && hasCode(e, RENDER_ERROR.PLAN));
  assert.throws(() => validatePlanObject({ ...planObject(), version_ids: {} }),
    (e) => isRenderError(e) && hasCode(e, RENDER_ERROR.PLAN));
});

test('T-018 · invalid level / missing header field / missing version id is rejected', () => {
  assert.throws(() => validatePlanObject(planObject({ level: 'century' })),
    (e) => hasCode(e, RENDER_ERROR.PLAN) || hasCode(e, RENDER_ERROR.HEADER));
  const h = { ...planObject().header };
  delete h.generated_date;
  assert.throws(() => validatePlanObject(planObject({ header: h })),
    (e) => isRenderError(e) && hasCode(e, RENDER_ERROR.HEADER));
  const h2 = { ...planObject().header, version_ids: { body: 'b', rx: 'r' } };
  assert.throws(() => validatePlanObject(planObject({ header: h2 })),
    (e) => isRenderError(e) && hasCode(e, RENDER_ERROR.HEADER));
});

test('T-018 · FR-033 requires all three notices in the plan header', () => {
  const h = { ...planObject().header, notice_keys: [DISCLAIMER, ESTIMATED] };
  assert.throws(() => validatePlanObject(planObject({ header: h })),
    (e) => isRenderError(e) && hasCode(e, RENDER_ERROR.NOTICE));
});

test('T-018 · malformed prescription / guardrails / days is rejected', () => {
  assert.throws(() => validatePlanObject(planObject({ prescription: { energy_kcal: [1] } })),
    (e) => isRenderError(e) && hasCode(e, RENDER_ERROR.PLAN));
  assert.throws(() => validatePlanObject(planObject({ guardrails: { energy_floor_kcal: 'x' } })),
    (e) => isRenderError(e) && hasCode(e, RENDER_ERROR.PLAN));
  assert.throws(() => validatePlanObject(planObject({ days: [{ plan_date: 'bad|date' }] })),
    (e) => isRenderError(e) && hasCode(e, RENDER_ERROR.PLAN));
  assert.throws(() => validatePlanObject(planObject({
    days: [{ plan_date: '2026/11/09', file_name: '2026-11-09.md' }],
  })), (e) => isRenderError(e) && hasCode(e, RENDER_ERROR.PLAN));
});

test('T-018 · independent: a complete prescription with one malformed range is rejected', () => {
  const rx = planObject().prescription;
  rx.water_ml = [1950];
  assert.throws(() => validatePlanObject(planObject({ prescription: rx })),
    (e) => hasCode(e, RENDER_ERROR.PLAN));
});

test('T-018 · independent: table-breaking day file_name is rejected even with a valid date', () => {
  const days = [{ plan_date: '2026-11-09', file_name: '2026-11-09|inject.md' }];
  assert.throws(() => validatePlanObject(planObject({ days })),
    (e) => hasCode(e, RENDER_ERROR.PLAN));
});

test('T-018 · independent: empty formatter output is rejected', () => {
  assert.throws(() => validateIntlFormatter({ number: () => '', date: () => '' }),
    (e) => hasCode(e, RENDER_ERROR.FORMATTER_OUTPUT));
});

test('T-018 · injectable sections are validated (canonical keys, scalar cells)', () => {
  const good = [{
    id: 'purchase.actual', title_key: 'purchase.section.actual',
    columns: ['purchase.col.date', 'purchase.col.item'], rows: [['2026-11-09', 3]],
  }];
  assert.doesNotThrow(() => validatePlanObject(planObject({ sections: good })));
  assert.ok(Object.isFrozen(validatePlanObject(planObject())));
  const bad = [{ ...good[0], rows: [['2026-11-09']] }];
  assert.throws(() => validatePlanObject(planObject({ sections: bad })),
    (e) => isRenderError(e) && hasCode(e, RENDER_ERROR.SECTION));
  const badCell = [{ ...good[0], rows: [['2026-11-09', 'a|b']] }];
  assert.throws(() => validatePlanObject(planObject({ sections: badCell })),
    (e) => isRenderError(e) && hasCode(e, RENDER_ERROR.SECTION));
});

test('T-018 · errors carry only stable codes and canonical hints; no numbers, no prose', () => {
  assert.throws(() => validateLanguagePack(null), (e) => {
    assert.ok(isRenderError(e));
    assert.match(e.code, /^ERR_RENDER_[A-Z_]+$/);
    assert.ok(noCjk(e.message));
    assert.ok(noCjk(e.issues));
    assert.ok(!e.message.includes('65'));
    for (const i of e.issues) {
      assert.ok(Object.keys(i).every((k) => ['code', 'field', 'hint'].includes(k)));
      assert.match(i.hint, /^[a-z][a-z0-9._()-]*$/);
    }
    return true;
  });
  const codes = Object.values(RENDER_ERROR);
  assert.equal(new Set(codes).size, codes.length);
  assert.equal(codes.length, 13);
  assert.ok(codes.every((c) => c.startsWith('ERR_RENDER_')));
});

// ---- Rendering: content ----

test('T-018 · render emits localized title, three notices, [AIGC] and ASCII marker', () => {
  const md = output();
  assert.match(md, /^# LA:render\.title\.week/);
  assert.ok(md.includes('<!-- rr-render v=1 lang=xx level=week period=2026-W45 -->'));
  const quotes = md.split('\n').filter((l) => l.startsWith('> '));
  assert.equal(quotes.length, 3);
  assert.ok(md.includes('[AIGC] LA:plan.marker.aigc'));
  assert.ok(md.includes(`> LA:${DISCLAIMER}`));
  assert.ok(md.includes(`> LA:${ESTIMATED}`));
});

test('T-018 · FR-033 notices and all labels come only from the injected language pack', () => {
  const md = output({}, pack('fr', 'FR'));
  assert.ok(md.includes('FR:plan.notice.disclaimer'));
  assert.ok(!md.includes('LA:'));
  assert.ok(md.includes('FR:render.section.metadata'));
  assert.ok(!/[^\x00-\x7F]/.test(md));
});

test('T-018 · FR-009 header metadata: five versions, dates, cycle, links, locale source', () => {
  const f = intl('F');
  const md = output({}, pack(), f);
  for (const k of VERSION_KEYS) assert.ok(md.includes(`\`${k}-v1\``));
  assert.ok(md.includes('`2026-W45`'));
  assert.ok(md.includes('`xx`'));
  assert.ok(md.includes('`user`'));
  assert.ok(md.includes('`generic-guideline`'));
  assert.ok(md.includes(f.date('2026-11-06')));
  assert.ok(md.includes('`2026-11.md`'));
  assert.ok(md.includes('`2026-11-09.md`'));
  assert.ok(md.includes('LA:render.link.parent'));
});

test('T-018 · nine prescription rows use formatter numbers and localized unit labels', () => {
  const f = intl('F');
  const md = output({}, pack(), f);
  for (const k of RX_FIELDS) assert.ok(md.includes(`LA:render.field.${k}`));
  assert.ok(md.includes(f.number(100, 'render.unit.kcal')));
  assert.ok(md.includes(f.number(108, 'render.unit.g')));
  assert.ok(md.includes('LA:render.unit.kcal'));
  assert.ok(md.includes('LA:render.unit.ml'));
});

test('T-018 · guardrails, calendar, days and notices sections are present', () => {
  const md = output({}, pack('en', 'E'));
  for (const s of ['versions', 'links', 'prescription', 'guardrails', 'calendar', 'days', 'notices', 'canonical_data']) {
    assert.ok(md.includes(`E:render.section.${s}`), s);
  }
  assert.ok(md.includes('`calendar-fixture-2026`'));
  assert.ok(md.includes('`term.fixture_a`'));
  assert.ok(md.includes('`1450`'));
  assert.ok(md.includes('`78`'));
});

test('T-018 · external notice keys are rendered too (execution window / calendar fallback)', () => {
  const h = {
    ...planObject().header,
    notice_keys: [DISCLAIMER, ESTIMATED, AIGC, 'plan.notice.execution_window', 'plan.notice.calendar_fallback'],
  };
  const md = output({ header: h });
  assert.equal(md.split('\n').filter((l) => l.startsWith('> ')).length, 5);
  assert.ok(md.includes('LA:plan.notice.calendar_fallback'));
});

test('T-018 · injectable sections render as deterministic localized tables', () => {
  const sections = [{
    id: 'purchase.actual', title_key: 'purchase.section.actual',
    columns: ['purchase.col.date', 'purchase.col.item'],
    rows: [['2026-11-09', 3], ['2026-11-10', null]],
  }];
  const md = output({ sections });
  assert.ok(md.includes('LA:purchase.section.actual'));
  assert.ok(md.includes('`2026-11-09` | `3`'));
  assert.ok(md.includes('`2026-11-10` | `null`'));
});

test('T-018 · renders a real T-013 planYear() object without modification', () => {
  const body = { height_cm: 168, weight_kg: 65, body_fat_pct: 20, bmr_kcal: 1450, sex: 'male' };
  const versions = Object.fromEntries(VERSION_KEYS.map((k) => [k, { id: `${k}-v1`, updated_at: null }]));
  const calendar = {
    cache_id: 'calendar-fixture-2026', year: 2026, status: 'verified',
    terms: [{ id: 'term.fixture_a', at: '2026-02-04T10:00:00+08:00' }],
  };
  const plan = planYear({
    clock: createFixedClock('2026-01-01T20:00:00+08:00'),
    profile: { body, versions },
    calendar,
    rx: computeRx(body, ADAPTER),
    guideline_id: ADAPTER.id,
    language_tag: 'xx',
    locale_source: 'user',
  });
  const before = JSON.stringify(plan);
  const md = render(plan, pack(), intl());
  assert.equal(JSON.stringify(plan), before);
  assert.ok(md.includes('LA:render.title.year'));
  assert.ok(md.includes('[AIGC]'));
  assert.ok(md.includes('`2026`'));
});

// ---- Rendering: determinism / Git diff / UTF-8 ----

test('T-018 · Git-diffable output: LF only, no CRLF/BOM/trailing spaces, one final newline', () => {
  const md = output();
  assert.ok(!md.includes('\r'));
  assert.ok(!md.startsWith('\uFEFF'));
  assert.ok(md.endsWith('\n'));
  assert.ok(!md.endsWith('\n\n'));
  for (const line of md.split('\n')) assert.equal(line, line.replace(/[ \t]+$/, ''));
});

test('T-018 · render is deterministic and pure (no input mutation)', () => {
  const p = planObject();
  const lp = pack();
  const f = intl();
  const snapshot = JSON.stringify({ p, lp });
  assert.equal(render(p, lp, f), render(p, lp, f));
  assert.equal(JSON.stringify({ p, lp }), snapshot);
});

test('T-018 · UTF-8 round trip preserves non-ASCII language pack strings', () => {
  const cjk = '\u4e2d\u6587';
  const md = output({}, pack('zh-Hans', 'ZH', { strings: { [DISCLAIMER]: cjk } }));
  assert.ok(md.includes(cjk));
  assert.equal(Buffer.from(md, 'utf8').toString('utf8'), md);
  assert.ok(!md.includes('\uFFFD'));
});

test('T-018 · canonical data block is pure ASCII and free of localized strings', () => {
  const md = output();
  const block = extractCanonicalBlock(md);
  assert.ok(block.startsWith('```rr-data\n'));
  assert.ok(block.endsWith('\n```'));
  assert.ok(!/[^\x00-\x7F]/.test(block));
  assert.ok(!block.includes('LA:'));
  assert.ok(!block.includes('F:n:'));
  assert.ok(block.includes('level=week'));
  assert.ok(block.includes('rx.energy_kcal.min=100'));
  assert.ok(block.includes('version.rule=rule-v1'));
});

test('T-018 · independent: buildRenderData rejects non-ASCII canonical values', () => {
  const p = {
    ...planObject(),
    sections: [],
    calendar: { ...planObject().calendar, status: '\u672a\u6821\u9a8c' },
  };
  assert.throws(() => buildRenderData(p), (e) => hasCode(e, RENDER_ERROR.INVARIANT));
});

test('T-018 · extractRenderData returns a frozen ASCII record; malformed block is rejected', () => {
  const md = output();
  const data = extractRenderData(md);
  assert.ok(Object.isFrozen(data));
  assert.equal(data.level, 'week');
  assert.equal(data['rx.energy_kcal.max'], '200');
  assert.equal(data['days.count'], '1');
  assert.ok(Object.keys(data).every((k) => /^[a-z][a-z0-9._-]*$/.test(k)));
  assert.ok(Object.values(data).every((v) => /^[\x20-\x7E]*$/.test(v)));
  assert.throws(() => extractRenderData('no data block here'), (e) => isRenderError(e)
    && hasCode(e, RENDER_ERROR.DATA));
  assert.throws(() => extractRenderData(md.replace('\nlevel=week\n', '\nlevel=week\nlevel=month\n')),
    (e) => isRenderError(e) && hasCode(e, RENDER_ERROR.DATA));
  assert.throws(() => extractRenderData(md.replace('\nversion.body=body-v1\n', '\nzzz.late=1\nversion.body=body-v1\n')),
    (e) => isRenderError(e) && hasCode(e, RENDER_ERROR.DATA));
  assert.throws(() => extractRenderData(md.replace('\nlevel=week\n', '\nlevel=\u672a\u6821\u9a8c\n')),
    (e) => isRenderError(e) && hasCode(e, RENDER_ERROR.DATA));
});

// ---- Rendering: language invariance / fallback ----

test('T-018 · FR-044 / NFR-006: switching language changes strings only, not data', () => {
  const p = planObject();
  const a = render(p, pack('la', 'LA'), intl('FA'));
  const b = render(p, pack('lb', 'LB'), intl('FB'));
  assert.notEqual(a, b);
  assert.ok(a.includes('LA:render.section.metadata'));
  assert.ok(b.includes('LB:render.section.metadata'));
  assert.equal(extractCanonicalBlock(a), extractCanonicalBlock(b));
  assert.deepEqual(extractRenderData(a), extractRenderData(b));
  assert.deepEqual(codeTokens(a), codeTokens(b));
  assert.ok(codeTokens(a).includes('1450'));
  assert.ok(codeTokens(a).includes('body-v1'));
});

test('T-018 · FR-042: fallback keys are explicitly annotated, never silently mixed', () => {
  const md = output({}, pack('en', 'E', { fallback_keys: [DISCLAIMER] }));
  assert.ok(md.includes('E:render.marker.fallback'));
  assert.ok(md.includes(`E:render.marker.fallback E:${DISCLAIMER}`));
  assert.equal((md.match(/render\.marker\.fallback/g) ?? []).length, 1);
});

test('T-018 · FR-042: missing dynamic key never fails generation and is marked untranslated', () => {
  const h = { ...planObject().header, notice_keys: [DISCLAIMER, ESTIMATED, AIGC, 'plan.notice.ghost'] };
  const md = output({ header: h });
  assert.ok(md.includes('LA:render.marker.untranslated'));
  assert.ok(md.includes('`plan.notice.ghost`'));
  assert.ok(!md.includes('LA:plan.notice.ghost'));
});

test('T-018 · P-11: render source is pure ASCII (no hardcoded natural language)', () => {
  const dir = new URL('../../src/core/render/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
  assert.ok(files.length >= 4);
  for (const f of files) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    assert.ok(!/[^\x00-\x7F]/.test(src), `${f} contains non-ASCII bytes`);
    assert.match(src, /^\/\/ SPDX-License-Identifier: GPL-3\.0-only/m);
    assert.ok(!/from ['"]node:(fs|http|https|net)/.test(src), `${f} performs direct IO`);
  }
});

test('T-018 · P-14: no body fields or raw body values leak into the rendered document', () => {
  const md = output();
  for (const k of ['body_fat_pct', 'weight_kg', 'height_cm', 'body.bmr_kcal']) {
    assert.ok(!md.includes(k));
  }
  assert.ok(!md.includes('`168`'));
  assert.ok(!md.includes('`65`'));
});
