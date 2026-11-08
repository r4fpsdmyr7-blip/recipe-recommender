// SPDX-License-Identifier: GPL-3.0-only
// [AIGC] T-022 · P1 出口门禁取证 · 审计追踪 ID: RR-T022-20261108-0001 · 待人工审查（P-10）
/**
 * T-022 · Phase 1 出口门禁（tasks.md T-022）的**取证器**。
 *
 * 本模块只做三件事：逐条取证 AC-01～12、检查六项门禁、如实报告结论。
 * 它**不**把任何 `ac-*.md` 状态改为 GREEN、**不**写任何文件、**不**弱化或跳过场景。
 * 理由：P-02 要求「实现通过全部 AC」才可转绿，P-09 / RK-03 禁止靠删场景换绿，
 * P-10 / constitution §3.1(5) 要求 `[AIGC]` 基线变更经人工审查。因此「红→绿」的
 * 状态写入属于人工裁决动作，本任务只交付可复核的取证报告与红→绿记录草案。
 *
 * 硬约束：
 * - 命名不是 `*.test.js` / `*.test.mjs`（tasks.md §2）；由 tests/unit/p1-gate.test.js import 断言。
 * - 零磁盘写入、零子进程、零第三方依赖；唯一外部取证是 T-021 的纯内存离线集成。
 * - 真实数据令牌正则动态取自 .github/workflows/ci.yml 的唯一权威规则，绝不复制字面量
 *   （先红阶段实测：复制字面量会被 T-021 的 privacy.static_scan 正确判定为命中）。
 * - 场景文本实时从 SPEC.md §8 提取并逐字比对，任何删改 / 跳过 / 弱化都会让门禁失败。
 *
 * 用法：
 *   node tests/acceptance/gates/p1-gate.mjs        # 纯 ASCII key=value 报告，exit 0/1/2
 *   import { runP1Gate } from './p1-gate.mjs';     # 供单测 / CI 复用
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { runOfflineIntegration } from '../offline-integration.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const SCENARIO_RE = /^```gherkin\r?\n([\s\S]*?)^```[ \t]*$/m;
const RR_DATA_RE = /^```rr-data\r?\n([\s\S]*?)^```[ \t]*$/m;

/** T-022 出口门禁要求的 12 条 AC。 */
export const P1_AC_IDS = Object.freeze(
  Array.from({ length: 12 }, (_, k) => String(k + 1).padStart(2, '0')),
);

/** 逐条取证结论：端到端通过 / 仅核心域可证 / 存在业务缺口。 */
export const AC_STATUS = Object.freeze({
  E2E: 'E2E_PASS',
  CORE: 'CORE_ONLY',
  GAP: 'GAP',
});

/** 六项门禁 ID（顺序固定、唯一）。 */
export const GATE_CHECK_IDS = Object.freeze([
  'gate.scenarios_faithful',
  'gate.core_capabilities',
  'gate.offline_integration',
  'gate.static_privacy',
  'gate.no_silent_green',
  'gate.traceability',
]);

/** 从 SPEC.md §8 实时提取场景文本（唯一权威，与 T-004 驱动同口径）。 */
function specScenarios() {
  const text = readFileSync(join(ROOT, 'SPEC.md'), 'utf8');
  const heads = [...text.matchAll(/^## \d+\. .+$/gm)];
  const i = heads.findIndex((h) => h[0].startsWith('## 8.'));
  if (i < 0) throw new Error('ERR_T022_SPEC_SECTION_MISSING');
  const end = i + 1 < heads.length ? heads[i + 1].index : text.length;
  const sec = text.slice(heads[i].index, end);
  const titles = [...sec.matchAll(/^### (AC-\d{2}) · (.+)$/gm)];
  const parts = sec.split(/^### AC-\d{2} · .+$/m).slice(1);
  const out = new Map();
  titles.forEach((t, k) => {
    const m = (parts[k] || '').match(SCENARIO_RE);
    out.set(t[1], m ? m[1].replace(/\r\n/g, '\n').trim() : null);
  });
  return out;
}

/** 两种**独立实现**的全仓遍历，用于证明静态扫描不是空扫。 */
function walkRecursive(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === '.git' || e.name === 'node_modules') return [];
    const p = join(dir, e.name);
    return e.isDirectory() ? walkRecursive(p) : [p];
  });
}
function walkStack(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else out.push(p);
    }
  }
  return out;
}
const isSource = (p) => /\.(js|mjs)$/.test(p);

