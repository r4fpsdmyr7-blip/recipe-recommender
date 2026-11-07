// SPDX-License-Identifier: GPL-3.0-only
// [AIGC] T-004 验收驱动 · 审计追踪 ID: RR-T004-20261107-0001 · 待人工审查（P-10）
//
// P0 出口后（P1 进行中）：本驱动只校验「AC 红态基线完整性」，不执行业务断言。
// 19 条 AC 全部 RED 是 P0 出口门禁的预期状态，进入 P1 后仍保持全红；exit 0 仅代表基线完整有效，
// 不代表验收通过（P-02 / AC-14）。断言由 T-010 起的实现任务提供，逐条红→绿。
//
// 场景文本以 SPEC.md §8 为唯一权威，运行时实时提取并与 ac-XX.md 逐字比对，
// 任何删改、跳过或弱化都会被判定为基线异常（P-09 / RK-03）。

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const AUDIT = 'RR-T004-20261107-0001';
const SCENARIO_RE = /^```gherkin\r?\n([\s\S]*?)^```[ \t]*$/m;

function norm(s) {
  return s == null ? null : s.replace(/\r\n/g, '\n').trim();
}

/** 从 SPEC.md §8 实时提取 19 条 AC 的场景文本（唯一权威）。 */
function specScenarios() {
  const text = readFileSync(join(ROOT, 'SPEC.md'), 'utf8');
  const heads = [...text.matchAll(/^## \d+\. .+$/gm)];
  const i = heads.findIndex((h) => h[0].startsWith('## 8.'));
  if (i < 0) throw new Error('SPEC.md 未找到 §8 验收场景章节');
  const end = i + 1 < heads.length ? heads[i + 1].index : text.length;
  const sec = text.slice(heads[i].index, end);
  const titles = [...sec.matchAll(/^### (AC-\d{2}) · (.+)$/gm)];
  const parts = sec.split(/^### AC-\d{2} · .+$/m).slice(1);
  const out = new Map();
  titles.forEach((t, k) => {
    const m = (parts[k] || '').match(SCENARIO_RE);
    out.set(t[1], { title: t[2], scenario: norm(m ? m[1] : null) });
  });
  return out;
}

/** 读取单条红态基线登记。 */
function baseline(nn) {
  const p = join(ROOT, 'tests/acceptance', `ac-${nn}.md`);
  if (!existsSync(p)) return { missing: true };
  const text = readFileSync(p, 'utf8');
  const status = text.match(/^\| 状态 \| \*\*(RED|GREEN)\*\*/m)?.[1] ?? null;
  const snap = text.match(/^\| 快照位 \| `([^`]+)`/m)?.[1] ?? null;
  const m = text.match(SCENARIO_RE);
  return { status, snap, scenario: norm(m ? m[1] : null), text };
}

/**
 * 校验红态基线，返回进程退出码。
 * 用法：run(['--ac','all']) / run(['--ac','01']) / run(['--ac','all','--allow-green'])
 */
export function run(args = []) {
  const eq = args.find((a) => a.startsWith('--ac='));
  const arg = eq ? eq.slice('--ac='.length) : (args.includes('--ac') ? args[args.indexOf('--ac') + 1] : 'all');
  const allowGreen = args.includes('--allow-green');
  const wanted = arg === 'all'
    ? Array.from({ length: 19 }, (_, k) => String(k + 1).padStart(2, '0'))
    : [String(arg).padStart(2, '0')];

  const spec = specScenarios();
  const problems = [];
  const rows = [];

  for (const nn of wanted) {
    const ac = `AC-${nn}`;
    const s = spec.get(ac);
    const b = baseline(nn);
    const issue = [];
    if (!s || !s.scenario) issue.push('SPEC.md §8 中无此 AC 的场景');
    if (b.missing) {
      issue.push('基线文件 ac-' + nn + '.md 缺失');
    } else {
      if (b.status !== 'RED' && b.status !== 'GREEN') issue.push('状态字段缺失或非法（应为 RED / GREEN）');
      if (!allowGreen && b.status === 'GREEN') issue.push('P0 阶段出现 GREEN；红→绿须由实现任务按 P-02 执行');
      if (s && b.scenario !== s.scenario) issue.push('场景文本与 SPEC.md §8 不一致（疑似删改 / 跳过 / 弱化）');
      if (!b.snap) issue.push('快照位未登记');
      else if (!existsSync(join(ROOT, b.snap))) issue.push('快照位文件不存在: ' + b.snap);
      if (!/## 红→绿记录/.test(b.text)) issue.push('缺少红→绿记录表');
      if (/^\|\s*SKIP\b|skip\s*=\s*true/im.test(b.text)) issue.push('出现跳过标记');
    }
    if (issue.length) problems.push(`${ac}: ${issue.join('；')}`);
    rows.push({
      ac,
      status: b.status ?? 'MISSING',
      scen: s && !b.missing && b.scenario === s.scenario ? 'OK' : 'FAIL',
      snap: !b.missing && b.snap && existsSync(join(ROOT, b.snap)) ? 'OK' : 'FAIL',
    });
  }

  console.log(`[AIGC] ${AUDIT} · AC 红态基线校验`);
  console.log('提示：本命令只校验基线完整性，不执行业务断言。');
  console.log('');
  console.log('AC      状态    场景比对  快照位');
  for (const r of rows) {
    console.log(`${r.ac.padEnd(8)}${r.status.padEnd(8)}${r.scen.padEnd(10)}${r.snap}`);
  }
  const red = rows.filter((r) => r.status === 'RED').length;
  const green = rows.filter((r) => r.status === 'GREEN').length;
  console.log('');
  console.log(`${red}/${rows.length} RED · ${green} GREEN · 红态基线${problems.length ? '异常' : '有效'}`);
  console.log('RED 为预期状态；exit 0 仅代表基线完整，不代表验收通过（P-02 / AC-14）。');
  if (problems.length) {
    for (const p of problems) console.error('  x ' + p);
    return 1;
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await run(process.argv.slice(2));
}
