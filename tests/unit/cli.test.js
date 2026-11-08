// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-019 · CLI（`rr init / plan / validate / ledger / acceptance`）单元测试（ATDD 红→绿）。
 *
 * 验收口径：tasks.md T-019 / SPEC.md FR-029、FR-040、FR-041、FR-046、FR-028、
 * FR-033、AC-12、AC-14、SC-009、SC-014、P-02 / P-11 / P-14；
 * plan.md §4 / §6.2 / §6.3 / §9。
 *
 * 边界（不越界实现）：
 * - `resolveLocalePolicy`（FR-045 / AC-16）归 T-032，语言包加载（FR-040～042）归 T-031，
 *   本文件一律以**注入替身**驱动，不内置任何区域映射表或语言包内容。
 * - 时令数据只读缓存（T-014 `readCalendarCache`），本文件断言 `rr plan` **零对外请求**。
 * - `export-data` / `delete-data` 的行为归 T-020（见 `tests/unit/privacy.test.js`），
 *   本文件只断言它们**已进入命令集**；`rr locales` 归 T-031、`rr serve-mcp` 归 T-030，
 *   仍不在命令集内。
 *
 * 全部身体数值取自 `examples/profiles/` 的**完全虚构**档案（`fictional: true`），
 * 断言「CLI 输出与错误永不外泄身体数值」（P-14 / FR-049）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { createFixedClock, createMemoryFs, createStubNet } from '../fixtures/index.js';
import { computeRx } from '../../src/core/rx/index.js';
import { PLAN_LEVELS } from '../../src/core/planner/index.js';
import { LANGUAGE_PACK_KEYS, extractRenderData } from '../../src/core/render/index.js';
import {
  CLI_ERROR,
  CliError,
  EXIT,
  COMMANDS,
  COMMAND_OPTIONS,
  OVERRIDE_KEYS,
  CONFIG_PATH,
  ENV_KEYS,
  parseArgs,
  parseConfigText,
  resolveOverrides,
  createIntlFormatter,
  line,
  requirePort,
  runCli,
} from '../../src/cli/index.js';

// ---------------------------------------------------------------- fixtures

const ROOT = new URL('../../', import.meta.url);
const CLI_DIR = fileURLToPath(new URL('../../src/cli/', import.meta.url));

const ADAPTER = JSON.parse(readFileSync(new URL('data/guideline/generic-guideline.json', ROOT), 'utf8'));
const PROFILE_TEXT = readFileSync(new URL('examples/profiles/global-average-male.json', ROOT), 'utf8');

/** 虚构档案里的特征值；CLI 任何输出 / 错误都不得包含它们（P-14 / FR-049）。 */
const BODY_SENTINELS = Object.freeze(['1450', 'FIX-GLOBAL-AVG-M-01', '23.0', 'body_fat_pct']);

/**
 * 计划正文允许出现「护栏下限 = BMR」（FR-002 要求总能量不得低于 BMR），
 * 但不得出现档案标识、体脂率、BMI 等与计划语义无关的个人字段（P-14）。
 */
const PRIVATE_SENTINELS = Object.freeze(['FIX-GLOBAL-AVG-M-01', 'body_fat_pct', 'bmi', 'muscle_kg']);

const PROFILE_PATH = 'profiles/local.json';
const DAY_FILE = 'plans/2026-11-07.md';

/** 合成只读时令缓存文本（T-014 产出格式，ID 与日期均为虚构值）。 */
const CACHE_TEXT = [
  '# calendar-cache',
  'calendar_id=calendar-fixture-2026',
  'adapter_id=solar-terms',
  'adapter_version=v1',
  'kind=solar-terms',
  'year=2026',
  'status=verified',
  'version=v1',
  'downloaded_at=2026-01-01T00:00:00Z',
  'timezone=UTC+08:00',
  'source_count=2',
  'sources=https://a.example/terms|https://b.example/terms',
  'diff_vs_previous=none',
  'notice_keys=calendar.notice.estimated',
  'term id=term.fixture_c longitude_deg=225 at=2026-11-07T12:00:00+08:00 date=2026-11-07',
  'term id=term.fixture_d longitude_deg=255 at=2026-12-07T11:00:00+08:00 date=2026-12-07',
  '',
  '',
].join('\n');

const CACHE_PATH = 'data/calendar/solar-terms-2026.md';

/** 同一份虚构指南适配器的另一个 id 副本：验证覆盖值真实穿过加载器，而不只是改了输出字段。 */
const adapterAs = (id) => JSON.stringify({ ...ADAPTER, id });

/** 默认工作区：合法虚构档案 + 当年时令缓存 + 三本台账表头位。 */
function workspace(extra = {}) {
  return createMemoryFs({
    files: {
      [PROFILE_PATH]: PROFILE_TEXT,
      'data/guideline/generic-guideline.json': JSON.stringify(ADAPTER),
      [CACHE_PATH]: CACHE_TEXT,
      ...extra,
    },
  });
}

/** 语言包替身：键集齐备，值只是 `S:<key>` 占位，不含自然语言（P-11 / T-031 边界）。 */
function languagePack(tag = 'en') {
  return {
    tag,
    strings: Object.fromEntries(LANGUAGE_PACK_KEYS.map((key) => [key, `S:${key}`])),
    fallback_keys: [],
  };
}

/** T-032 边界替身：只把注入的覆盖值原样返回，不内置任何区域映射。 */
function policyStub(seen = []) {
  return (profile, overrides) => {
    seen.push({ ...overrides });
    const explicit = OVERRIDE_KEYS.some((key) => overrides[key] !== null);
    return {
      language_tag: overrides.lang ?? 'en',
      guideline_id: overrides.guideline ?? 'generic-guideline',
      calendar_id: overrides.calendar ?? 'solar-terms',
      unit_system: 'metric',
      locale_source: explicit ? 'user' : 'auto:fallback',
    };
  };
}

/** 完整依赖：只注入端口，CLI 不直接调任何 Node API。 */
function deps(overrides = {}) {
  return {
    fsPort: workspace(),
    clock: createFixedClock('2026-11-06T20:00:00+08:00'),
    env: {},
    resolveLocalePolicy: policyStub(),
    loadLanguagePack: (tag) => languagePack(tag),
    intlFormatter: createIntlFormatter({ locale: 'en' }),
    acceptanceRunner: async () => ({ red: 19, green: 0 }),
    netPort: createStubNet({ offline: true }),
    ...overrides,
  };
}