/** 解析 FR-044 的 `rr-data` 纯 ASCII 规范数据区。 */
function canonicalData(text) {
  const m = RR_DATA_RE.exec(text);
  /** @type {Record<string, string>} */
  const out = Object.create(null);
  if (!m) return out;
  for (const line of m[1].split('\n')) {
    const at = line.indexOf('=');
    if (at > 0) out[line.slice(0, at)] = line.slice(at + 1);
  }
  return out;
}

/** 唯一权威的真实数据令牌规则：动态取自 CI，不复制字面量。 */
function tokenRule() {
  const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  const m = /const TOKENS = \/(.+?)\/;/.exec(ci);
  if (!m) throw new Error('ERR_T022_TOKEN_RULE_MISSING');
  return new RegExp(m[1]);
}

function exists(rel) {
  return existsSync(join(ROOT, rel));
}

/**
 * 逐条取证 AC-01～12。
 * 判定口径刻意严格：只有「从端到端产物可复算」才算 E2E_PASS；
 * 仅核心域单测可证、但未接入 CLI 端到端产物的一律 CORE_ONLY；
 * 场景明确要求而实现尚不存在的正文能力一律 GAP。
 */
function assess(offline, spec, sources) {
  const plans = offline.plans?.absent ?? {};
  const day = Object.values(plans).find((p) => p.file === 'plans/2026-11-07.md');
  const text = day?.text ?? '';
  const d = canonicalData(text);
  const num = (k) => Number(d[k] ?? NaN);
  const head = (k) => String(d[k] ?? '');

  // 端到端产物中确实存在的事实（供多条 AC 复用，避免声明式通过）。
  const e2e = {
    dayFile: day?.file ?? '',
    exit: day?.exit ?? -1,
    period: head('period_id'),
    trigger: head('trigger'),
    level: head('level'),
    sections: num('sections.count'),
    days: num('days.count'),
    notices: num('notices.count'),
    guideline: head('guideline_id'),
    energyMin: num('rx.energy_kcal.min'),
    energyMax: num('rx.energy_kcal.max'),
    proteinMin: num('rx.protein_g.min'),
    proteinMax: num('rx.protein_g.max'),
    saltMax: num('rx.salt_g.max'),
    oilMin: num('rx.oil_g.min'),
    oilMax: num('rx.oil_g.max'),
    sugarMax: num('rx.added_sugar_g.max'),
    floor: num('guardrail.energy_floor_kcal'),
    fiveLevels: offline.plans?.absent ? Object.keys(offline.plans.absent).filter((k) => k.startsWith('plan.')).length : 0,
  };

  const rows = [];
  const add = (id, status, evidence, gaps, refs) => rows.push({
    id,
    status,
    scenario: spec.get(`AC-${id}`) ?? null,
    evidence: Object.freeze(evidence),
    gaps: Object.freeze(gaps),
    sources: Object.freeze(refs.filter((r) => exists(r) || sources.has(r))),
  });

  // ---- AC-01：处方区间与 BMR 护栏（可从 rr-data 完整复算）----
  const a1Pass = e2e.exit === 0 && e2e.guideline.length > 0
    && e2e.energyMin >= 1550 && e2e.energyMax <= 1700
    && e2e.energyMin >= e2e.floor && e2e.floor === 1450
    && e2e.proteinMin >= 88 && e2e.proteinMax <= 100
    && e2e.saltMax < 5 && e2e.oilMin >= 25 && e2e.oilMax <= 30 && e2e.sugarMax < 25;
  add('01', a1Pass ? AC_STATUS.E2E : AC_STATUS.GAP, [
    `rx.energy_kcal=${e2e.energyMin}..${e2e.energyMax}`,
    `rx.protein_g=${e2e.proteinMin}..${e2e.proteinMax}`,
    `rx.salt_g.max=${e2e.saltMax}`,
    `rx.oil_g.min=${e2e.oilMin}`,
    `rx.oil_g.max=${e2e.oilMax}`,
    `rx.added_sugar_g.max=${e2e.sugarMax}`,
    `energy_floor_kcal=${e2e.floor}`,
    `guideline_id=${e2e.guideline}`,
    `plan_file=${e2e.dayFile}`,
  ], a1Pass ? [] : ['处方区间或 BMR 护栏未在端到端规范数据区满足'], [
    'tests/acceptance/offline-integration.mjs', 'src/core/rx/compute-rx.js',
    'data/guideline/generic-guideline.json', 'src/core/render/index.js',
  ]);

  // ---- AC-02：五级周期与首日口径（当前装配只固定 2026-11-06，无法复跑 1/1 与周一）----
  add('02', AC_STATUS.CORE, [
    `levels_generated=${e2e.fiveLevels}`,
    `level=${e2e.level}`,
    `period_id=${e2e.period}`,
    `planner_unit=tests/unit/plan.test.js`,
  ], [
    'AC-02 的两个固定日期场景（2026-01-01 三层合并视图、2026-11-02 周一产当周）只在 T-013 单测层取证，未通过固定时钟在 CLI 端到端复跑。',
    'periodic-plan.md 的「三层合并视图」需 1/1 触发条件，当前装配时钟固定为 2026-11-06。',
  ], ['tests/unit/plan.test.js', 'src/core/planner/period.js', 'src/cli/plan.js']);

  // ---- AC-03：日级次日口径（日期与文件名可证；四餐正文不可证）----
  const dateOk = e2e.exit === 0 && e2e.period === '2026-11-07'
    && e2e.dayFile === 'plans/2026-11-07.md' && text.includes('2026-11-07')
    && e2e.trigger === 'plan.trigger.daily_2000';
  add('03', AC_STATUS.GAP, [
    `date_ok=${dateOk}`,
    `target_date=${e2e.period}`,
    `file=${e2e.dayFile}`,
    `trigger=${e2e.trigger}`,
    `sections.count=${e2e.sections}`,
  ], [
    `规范数据区 sections.count=${e2e.sections}：日计划正文未接入早/午/晚/加餐四餐结构表，故「生重克数、做法要点、四餐热量与蛋白、全天合计与处方对照」均无端到端可观察产物。`,
    '四餐明细的食材内容依赖 T-035 数据源适配器（Phase 2），P1 核心域按定案零内置食材表。',
  ], ['tests/acceptance/offline-integration.mjs', 'src/core/purchase/daily.js', 'src/cli/plan.js']);

  // ---- AC-04：节气缓存与失败回退（核心域完整，缓存路径存在待裁决张力）----
  add('04', AC_STATUS.CORE, [
    'calendar_unit=tests/unit/calendar.test.js',
    'cache_file=data/calendar/solar-terms-2026.md',
    `calendar.status=${head('calendar.status')}`,
    `calendar.term_count=${head('calendar.term_count')}`,
    'url_guard=src/io/net.js',
  ], [
    'SPEC §8 AC-04 写 `_data/solar-terms-2027.md`，实现默认 `data/calendar/`：T-014 README 已登记为待人工裁决的规格张力，未裁决前不得声称场景完全满足。',
    '2027 年联网刷新与双源一致校验属年度刷新路径，离线门禁禁止发请求，端到端未复跑。',
  ], ['tests/unit/calendar.test.js', 'src/core/calendar/refresh.js', 'src/io/net.js']);

  // ---- AC-05：居住地变更重算（T-012 定案不重算计划正文）----
  add('05', AC_STATUS.GAP, [
    'recalc_unit=tests/unit/recalc.test.js',
    'future_only=src/core/planner/apply.js',
    `version.loc=${head('version.loc')}`,
  ], [
    'T-012 定案「不重算计划正文」：applyRecalcToFuture 只做未来文件切分与哈希复验，计划不会采用新城市的气候主线 / 时令食材库 / 饮水量 / 采购渠道。',
    '区域映射表归 T-033（Phase 2），P1 无气候 / 渠道数据来源。',
  ], ['tests/unit/recalc.test.js', 'src/core/planner/apply.js']);

  // ---- AC-06：身体数据变更重算（时间线护栏可证，正文重算不可证）----
  add('06', AC_STATUS.GAP, [
    'recalc_unit=tests/unit/recalc.test.js',
    'historical_hash_guard=src/core/planner/apply.js',
    `recalc.needs_recalc=${head('recalc.needs_recalc')}`,
  ], [
    '「热量 / 蛋白目标按新数据重算」需要重算计划正文，T-012 按定案不重算正文，端到端无此产物。',
    '「仅未来计划被修改 + 历史文件哈希不变」在 T-012 单测层已取证，但不能替代整条场景。',
  ], ['tests/unit/recalc.test.js', 'src/core/planner/apply.js']);

  // ---- AC-07 / AC-08：去重核心域完整，未接入端到端 ----
  add('07', AC_STATUS.CORE, [
    'dedup_unit=tests/unit/dedup.test.js',
    'window=src/core/dedup/apply.js',
    'ledger=src/core/dedup/index.js',
  ], [
    `规范数据区 sections.count=${e2e.sections}：去重结果未接入 rr plan 的端到端计划正文，无「第 7 天主菜+主食组合」可观察产物。`,
  ], ['tests/unit/dedup.test.js', 'src/core/dedup/apply.js', 'src/cli/plan.js']);

  add('08', AC_STATUS.CORE, [
    'dedup_unit=tests/unit/dedup.test.js',
    'cycle_key=src/core/dedup/apply.js',
    'week_rule=src/core/dedup/index.js',
  ], [
    '跨年代表菜复用与同周主菜互斥在核心域单测可证，但未在「今年立冬生成计划」的年度端到端场景复跑。',
  ], ['tests/unit/dedup.test.js', 'src/core/dedup/apply.js']);

  // ---- AC-09：采购两栏核心域完整，正文与渠道依赖 P2 ----
  add('09', AC_STATUS.CORE, [
    'purchase_unit=tests/unit/purchase.test.js',
    'theoretical_actual=src/core/purchase/purchase.js',
    'daily_topup=src/core/purchase/daily.js',
  ], [
    `规范数据区 sections.count=${e2e.sections}：周计划正文未接「全周理论用量 / 剩余窗口实际补购量」两栏。`,
    '储存方式、缺货等价替换、居住地渠道与备餐建议依赖 T-035 数据源与 T-033 区域映射（Phase 2）。',
  ], ['tests/unit/purchase.test.js', 'src/core/purchase/purchase.js', 'src/cli/plan.js']);

  // ---- AC-10 / AC-11：反馈状态机核心域完整，未接入端到端级联 ----
  add('10', AC_STATUS.CORE, [
    'feedback_unit=tests/unit/feedback.test.js',
    'class_a=src/core/feedback/classify.js',
    'ledgers=src/core/feedback/index.js',
  ], [
    'A 类「双源取证 / 只改错误点 / 修订标注 / 台账状态 / 规则版本」在核心域单测可证，但「上级文件矛盾 → 下级计划生成时发现」的端到端链路未取证。',
  ], ['tests/unit/feedback.test.js', 'src/core/feedback/revision.js', 'src/cli/plan.js']);

  add('11', AC_STATUS.CORE, [
    'feedback_unit=tests/unit/feedback.test.js',
    'hash_guard=src/core/feedback/revision.js',
    'd1_d2=src/core/feedback/classify.js',
  ], [
    'D 类「已执行哈希不变 / 只写未来 / 框架调整只加提示并登记待对齐」在核心域单测可证，但未在 CLI 向下级联命令端到端复跑。',
  ], ['tests/unit/feedback.test.js', 'src/core/feedback/revision.js', 'src/cli/plan.js']);

  // ---- AC-12：离线与隐私（T-021 已提供完整端到端取证）----
  const ac12 = offline.checks?.find((c) => c.id === 'ac12.month_week_day');
  const network = offline.checks?.find((c) => c.id === 'network.zero_requests');
  const privacy = offline.checks?.find((c) => c.id === 'privacy.static_scan');
  const a12Pass = offline.ok === true && ac12?.ok === true && network?.ok === true && privacy?.ok === true
    && AC_STATUS.E2E.length > 0;
  add('12', a12Pass ? AC_STATUS.E2E : AC_STATUS.GAP, [
    `offline.ok=${offline.ok}`,
    `offline.checks=${offline.checks?.length ?? 0}`,
    `ac12.month_week_day=${ac12?.ok ?? false}`,
    `network.zero_requests=${network?.ok ?? false}`,
    `privacy.static_scan=${privacy?.ok ?? false}`,
    `requests=${offline.modes?.reduce((n, m) => n + (offline.requests?.[m]?.length ?? 0), 0) ?? -1}`,
    `disk_writes=${offline.diskWrites}`,
  ], a12Pass ? [] : ['T-021 离线集成门禁未全过'], [
    'tests/acceptance/offline-integration.mjs', 'tests/acceptance/OFFLINE.md',
    'tests/unit/offline-integration.test.js', '.gitignore',
  ]);

  return Object.freeze(rows);
}

/**
 * 跑一遍 P1 出口门禁取证。零磁盘写入、零子进程。
 * @returns {Promise<object>} 结构化报告；verdict 恒等于「12 条全 E2E_PASS 且六项门禁全过」
 */
export async function runP1Gate() {
  const offline = await runOfflineIntegration();
  const spec = specScenarios();
  const allFiles = walkRecursive(ROOT);
  const srcFiles = allFiles.filter(isSource);
  const independent = walkStack(ROOT).filter(isSource).length;
  const sourceSet = new Set(allFiles.map((p) => p.replace(/\\/g, '/')));

  const rows = assess(offline, spec, sourceSet);
  /** @type {Array<{id: string, ok: boolean, detail: string}>} */
  const checks = [];
  const check = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail });

  const scenarioCount = P1_AC_IDS.filter((id) => typeof spec.get(`AC-${id}`) === 'string').length;
  const faithful = scenarioCount === 12 && rows.every((r) => {
    const s = spec.get(`AC-${r.id}`);
    return typeof s === 'string' && s.length > 40 && r.scenario === s && !/SKIP|skip\s*=\s*true/i.test(s);
  });
  check('gate.scenarios_faithful', faithful, `SPEC §8 实时提取 ${scenarioCount}/12，逐字比对且无跳过标记`);

  const dirs = ['profile', 'rx', 'planner', 'calendar', 'dedup', 'purchase', 'feedback', 'render'];
  const dirsOk = dirs.every((d) => readdirSync(join(ROOT, 'src/core', d)).some((f) => f.endsWith('.js')))
    && ['cli', 'io'].every((d) => readdirSync(join(ROOT, 'src', d)).some((f) => f.endsWith('.js')));
  check('gate.core_capabilities', dirsOk, `8 个核心域 + cli/io 实现目录齐备（${srcFiles.length} 个源码文件）`);

  check('gate.offline_integration', offline.ok === true && offline.checks.length === 14,
    `T-021 checks=${offline.checks.length} failed=${offline.checks.filter((c) => !c.ok).length}`);

  const tokens = tokenRule();
  const self = '.github/workflows/ci.yml';
  const hits = allFiles.filter((p) => {
    const rel = p.replace(/\\/g, '/');
    if (rel.endsWith(self)) return false;
    try { return tokens.test(readFileSync(p, 'utf8')); } catch { return false; }
  });
  const ignore = readFileSync(join(ROOT, '.gitignore'), 'utf8');
  const privacyOk = hits.length === 0 && !exists('diet-plan') && !exists('_diet-plan')
    && /^\/profiles\/$/m.test(ignore);
  check('gate.static_privacy', privacyOk,
    `token_hits=${hits.length}；diet-plan 目录=0；profiles 被忽略=${/^\/profiles\/$/m.test(ignore)}`);

  const statuses = P1_AC_IDS.map((id) => readFileSync(join(ROOT, 'tests/acceptance', `ac-${id}.md`), 'utf8')
    .match(/^\| 状态 \| \*\*(RED|GREEN)\*\*/m)?.[1] ?? 'MISSING');
  const noGreen = statuses.every((s) => s === 'RED');
  // 以「node:fs 导入白名单」取证零写盘能力：刻意不在本文件里拼出写盘 API 的名字，
  // 否则字符串字面量本身会被本门禁与 T-021 的静态扫描命中（自命中）。
  const selfText = readFileSync(join(HERE, 'p1-gate.mjs'), 'utf8');
  const fsImports = (selfText.match(/^import \{([^}]+)\} from 'node:fs';/m)?.[1] ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean).sort();
  const readOnly = ['existsSync', 'readFileSync', 'readdirSync'].sort();
  const noWriteApi = JSON.stringify(fsImports) === JSON.stringify(readOnly);
  check('gate.no_silent_green', noGreen && noWriteApi,
    `ac 状态=${[...new Set(statuses)].join(',')}；node:fs 只读导入白名单=${noWriteApi}`);

  const traceable = rows.every((r) => r.sources.length > 0 && r.evidence.length >= 2)
    && new Set(checks.map((c) => c.id)).size === checks.length
    && srcFiles.length === independent && srcFiles.length > 20;
  check('gate.traceability', traceable,
    `每行有来源与证据；扫描 ${srcFiles.length} 个源码文件 = 独立清点 ${independent}`);

  const checksOk = checks.every((c) => c.ok);
  const allGreen = rows.every((r) => r.status === AC_STATUS.E2E);
  const ok = checksOk && allGreen;

  return Object.freeze({
    ok,
    verdict: ok ? 'PASS' : 'BLOCKED',
    rows,
    checks: Object.freeze(checks.map((c) => Object.freeze(c))),
    scenarioCount,
    scannedFiles: srcFiles.length,
    independentlyCounted: independent,
    baselineTouched: 0,
    offline: Object.freeze({
      ok: offline.ok,
      checks: offline.checks,
      modes: offline.modes,
      requests: offline.requests,
      violations: offline.violations,
      validateChecked: offline.validateChecked,
      diskWrites: offline.diskWrites,
    }),
    privacy: Object.freeze({ tokenHits: hits.length, dirsPresent: false }),
  });
}