const isCliError = (value) => value instanceof CliError;
const hasCode = (error, code) => isCliError(error) && error.issues.some((i) => i.code === code);
const noCjk = (text) => !/[\u4e00-\u9fff]/.test(text);

/** 解析 `key=value` 行；重复键返回数组。 */
function fields(lines) {
  /** @type {Map<string, string[]>} */
  const out = new Map();
  for (const line of lines) {
    const at = line.indexOf('=');
    assert.ok(at > 0, `输出行必须是 key=value：${line}`);
    const key = line.slice(0, at);
    const value = line.slice(at + 1);
    out.set(key, [...(out.get(key) ?? []), value]);
  }
  return out;
}

const one = (lines, key) => {
  const list = fields(lines).get(key);
  return list ? list[0] : undefined;
};
const many = (lines, key) => fields(lines).get(key) ?? [];

/** 捕获同步 / 异步抛出的错误。 */
async function grab(fn) {
  try {
    await fn();
    return null;
  } catch (error) {
    return error;
  }
}

// ------------------------------------------------- FR-029 · 命令与参数解析

test('T-019 · 命令集固定为五条核心命令，T-020 追加两条数据主体命令（FR-029 / FR-049）', () => {
  assert.deepEqual([...COMMANDS].sort(),
    ['acceptance', 'delete-data', 'export-data', 'init', 'ledger', 'plan', 'validate']);
  assert.ok(Object.isFrozen(COMMANDS));
  for (const command of COMMANDS) {
    assert.ok(Array.isArray(COMMAND_OPTIONS[command]), `${command} 必须有显式选项白名单`);
  }
  // 越界命令不得出现在任务口径内（各自归属见 tasks.md）。
  for (const outOfScope of ['locales', 'serve-mcp', 'feedback']) {
    assert.ok(!COMMANDS.includes(outOfScope), `${outOfScope} 不属于 T-019 / T-020`);
  }
});

test('T-019 · 五个命令的全部合法参数被解析为结构化选项（FR-029 / FR-046）', () => {
  const cases = [
    ['init', ['--profile', PROFILE_PATH, '--lang', 'en'], { profile: PROFILE_PATH, lang: 'en' }],
    ['plan', ['--level', 'day', '--date', '2026-11-06', '--guideline', 'generic-guideline',
      '--calendar', 'solar-terms', '--country', 'CN', '--profile', PROFILE_PATH,
      '--lang', 'en', '--out', 'out/day.md'],
    { level: 'day', date: '2026-11-06', guideline: 'generic-guideline', calendar: 'solar-terms',
      country: 'CN', profile: PROFILE_PATH, lang: 'en', out: 'out/day.md' }],
    ['validate', ['--file', DAY_FILE, '--level', 'day', '--strict'],
      { file: DAY_FILE, level: 'day', strict: true }],
    ['ledger', ['--type', 'dedup', '--last', '5'], { type: 'dedup', last: 5 }],
    ['acceptance', ['--ac', 'AC-14', '--red-check'], { ac: 'AC-14', redCheck: true }],
  ];
  for (const [command, argv, expected] of cases) {
    const parsed = parseArgs([command, ...argv]);
    assert.equal(parsed.command, command);
    for (const [key, value] of Object.entries(expected)) {
      assert.deepEqual(parsed.options[key], value, `${command} --${key}`);
    }
  }
  // `--flag=value` 与 `--flag value` 等价。
  assert.deepEqual(parseArgs(['plan', '--level=week']).options, { level: 'week' });
  assert.deepEqual(parseArgs(['plan', '--level', 'week']).options, { level: 'week' });
});

test('T-019 · 缺命令 / 未知命令 / 未知参数一律拒绝，消息只含稳定码（P-14）', async () => {
  for (const [argv, code, field] of [
    [[], CLI_ERROR.COMMAND, '(command)'],
    [['deploy'], CLI_ERROR.COMMAND, '(command)'],
    [['plan', '--nope', 'x'], CLI_ERROR.OPTION, '(options).nope'],
    [['init', '--level', 'day'], CLI_ERROR.OPTION, '(options).level'],
    [['ledger', '--level', 'day'], CLI_ERROR.OPTION, '(options).level'],
  ]) {
    const error = await grab(() => parseArgs(argv));
    assert.ok(hasCode(error, code), `${argv.join(' ')} 应报 ${code}`);
    const issue = error.issues.find((i) => i.code === code);
    assert.equal(issue.field, field);
    assert.match(issue.hint, /^action\.cli\.[a-z0-9._]+$/);
    assert.ok(noCjk(error.message), '错误消息零自然语句');
    assert.equal(error.code, CLI_ERROR.INVALID);
  }
});

test('T-019 · 缺值 / 重复 / 非法枚举值被逐项拒绝（FR-029）', async () => {
  const cases = [
    [['plan', '--level'], CLI_ERROR.OPTION_VALUE, '(options).level'],
    [['plan', '--level', '--date', '2026-11-06'], CLI_ERROR.OPTION_VALUE, '(options).level'],
    [['plan', '--level', 'day', '--level', 'week'], CLI_ERROR.OPTION_DUP, '(options).level'],
    [['plan', '--level', 'quarter'], CLI_ERROR.LEVEL, '(options).level'],
    [['plan', '--date', '2026/11/06'], CLI_ERROR.DATE, '(options).date'],
    [['plan', '--date', '2026-13-01'], CLI_ERROR.DATE, '(options).date'],
    [['ledger', '--type', 'plans'], CLI_ERROR.TYPE, '(options).type'],
    [['ledger', '--last', '-1'], CLI_ERROR.LIMIT, '(options).last'],
    [['ledger', '--last', 'x'], CLI_ERROR.LIMIT, '(options).last'],
    [['acceptance', '--ac', 'AC-99'], CLI_ERROR.AC, '(options).ac'],
    [['plan', '--lang', 'not a tag'], CLI_ERROR.OVERRIDE, '(options).lang'],
    [['plan', '--country', 'CHN'], CLI_ERROR.OVERRIDE, '(options).country'],
  ];
  for (const [argv, code, field] of cases) {
    const error = await grab(() => parseArgs(argv));
    assert.ok(hasCode(error, code), `${argv.join(' ')} 应报 ${code}`);
    assert.equal(error.issues.find((i) => i.code === code).field, field);
  }
  // 合法边界放行。
  assert.equal(parseArgs(['plan', '--level', 'year']).options.level, 'year');
  assert.equal(parseArgs(['acceptance', '--ac', 'all']).options.ac, 'all');
  assert.equal(parseArgs(['ledger', '--last', '0']).options.last, 0);
  assert.equal(parseArgs(['plan', '--country', 'HK']).options.country, 'HK');
  for (const level of PLAN_LEVELS) {
    assert.equal(parseArgs(['plan', '--level', level]).options.level, level);
  }
});