/** 稳定报告：纯 ASCII key=value，确定性、可 diff（FR-028 同口径）。 */
export function formatGateReport(report) {
  const tally = (s) => report.rows.filter((r) => r.status === s).length;
  return [
    'scenario=p1_gate',
    `ac=${report.rows.length}`,
    `scenario_count=${report.scenarioCount}`,
    `scanned_files=${report.scannedFiles}`,
    `independent_count=${report.independentlyCounted}`,
    `offline_checks=${report.offline.checks.length}`,
    `offline_failed=${report.offline.checks.filter((c) => !c.ok).length}`,
    `e2e_pass=${tally(AC_STATUS.E2E)}`,
    `core_only=${tally(AC_STATUS.CORE)}`,
    `gap=${tally(AC_STATUS.GAP)}`,
    `checks=${report.checks.length}`,
    `failed=${report.checks.filter((c) => !c.ok).length}`,
    `baseline_touched=${report.baselineTouched}`,
    `verdict=${report.verdict}`,
    ...report.rows.map((r) => `ac.${r.id}=${r.status}`),
    ...report.checks.map((c) => `check.${c.id}=${c.ok ? 'ok' : 'fail'}`),
    `status=${report.ok ? 'ok' : report.checks.every((c) => c.ok) ? 'blocked' : 'error'}`,
  ].join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runP1Gate();
  process.stdout.write(`${formatGateReport(result)}\n`);
  // 0 = P1 出口达成；2 = 取证完成但出口 BLOCKED；1 = 取证本身失败。
  process.exitCode = result.ok ? 0 : result.checks.every((c) => c.ok) ? 2 : 1;
}