test('T-019 · 参数值不得含控制字符 / 竖线 / 反引号 / 绝对路径（P-11 / FR-028）', async () => {
  for (const value of ['a|b', 'a`b', 'a\u0007b', 'a\nb', '/etc/passwd']) {
    const error = await grab(() => parseArgs(['plan', '--profile', value]));
    assert.ok(hasCode(error, CLI_ERROR.OPTION_VALUE), `应拒绝 ${JSON.stringify(value)}`);
  }
});

// -------------------------------------------- FR-046 · 四层覆盖优先级

test('T-019 · 覆盖优先级严格为 CLI > 环境变量 > 配置文件 > 自动解析（FR-046）', () => {
  const env = { RR_LANG: 'fr', RR_GUIDELINE: 'guideline-env', RR_CALENDAR: 'gregorian-season', RR_COUNTRY: 'FR' };
  const config = { lang: 'de', guideline: 'guideline-config', calendar: 'solar-terms', country: 'DE' };

  const top = resolveOverrides({ options: { lang: 'zh-Hans' }, env, config });
  assert.equal(top.values.lang, 'zh-Hans', 'CLI 覆盖环境变量与配置');
  assert.equal(top.values.guideline, 'guideline-env', '无 CLI 时环境变量其次');
  assert.equal(top.values.calendar, 'gregorian-season', '环境变量覆盖配置');
  assert.equal(top.values.country, 'FR');
  assert.deepEqual(top.sources, { lang: 'cli', guideline: 'env', calendar: 'env', country: 'env' });

  const mid = resolveOverrides({ options: {}, env, config });
  assert.deepEqual(mid.sources, { lang: 'env', guideline: 'env', calendar: 'env', country: 'env' });

  const low = resolveOverrides({ options: {}, env: {}, config });
  assert.deepEqual(low.sources, { lang: 'config', guideline: 'config', calendar: 'config', country: 'config' });

  const auto = resolveOverrides({ options: {}, env: {}, config: {} });
  assert.deepEqual(auto.values, { lang: null, guideline: null, calendar: null, country: null });
  assert.deepEqual(auto.sources, { lang: null, guideline: null, calendar: null, country: null });
  assert.ok(Object.isFrozen(auto.values) && Object.isFrozen(auto.sources));
});

test('T-019 · 任一层的非法覆盖值都失败关闭，且不静默忽略（FR-046）', async () => {
  const bad = [
    [{ options: { lang: 'not a tag' } }, '(options).lang'],
    [{ options: {}, env: { RR_COUNTRY: 'CHN' } }, '(env).RR_COUNTRY'],
    [{ options: {}, env: {}, config: { guideline: 'Bad ID' } }, '(config).guideline'],
    [{ options: {}, env: {}, config: { calendar: '' } }, '(config).calendar'],
  ];
  for (const [input, field] of bad) {
    const error = await grab(() => resolveOverrides(input));
    assert.ok(hasCode(error, CLI_ERROR.OVERRIDE), `应拒绝 ${field}`);
    assert.equal(error.issues.find((i) => i.code === CLI_ERROR.OVERRIDE).field, field);
  }
});

test('T-019 · 配置文件固定键集，未知键 / 非 JSON 对象一律拒绝（FR-040 / P-14）', async () => {
  assert.deepEqual(parseConfigText('{}'), { lang: null, guideline: null, calendar: null, country: null });
  const parsed = parseConfigText(JSON.stringify({ lang: 'en', country: 'CN' }));
  assert.equal(parsed.lang, 'en');
  assert.equal(parsed.country, 'CN');
  assert.equal(parsed.guideline, null);

  for (const text of ['[]', 'null', '{"lang":"en","secret":"x"}', '{bad json}', '{"lang":1}']) {
    const error = await grab(() => parseConfigText(text));
    assert.ok(hasCode(error, CLI_ERROR.CONFIG), `应拒绝配置 ${text}`);
  }
  assert.equal(CONFIG_PATH, 'rr.config.json');
  assert.deepEqual({ ...ENV_KEYS },
    { lang: 'RR_LANG', guideline: 'RR_GUIDELINE', calendar: 'RR_CALENDAR', country: 'RR_COUNTRY' });
  assert.deepEqual([...OVERRIDE_KEYS], ['lang', 'guideline', 'calendar', 'country']);
});

// ------------------------------------------------ FR-043 / FR-028 · 格式化器

test('T-019 · 内置格式化器输出确定、单行、不含竖线与反引号（FR-043 / FR-028）', () => {
  const fmt = createIntlFormatter({ locale: 'en' });
  for (const [value, unit] of [[1450, 'render.unit.kcal'], [1.5, 'render.unit.g'], [0, 'render.unit.ml']]) {
    assert.equal(fmt.number(value, unit), fmt.number(value, unit), '同输入同输出');
    assert.ok(noCjk(fmt.number(value, unit)));
  }
  for (const value of ['2026-11-07', '2026-01-01']) {
    const out = fmt.date(value);
    assert.equal(out, fmt.date(value));
    assert.match(out, /2026/);
  }
  const samples = [fmt.number(1450, 'render.unit.kcal'), fmt.date('2026-11-07')];
  for (const out of samples) {
    assert.ok(typeof out === 'string' && out.length > 0);
    assert.ok(!/[\n\r|`]/.test(out), `输出不得含换行 / 竖线 / 反引号：${out}`);
  }
  // 区域差异只影响呈现，不影响数值语义（FR-044）。
  const de = createIntlFormatter({ locale: 'de' });
  assert.notEqual(de.number(1450, 'render.unit.kcal'), fmt.number(1450, 'render.unit.kcal'));
  assert.equal(de.date('2026-11-07').replace(/\D/g, '').includes('2026'), true);
});

// ------------------------------------------------------- rr init（FR-029）

test('T-019 · rr init 建立三本台账表头与配置文件，输出按路径排序（FR-029 / FR-046）', async () => {
  const fsPort = workspace();
  const res = await runCli(['init', '--profile', PROFILE_PATH, '--lang', 'en'], { fsPort, clock: createFixedClock('2026-11-06T20:00:00+08:00') });

  assert.equal(res.exit, EXIT.OK);
  assert.equal(one(res.lines, 'command'), 'init');
  assert.equal(one(res.lines, 'status'), 'ok');
  assert.deepEqual(many(res.lines, 'created'),
    ['changelog.md', 'feedback.md', 'history.md', CONFIG_PATH]);
  assert.deepEqual(many(res.lines, 'override'), ['lang:cli']);
  assert.equal(one(res.lines, 'profile'), PROFILE_PATH);

  const history = await fsPort.readText('history.md');
  assert.match(history, /^# dedup-ledger$/m);
  assert.match(await fsPort.readText('feedback.md'), /^# feedback-ledger$/m);
  assert.match(await fsPort.readText('changelog.md'), /^# changelog$/m);
  const config = JSON.parse(await fsPort.readText(CONFIG_PATH));
  assert.deepEqual(config, { lang: 'en', guideline: null, calendar: null, country: null });

  // 零身体数据落盘（P-14）。
  for (const path of ['history.md', 'feedback.md', 'changelog.md', CONFIG_PATH]) {
    const text = await fsPort.readText(path);
    for (const sentinel of BODY_SENTINELS) {
      assert.ok(!text.includes(sentinel), `${path} 不得含身体数据 ${sentinel}`);
    }
  }
});

test('T-019 · rr init 幂等：二次运行保留既有文件，不重复写表头（E-05 只追加）', async () => {
  const fsPort = workspace();
  const io = { fsPort, clock: createFixedClock('2026-11-06T20:00:00+08:00') };
  const first = await runCli(['init', '--profile', PROFILE_PATH], io);
  assert.equal(first.exit, EXIT.OK);

  const before = await fsPort.readText('history.md');
  const second = await runCli(['init', '--profile', PROFILE_PATH], io);
  assert.equal(second.exit, EXIT.OK);
  assert.deepEqual(many(second.lines, 'kept'),
    ['changelog.md', 'feedback.md', 'history.md', CONFIG_PATH]);
  assert.deepEqual(many(second.lines, 'created'), []);
  assert.equal(await fsPort.readText('history.md'), before, '表头不被重写');
});

test('T-019 · rr init 拒绝非法档案且错误不含身体数值（P-14 / FR-049）', async () => {
  const fsPort = workspace({
    [PROFILE_PATH]: JSON.stringify(JSON.parse(PROFILE_TEXT)),
  });
  // 去掉必需字段制造非法档案。
  const broken = JSON.parse(PROFILE_TEXT);
  delete broken.body.bmr_kcal;
  await fsPort.writeText(PROFILE_PATH, JSON.stringify(broken));

  const res = await runCli(['init', '--profile', PROFILE_PATH], { fsPort, clock: createFixedClock('2026-11-06T20:00:00+08:00') });
  assert.equal(res.exit, EXIT.DOMAIN);
  assert.equal(one(res.lines, 'status'), 'error');
  assert.match(one(res.lines, 'error'), /^ERR_[A-Z_]+$/);
  const text = res.lines.join('\n');
  for (const sentinel of BODY_SENTINELS) assert.ok(!text.includes(sentinel));
  assert.ok(noCjk(text));
});

// ------------------------------------------------------- rr plan（FR-029）

test('T-019 · rr plan --level day 端到端产出一份可解析的计划文件（FR-029 / SC-009）', async () => {
  const fsPort = workspace();
  const res = await runCli(['plan', '--level', 'day', '--profile', PROFILE_PATH], {
    ...deps({ fsPort }),
  });

  assert.equal(res.exit, EXIT.OK);
  assert.equal(one(res.lines, 'level'), 'day');
  assert.equal(one(res.lines, 'run_date'), '2026-11-06');
  assert.equal(one(res.lines, 'period_id'), '2026-11-07');
  assert.equal(one(res.lines, 'target_date'), '2026-11-07');
  assert.equal(one(res.lines, 'file'), DAY_FILE);
  assert.equal(one(res.lines, 'language_tag'), 'en');
  assert.equal(one(res.lines, 'guideline_id'), 'generic-guideline');
  assert.equal(one(res.lines, 'locale_source'), 'auto:fallback');

  const markdown = await fsPort.readText(DAY_FILE);
  const data = extractRenderData(markdown);
  assert.equal(data.level, 'day');
  assert.equal(data.period_id, '2026-11-07');
  assert.equal(data.file_name, '2026-11-07.md');
  assert.equal(data.run_date, '2026-11-06');
  assert.equal(data.generated_at, '2026-11-06T20:00:00+08:00');
  assert.ok(Number(data['notices.count']) >= 3, '三条基类通知齐备（FR-033）');
  // 计划正文不得含档案标识与与计划无关的个人字段；BMR 仅作为护栏下限出现（FR-002）。
  for (const sentinel of PRIVATE_SENTINELS) assert.ok(!markdown.includes(sentinel), sentinel);
  assert.equal(data['guardrail.energy_floor_kcal'], '1450', '护栏下限 = BMR（FR-002 有意保留）');
  assert.ok(markdown.endsWith('\n') && !markdown.endsWith('\n\n'), '单一结尾换行（FR-028）');
});

test('T-019 · rr plan 只在 20:00 窗口产出日计划（FR-007 / PLAN 口径）', async () => {
  const res = await runCli(['plan', '--level', 'day', '--profile', PROFILE_PATH],
    deps({ clock: createFixedClock('2026-11-06T08:00:00+08:00') }));
  assert.equal(res.exit, EXIT.DOMAIN);
  assert.equal(one(res.lines, 'status'), 'error');
  assert.equal(one(res.lines, 'error'), 'ERR_PLAN_INVALID');
  assert.ok(many(res.lines, 'issue').some((v) => v.startsWith('ERR_PLAN_WINDOW:')));
});

test('T-019 · --date 覆盖运行日但不伪造运行时刻（FR-007 / FR-028）', async () => {
  const fsPort = workspace();
  const res = await runCli(['plan', '--level', 'week', '--date', '2026-11-02', '--profile', PROFILE_PATH],
    deps({ fsPort }));
  assert.equal(res.exit, EXIT.OK);
  assert.equal(one(res.lines, 'run_date'), '2026-11-02');
  assert.equal(one(res.lines, 'period_id'), '2026-W45');
  const data = extractRenderData(await fsPort.readText('plans/2026-W45-week.md'));
  assert.equal(data.run_date, '2026-11-02');
  assert.equal(data.generated_at, '2026-11-06T20:00:00+08:00', '运行时刻仍取自注入时钟');
});

test('T-019 · 覆盖值经解析器生效并记入计划头部来源（FR-046 / AC-16 前置）', async () => {
  const fsPort = workspace({ 'data/guideline/guideline-x.json': adapterAs('guideline-x') });
  const seen = [];
  const res = await runCli(
    ['plan', '--level', 'day', '--profile', PROFILE_PATH, '--lang', 'fr', '--guideline', 'guideline-x'],
    deps({ fsPort, env: { RR_GUIDELINE: 'guideline-env' }, resolveLocalePolicy: policyStub(seen) }),
  );
  assert.equal(res.exit, EXIT.OK);
  assert.equal(seen.length, 1, '策略解析器恰好被调用一次');
  assert.deepEqual(seen[0], { lang: 'fr', guideline: 'guideline-x', calendar: null, country: null });
  assert.deepEqual(many(res.lines, 'override'), ['guideline:cli', 'lang:cli']);

  const data = extractRenderData(await fsPort.readText(DAY_FILE));
  assert.equal(data.language_tag, 'fr');
  assert.equal(data.guideline_id, 'guideline-x');
  assert.equal(data.locale_source, 'user', '显式覆盖记为 user（FR-046）');
});

test('T-019 · 覆盖来源优先级经 CLI 端到端生效：环境变量 > 配置文件（FR-046）', async () => {
  const fsPort = workspace({
    [CONFIG_PATH]: JSON.stringify({ lang: 'de', guideline: 'guideline-config' }),
    'data/guideline/guideline-config.json': adapterAs('guideline-config'),
  });
  const res = await runCli(['plan', '--level', 'day', '--profile', PROFILE_PATH],
    deps({ fsPort, env: { RR_LANG: 'es' }, loadLanguagePack: (tag) => languagePack(tag) }));
  assert.equal(res.exit, EXIT.OK);
  assert.deepEqual(many(res.lines, 'override'), ['guideline:config', 'lang:env']);
  const data = extractRenderData(await fsPort.readText(DAY_FILE));
  assert.equal(data.language_tag, 'es');
  assert.equal(data.guideline_id, 'guideline-config');
  assert.equal(data.locale_source, 'user');
});

test('T-019 · rr plan 全程零对外请求（断网 + 当年缓存即可，AC-12 / SC-008）', async () => {
  const netPort = createStubNet({ offline: true });
  const fsPort = workspace();
  const res = await runCli(['plan', '--level', 'week', '--profile', PROFILE_PATH],
    deps({ fsPort, netPort }));
  assert.equal(res.exit, EXIT.OK);
  assert.deepEqual(netPort.requests(), [], '零网络请求');
});

test('T-019 · 缺时令缓存失败关闭，不回退近似节气（FR-012 / E-03）', async () => {
  const fsPort = createMemoryFs({
    files: {
      [PROFILE_PATH]: PROFILE_TEXT,
      'data/guideline/generic-guideline.json': JSON.stringify(ADAPTER),
    },
  });
  const res = await runCli(['plan', '--level', 'day', '--profile', PROFILE_PATH], deps({ fsPort }));
  assert.equal(res.exit, EXIT.DOMAIN);
  assert.ok(many(res.lines, 'issue').some((v) => v.startsWith('ERR_CALENDAR_CACHE:')));
  assert.equal(await fsPort.exists(DAY_FILE), false, '失败时零写入');
});

test('T-019 · 未注入区域解析器 / 语言包加载器时报端口缺失，不擅自兜底（T-032 / T-031 边界）', async () => {
  const noPolicy = await runCli(['plan', '--level', 'day', '--profile', PROFILE_PATH],
    deps({ resolveLocalePolicy: undefined }));
  assert.equal(noPolicy.exit, EXIT.PORT);
  assert.ok(many(noPolicy.lines, 'issue').some((v) => v.includes('(deps).resolveLocalePolicy')));

  const noPack = await runCli(['plan', '--level', 'day', '--profile', PROFILE_PATH],
    deps({ loadLanguagePack: undefined }));
  assert.equal(noPack.exit, EXIT.PORT);
  assert.ok(many(noPack.lines, 'issue').some((v) => v.includes('(deps).loadLanguagePack')));
});

test('T-019 · 语言包缺键不静默混排，错误只回稳定码（FR-042 / P-11）', async () => {
  const partial = languagePack('en');
  delete partial.strings[LANGUAGE_PACK_KEYS[0]];
  const res = await runCli(['plan', '--level', 'day', '--profile', PROFILE_PATH],
    deps({ loadLanguagePack: () => partial }));
  assert.equal(res.exit, EXIT.DOMAIN);
  assert.ok(many(res.lines, 'issue').some((v) => v.startsWith('ERR_RENDER_PACK_KEY:')));
  assert.ok(noCjk(res.lines.join('\n')));
});

test('T-019 · 不合规的策略解析结果被键集白名单拒绝（FR-046 / P-14）', async () => {
  // 两种不合规：字段缺失（被字段级校验拦下）与「五键齐备但多一个键」（只能靠键集门禁拦下）。
  const full = {
    language_tag: 'en',
    guideline_id: 'generic-guideline',
    calendar_id: 'solar-terms',
    unit_system: 'metric',
    locale_source: 'user',
  };
  const cases = [
    { language_tag: 'en', extra: 1 },
    { ...full, extra: 1 },
  ];
  for (const policy of cases) {
    const res = await runCli(['plan', '--level', 'day', '--profile', PROFILE_PATH],
      deps({ resolveLocalePolicy: () => policy }));
    assert.equal(res.exit, EXIT.DOMAIN, `应拒绝 ${JSON.stringify(Object.keys(policy))}`);
    assert.ok(many(res.lines, 'issue').some((v) => v === `${CLI_ERROR.POLICY}:(policy):action.cli.policy_keys`));
  }
});

test('T-019 · rr plan 结果确定：同输入两次渲染字节一致（FR-028 / NFR-006）', async () => {
  const runOnce = async () => {
    const fsPort = workspace();
    const res = await runCli(['plan', '--level', 'day', '--profile', PROFILE_PATH], deps({ fsPort }));
    assert.equal(res.exit, EXIT.OK);
    return { lines: res.lines, text: await fsPort.readText(DAY_FILE) };
  };
  const a = await runOnce();
  const b = await runOnce();
  assert.deepEqual(a.lines, b.lines);
  assert.equal(a.text, b.text);
  assert.ok(!/\r/.test(a.text), '纯 LF（FR-028）');
});

test('T-019 · --out 指定输出路径，默认落在 plans/（FR-029）', async () => {
  const fsPort = workspace();
  const res = await runCli(
    ['plan', '--level', 'day', '--profile', PROFILE_PATH, '--out', 'custom/d.md'],
    deps({ fsPort }),
  );
  assert.equal(res.exit, EXIT.OK);
  assert.equal(one(res.lines, 'file'), 'custom/d.md');
  assert.equal(await fsPort.exists('custom/d.md'), true);
  assert.equal(await fsPort.exists(DAY_FILE), false);
});

// ------------------------------------------ rr validate（FR-002 / FR-027）

test('T-019 · rr validate 通过规范数据区复核处方 / 版本 / 护栏 / 元数据（FR-002 / FR-027）', async () => {
  const fsPort = workspace();
  const io = deps({ fsPort });
  assert.equal((await runCli(['plan', '--level', 'day', '--profile', PROFILE_PATH], io)).exit, EXIT.OK);

  const res = await runCli(['validate', '--file', DAY_FILE, '--profile', PROFILE_PATH], io);
  assert.equal(res.exit, EXIT.OK);
  assert.equal(one(res.lines, 'command'), 'validate');
  assert.equal(one(res.lines, 'file'), DAY_FILE);
  assert.equal(one(res.lines, 'level'), 'day');
  assert.equal(one(res.lines, 'checked'), '28');

  const strict = await runCli(['validate', '--file', DAY_FILE, '--profile', PROFILE_PATH, '--strict'], io);
  assert.equal(strict.exit, EXIT.OK);
  assert.equal(one(strict.lines, 'checked'), '30', '--strict 追加通知与区段计数校验');
});

test('T-019 · rr validate 检出被篡改的处方 / 版本 / 通知计数（FR-027 / SC-003）', async () => {
  const cases = [
    ['rx.energy_kcal.min', '1500', 'ERR_CLI_DRIFT'],
    ['version.body', 'body-other', 'ERR_CLI_DRIFT'],
    ['notices.count', '0', 'ERR_CLI_DRIFT'],
  ];
  for (const [key, value, code] of cases) {
    const fsPort = workspace();
    const io = deps({ fsPort });
    assert.equal((await runCli(['plan', '--level', 'day', '--profile', PROFILE_PATH], io)).exit, EXIT.OK);
    const text = await fsPort.readText(DAY_FILE);
    const tampered = text.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`);
    assert.notEqual(tampered, text, `篡改锚点必须命中：${key}`);
    await fsPort.writeText(DAY_FILE, tampered);

    const res = await runCli(['validate', '--file', DAY_FILE, '--profile', PROFILE_PATH, '--strict'], io);
    assert.equal(res.exit, EXIT.DOMAIN, `${key} 篡改应被拒绝`);
    assert.ok(many(res.lines, 'issue').some((v) => v.startsWith(`${code}:`)), `${key} 应报 ${code}`);
  }
});

test('T-019 · rr validate 缺文件 / 非计划文件失败关闭，不回显文件内容（P-14）', async () => {
  const missing = await runCli(['validate', '--file', 'plans/none.md', '--profile', PROFILE_PATH],
    deps());
  assert.equal(missing.exit, EXIT.DOMAIN);
  assert.ok(many(missing.lines, 'issue').some((v) => v.startsWith(`${CLI_ERROR.FILE}:`)));

  const fsPort = workspace({ 'plans/bad.md': '# not a plan\n' });
  const bad = await runCli(['validate', '--file', 'plans/bad.md', '--profile', PROFILE_PATH],
    deps({ fsPort }));
  assert.equal(bad.exit, EXIT.DOMAIN);
  assert.ok(!bad.lines.join('\n').includes('not a plan'), '不回显文件正文');
});

test('T-019 · rr validate 可由 --level + --date 推导目标文件（FR-029）', async () => {
  const fsPort = workspace();
  const io = deps({ fsPort });
  assert.equal((await runCli(['plan', '--level', 'day', '--profile', PROFILE_PATH], io)).exit, EXIT.OK);

  const res = await runCli(
    ['validate', '--level', 'day', '--date', '2026-11-06', '--profile', PROFILE_PATH],
    io,
  );
  assert.equal(res.exit, EXIT.OK);
  assert.equal(one(res.lines, 'file'), DAY_FILE);
});

// --------------------------------------------- rr ledger（FR-029 / FR-015）

test('T-019 · rr ledger 查询三本台账并支持 --last 截取（FR-029 / FR-015）', async () => {
  const dedupRows = [
    '| 2026-11-02 | week | 2026-W45 | dish.a | staple.b | fp-1a2b3c4d | body:body-v1,rx:rx-v1,loc:loc-v1,st:st-v1,rule:rule-v1 | - | week_plan |',
    '| 2026-11-03 | day | 2026-11-03 | dish.c | staple.d | fp-5e6f7a8b | body:body-v1,rx:rx-v1,loc:loc-v1,st:st-v1,rule:rule-v1 | - | daily |',
  ].join('\n');
  const fsPort = workspace({
    'history.md': ['# dedup-ledger',
      '| date | level | period_id | main_id | staple_id | combo_fp | version_ids | cycle_key | source |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- |', dedupRows, ''].join('\n'),
  });
  const io = deps({ fsPort });

  const all = await runCli(['ledger', '--type', 'dedup'], io);
  assert.equal(all.exit, EXIT.OK);
  assert.equal(one(all.lines, 'type'), 'dedup');
  assert.equal(one(all.lines, 'count'), '2');
  assert.equal(many(all.lines, 'row').length, 2);
  assert.ok(many(all.lines, 'row')[0].includes('dish.a'), '行内容原样透传');

  const last1 = await runCli(['ledger', '--type', 'dedup', '--last', '1'], io);
  assert.equal(one(last1.lines, 'count'), '1');
  assert.ok(many(last1.lines, 'row')[0].includes('dish.c'), '--last 取尾部');

  const zero = await runCli(['ledger', '--type', 'dedup', '--last', '0'], io);
  assert.equal(one(zero.lines, 'count'), '0');
  assert.deepEqual(many(zero.lines, 'row'), []);
});

test('T-019 · rr ledger 空台账返回 count=0 而非失败（E-05 首次只写表头）', async () => {
  const res = await runCli(['ledger', '--type', 'feedback'], deps());
  assert.equal(res.exit, EXIT.OK);
  assert.equal(one(res.lines, 'type'), 'feedback');
  assert.equal(one(res.lines, 'count'), '0');
  assert.equal(one(res.lines, 'status'), 'ok');

  const changelog = await runCli(['ledger', '--type', 'changelog'], deps());
  assert.equal(changelog.exit, EXIT.OK);
  assert.equal(one(changelog.lines, 'type'), 'changelog');
});

// ------------------------------------- rr acceptance（AC-14 / P-02）

test('T-019 · rr acceptance 透传 --ac / --red-check 并汇报红绿计数（AC-14 / P-02）', async () => {
  const calls = [];
  const runner = async (request) => {
    calls.push(request);
    return { red: 19, green: 0, ok: request.redCheck === true };
  };

  const res = await runCli(['acceptance', '--ac', 'all', '--red-check'], deps({ acceptanceRunner: runner }));
  assert.equal(res.exit, EXIT.OK);
  assert.deepEqual(calls, [{ ac: 'all', redCheck: true }]);
  assert.equal(one(res.lines, 'ac'), 'all');
  assert.equal(one(res.lines, 'red'), '19');
  assert.equal(one(res.lines, 'green'), '0');
  assert.equal(one(res.lines, 'status'), 'ok');

  const single = await runCli(['acceptance', '--ac', 'AC-14'], deps({ acceptanceRunner: runner }));
  assert.equal(single.exit, EXIT.OK);
  assert.deepEqual(calls[1], { ac: 'AC-14', redCheck: false });
});

test('T-019 · rr acceptance 未注入执行器时报端口缺失（P-02 边界）', async () => {
  const res = await runCli(['acceptance', '--ac', 'all'], deps({ acceptanceRunner: undefined }));
  assert.equal(res.exit, EXIT.PORT);
  assert.ok(many(res.lines, 'issue').some((v) => v.includes('(deps).acceptanceRunner')));
});

// ------------------------------------------------ 横切约束（P-11 / P-14）

test('T-019 · SC-009：从零到第一份日计划只经 2 步显式操作（SC-009）', async () => {
  const fsPort = workspace();
  const io = deps({ fsPort });
  const operations = [
    ['init', '--profile', PROFILE_PATH],
    ['plan', '--level', 'day', '--profile', PROFILE_PATH],
  ];
  let step = 0;
  for (const argv of operations) {
    const res = await runCli(argv, io);
    assert.equal(res.exit, EXIT.OK, `${argv[0]} 必须成功`);
    step += 1;
  }
  assert.ok(step <= 3, '显式操作 ≤ 3 步（SC-009）');
  assert.equal(await fsPort.exists(DAY_FILE), true, '两步内产出日计划');
});

test('T-019 · 全部输出行为 ASCII key=value，顺序确定且零自然语句（P-11 / FR-041）', async () => {
  const fsPort = workspace();
  const io = deps({ fsPort });
  const outputs = [
    await runCli(['init', '--profile', PROFILE_PATH], io),
    await runCli(['plan', '--level', 'day', '--profile', PROFILE_PATH], io),
    await runCli(['validate', '--file', DAY_FILE, '--profile', PROFILE_PATH], io),
    await runCli(['ledger', '--type', 'dedup'], io),
    await runCli(['acceptance', '--ac', 'all', '--red-check'], io),
  ];
  for (const res of outputs) {
    assert.equal(one(res.lines, 'command'), ['init', 'plan', 'validate', 'ledger', 'acceptance'][outputs.indexOf(res)]);
    assert.equal(one(res.lines, 'status'), 'ok');
    assert.equal(res.lines.at(-1), 'status=ok', '状态行固定在末尾');
    for (const line of res.lines) {
      assert.match(line, /^[a-z][a-z0-9._-]*=[\x20-\x7E]*$/, `非法输出行：${line}`);
      assert.ok(noCjk(line));
    }
  }
  // 同输入重复执行输出一致（零时间戳 / 零随机数）。
  const again = await runCli(['ledger', '--type', 'dedup'], io);
  assert.deepEqual(again.lines, outputs[3].lines);
});

test('T-019 · 退出码固定且互不重叠（成功 / 用法 / 业务 / 端口）', async () => {
  assert.deepEqual({ ...EXIT }, { OK: 0, USAGE: 1, DOMAIN: 2, PORT: 3 });
  assert.ok(Object.isFrozen(EXIT));

  const usage = await grab(() => parseArgs(['nope']));
  assert.ok(isCliError(usage));
  assert.equal(usage.code, CLI_ERROR.INVALID);
  for (const code of Object.values(CLI_ERROR)) {
    assert.match(code, /^ERR_CLI_[A-Z_]+$/);
  }
});

test('T-019 · src/cli 源码零 `node:` 导入、SPDX 头齐备、输出无中文常量（P-11 / P-02）', () => {
  const files = readdirSync(CLI_DIR).filter((f) => f.endsWith('.js'));
  assert.ok(files.length > 0, 'src/cli 必须已有实现文件');
  for (const file of files) {
    const text = readFileSync(join(CLI_DIR, file), 'utf8');
    assert.match(text.split('\n')[0], /^\/\/ SPDX-License-Identifier: GPL-3\.0-only$/,
      `${file} 首行必须是 SPDX 头`);
    assert.ok(!/from\s+'node:/.test(text), `${file} 不得直接导入 node: 内置模块（只经 io 端口）`);
    assert.ok(!/require\(/.test(text), `${file} 必须为纯 ESM`);
  }
});

// ------------------------------------------------- 独立取证：不靠单一门禁

test('T-019 · 输出行构造拒绝非规范键与非 ASCII 值（P-11 / FR-041）', () => {
  assert.equal(line('count', 3), 'count=3');
  for (const [key, value] of [['count', '中文'], ['KEY', 'v'], ['count', 'a\nb'], ['count', 'a\tb'], ['count', 'a\u0007b']]) {
    let caught = null;
    try {
      line(key, value);
    } catch (error) {
      caught = error;
    }
    assert.ok(hasCode(caught, CLI_ERROR.INVALID), `应拒绝 ${key}=${JSON.stringify(value)}`);
  }
});

test('T-019 · 必需端口只接受函数或对象，null / 字符串 / 缺失一律报端口缺失（P-02）', () => {
  for (const deps of [{}, { loadLanguagePack: null }, { loadLanguagePack: 'pack' }, { loadLanguagePack: 1 }]) {
    let caught = null;
    try {
      requirePort(deps, 'loadLanguagePack', 'action.cli.port.locale');
    } catch (error) {
      caught = error;
    }
    assert.ok(hasCode(caught, CLI_ERROR.PORT));
    assert.equal(caught.issues[0].field, '(deps).loadLanguagePack');
  }
  const fn = () => 'ok';
  assert.equal(requirePort({ loadLanguagePack: fn }, 'loadLanguagePack', 'x'), fn);
});

test('T-019 · 参数解析失败在入口层即为用法错误（exit 1），不进入任何命令（FR-029）', async () => {
  const res = await runCli(['plan', '--nope', 'x'], deps());
  assert.equal(res.exit, EXIT.USAGE);
  assert.equal(one(res.lines, 'command'), 'plan');
  assert.equal(one(res.lines, 'error'), CLI_ERROR.INVALID);
  assert.ok(many(res.lines, 'issue').some((v) => v === `${CLI_ERROR.OPTION}:(options).nope:action.cli.option`));
  assert.equal(one(res.lines, 'status'), 'error');

  const empty = await runCli([], deps());
  assert.equal(empty.exit, EXIT.USAGE);
  assert.equal(one(empty.lines, 'command'), 'unknown');
});

test('T-019 · 五个层级都能产出计划文件且层级自洽（FR-006 层级覆盖）', async () => {
  const expected = {
    year: ['2026', 'plans/2026-annual.md'],
    season: ['2026-Q4', 'plans/2026-Q4.md'],
    month: ['2026-11', 'plans/2026-11-month.md'],
    week: ['2026-W45', 'plans/2026-W45-week.md'],
    day: ['2026-11-07', 'plans/2026-11-07.md'],
  };
  for (const level of PLAN_LEVELS) {
    const fsPort = workspace();
    const res = await runCli(['plan', '--level', level, '--profile', PROFILE_PATH], deps({ fsPort }));
    assert.equal(res.exit, EXIT.OK, `${level} 应成功`);
    assert.equal(one(res.lines, 'level'), level);
    assert.equal(one(res.lines, 'period_id'), expected[level][0]);
    assert.equal(one(res.lines, 'file'), expected[level][1]);
    const data = extractRenderData(await fsPort.readText(expected[level][1]));
    assert.equal(data.level, level);
    assert.equal(data.period_id, expected[level][0]);
  }
});

test('T-019 · rr validate 拒绝 --level 与文件实际层级不一致（FR-027）', async () => {
  const fsPort = workspace();
  const io = deps({ fsPort });
  assert.equal((await runCli(['plan', '--level', 'day', '--profile', PROFILE_PATH], io)).exit, EXIT.OK);

  const res = await runCli(['validate', '--file', DAY_FILE, '--level', 'week', '--profile', PROFILE_PATH], io);
  assert.equal(res.exit, EXIT.DOMAIN);
  assert.ok(many(res.lines, 'issue').some((v) => v.startsWith(`${CLI_ERROR.DRIFT}:(file).level:`)));
});

test('T-019 · rr acceptance --red-check 发现已绿场景即判基线被绕过（P-02 / P-09）', async () => {
  const res = await runCli(['acceptance', '--ac', 'all', '--red-check'],
    deps({ acceptanceRunner: async () => ({ red: 18, green: 1 }) }));
  assert.equal(res.exit, EXIT.DOMAIN);
  assert.ok(many(res.lines, 'issue').some((v) => v.startsWith(`${CLI_ERROR.DRIFT}:(acceptance).green:`)));
});

test('T-019 · 参数解析结果与覆盖结果不可变，输入对象不被改写（FR-028）', () => {
  const options = { lang: 'en' };
  const env = { RR_GUIDELINE: 'guideline-env' };
  const config = { country: 'CN' };
  const resolved = resolveOverrides({ options, env, config });
  assert.ok(Object.isFrozen(resolved) && Object.isFrozen(resolved.values));
  assert.deepEqual(options, { lang: 'en' });
  assert.deepEqual(env, { RR_GUIDELINE: 'guideline-env' });
  assert.deepEqual(config, { country: 'CN' });

  const parsed = parseArgs(['plan', '--level', 'day']);
  assert.ok(Object.isFrozen(parsed) && Object.isFrozen(parsed.options));
});

test('T-019 · rr ledger --last 超过总行数时返回全部行（FR-029）', async () => {
  const fsPort = workspace({
    'history.md': ['# dedup-ledger',
      '| date | level | period_id | main_id | staple_id | combo_fp | version_ids | cycle_key | source |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      '| 2026-11-02 | week | 2026-W45 | dish.a | staple.b | fp-1a2b3c4d | body:body-v1,rx:rx-v1,loc:loc-v1,st:st-v1,rule:rule-v1 | - | week_plan |',
      ''].join('\n'),
  });
  const res = await runCli(['ledger', '--type', 'dedup', '--last', '50'], deps({ fsPort }));
  assert.equal(res.exit, EXIT.OK);
  assert.equal(one(res.lines, 'count'), '1');
});
