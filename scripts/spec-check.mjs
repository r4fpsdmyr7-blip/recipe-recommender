// SPDX-License-Identifier: GPL-3.0-only
// [AIGC] T-005 规格一致性检查 · 审计追踪 ID: RR-T005-20261107-0001 · 待人工审查（P-10）
//
// 检查项（tasks.md T-005 / FR-038 / SC-001 / P-01, P-03, P-04, P-09）：
//   1. FR / NFR / AC / SC / P 编号连续、无缺口、无重复
//   2. 追溯矩阵无孤儿：SPEC.md §16 与 tasks.md §4 全覆盖
//   3. [NEEDS CLARIFICATION] = 0（真实标记形态：带冒号或后跟编号；仅当名词引用的元描述不计）
//   4. 规格需求正文（§6 / §8 / §12）不得出现实现关键字（P-04）
//
// 只读取、不写入、不修改任何规格文件（P-01：规格变更须串行且先于实现）。
// 支持 --spec <path> / --tasks <path> 指向副本，便于负向测试而不碰真实文件。

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const AUDIT = 'RR-T005-20261107-0001';

/** 真实未决标记；把 `[NEEDS CLARIFICATION]` 当名词引用（如「计数=0」「将作为…项」）不计。 */
const REAL_CLARIFICATION = /\[NEEDS CLARIFICATION:[^\]]*\]|\[NEEDS CLARIFICATION\]\s*(?:CL|FR|AC|SC|P|US|E|A)-\d/;
/** 规格需求正文不得出现实现技术栈（P-04）；§14 决策记录 / ADR 不在此检查范围。 */
const IMPL_WORDS = ['package.json', 'node_modules', 'npm install', 'npm run', 'JavaScript',
  'TypeScript', 'ECMAScript', 'require(', 'import ', 'class ', 'express', 'React',
  'sqlite', 'Docker', 'Kubernetes', 'node --test', '.mjs', '.tsx'];

function arg(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? resolve(argv[i + 1]) : fallback;
}

/** 按 `## N.` 切分章节。 */
function sections(text) {
  const heads = [...text.matchAll(/^## (\d+)\. .+$/gm)];
  const out = new Map();
  heads.forEach((h, i) => {
    const end = i + 1 < heads.length ? heads[i + 1].index : text.length;
    out.set(Number(h[1]), text.slice(h.index, end));
  });
  return out;
}

/** 展开单元格内的编号，兼容 `FR-040～FR-044`、`FR-040~44`、`AC-12～19` 与逗号列表。 */
function ids(cell, kind) {
  const width = (kind === 'AC' || kind === 'P') ? 2 : 3;
  const pad = (n) => `${kind}-${String(n).padStart(width, '0')}`;
  let s = cell;
  // (?<![A-Z]) 防止 `NFR-015` 被 `FR-(\d+)` 误匹配
  s = s.replace(new RegExp(`(?<![A-Z])${kind}-(\\d{2,3})\\s*[～~]\\s*${kind}-(\\d{2,3})`, 'g'),
    (_, a, b) => Array.from({ length: Number(b) - Number(a) + 1 }, (__, i) => pad(Number(a) + i)).join(','));
  s = s.replace(new RegExp(`(?<![A-Z])${kind}-(\\d{2,3})\\s*[～~]\\s*(\\d{2,3})(?!\\d)`, 'g'),
    (_, a, b) => Array.from({ length: Number(b) - Number(a) + 1 }, (__, i) => pad(Number(a) + i)).join(','));
  const set = new Set();
  const re = new RegExp(`(?<![A-Z])${kind}-(\\d{2,3})`, 'g');
  let m;
  while ((m = re.exec(s))) set.add(Number(m[1]));
  return set;
}

function definitions(sec) {
  return {
    FR: [...(sec.get(6) || '').matchAll(/^\| (FR-\d{3}) \|/gm)].map((m) => Number(m[1].slice(3))),
    NFR: [...(sec.get(7) || '').matchAll(/^\| (NFR-\d{3}) \|/gm)].map((m) => Number(m[1].slice(4))),
    AC: [...(sec.get(8) || '').matchAll(/^### AC-(\d{2}) ·/gm)].map((m) => Number(m[1])),
    P: [...(sec.get(11) || '').matchAll(/^\| (P-\d{2}) \|/gm)].map((m) => Number(m[1].slice(2))),
    SC: [...(sec.get(12) || '').matchAll(/^\| (SC-\d{3}) \|/gm)].map((m) => Number(m[1].slice(3))),
  };
}

function mdFiles(dir, base = '') {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules') continue;
    const p = join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    if (statSync(p).isDirectory()) out.push(...mdFiles(p, rel));
    else if (name.endsWith('.md')) out.push(rel);
  }
  return out;
}

export function check(specPath, tasksPath, root = ROOT) {
  const specText = readFileSync(specPath, 'utf8');
  const tasksText = readFileSync(tasksPath, 'utf8');
  const sec = sections(specText);
  const defs = definitions(sec);
  const problems = [];
  const lines = [];

  // ---- 1. 编号连续 ----
  lines.push('1. 编号连续性（定义处：§6 FR / §7 NFR / §8 AC / §11 P / §12 SC）');
  for (const [kind, nums] of Object.entries(defs)) {
    const uniq = [...new Set(nums)].sort((a, b) => a - b);
    const missing = [];
    for (let i = 1; i <= (uniq.at(-1) ?? 0); i++) if (!uniq.includes(i)) missing.push(i);
    const dup = nums.length - uniq.length;
    const ok = uniq.length > 0 && uniq[0] === 1 && missing.length === 0 && dup === 0;
    const w = (kind === 'AC' || kind === 'P') ? 2 : 3;
    const fmt = (n) => String(n).padStart(w, '0');
    lines.push(`   ${kind.padEnd(4)} ${String(uniq.length).padStart(2)} 条  ${fmt(1)}–${fmt(uniq.at(-1) ?? 0)}  ${ok ? 'PASS' : 'FAIL'}`);
    if (!ok) problems.push(`${kind} 编号不连续：缺口 ${missing.join(',') || '无'}，重复 ${dup}，首号 ${uniq[0]}`);
  }

  // ---- 2. 追溯矩阵无孤儿 ----
  lines.push('2. 追溯矩阵无孤儿');
  const f16 = new Set(), a16 = new Set(), s16 = new Set(), n16 = new Set();
  const rows16 = [...(sec.get(16) || '').matchAll(/^\| (.+?) \| (.+?) \| (.+?) \| .+ \|$/gm)]
    .filter((m) => /(FR|NFR)-\d/.test(m[1]));
  for (const r of rows16) {
    const fr = ids(r[1], 'FR'), nfr = ids(r[1], 'NFR'), ac = ids(r[2], 'AC'), sc = ids(r[3], 'SC');
    if (!ac.size) problems.push(`§16 行无 AC：${r[1]}`);
    if (!sc.size) problems.push(`§16 行无 SC：${r[1]}`);
    for (const n of fr) f16.add(n);
    for (const n of nfr) n16.add(n);
    for (const n of ac) a16.add(n);
    for (const n of sc) s16.add(n);
  }
  const orphans = (defined, referenced, kind) => defined.filter((n) => !referenced.has(n)).map((n) => `${kind}-${String(n).padStart(kind === 'AC' ? 2 : 3, '0')}`);
  const o16 = {
    FR: orphans(defs.FR, f16, 'FR'), AC: orphans(defs.AC, a16, 'AC'),
    SC: orphans(defs.SC, s16, 'SC'), NFR: orphans(defs.NFR, n16, 'NFR'),
  };
  const badRefs = [...f16].filter((n) => n > Math.max(...defs.FR, 0))
    .concat([...a16].filter((n) => n > Math.max(...defs.AC, 0)))
    .concat([...s16].filter((n) => n > Math.max(...defs.SC, 0)));
  lines.push(`   SPEC.md §16：${rows16.length} 行 · FR ${f16.size}/${defs.FR.length} · AC ${a16.size}/${defs.AC.length} · SC ${s16.size}/${defs.SC.length} · NFR ${n16.size}/${defs.NFR.length}`);
  for (const [k, v] of Object.entries(o16)) if (v.length) problems.push(`§16 孤儿 ${k}：${v.join(', ')}`);
  if (badRefs.length) problems.push(`§16 引用了不存在的编号：${badRefs.join(', ')}`);

  // §4 三张表分别校验：4.1 FR 覆盖、4.2 AC 主责任务、4.3 SC 签署任务（HANDOFF §6）
  const start4 = tasksText.indexOf('## 4. 追溯矩阵');
  const end4 = tasksText.indexOf('## 5.', start4);
  const sec4 = start4 >= 0 ? tasksText.slice(start4, end4 > 0 ? end4 : tasksText.length) : '';
  const sub4 = (n) => {
    const a = sec4.indexOf(`### 4.${n}`);
    const b = sec4.indexOf('### 4.', a + 1);
    return a >= 0 ? sec4.slice(a, b > 0 ? b : sec4.length) : '';
  };
  const t4 = {};
  for (const [kind, n] of [['FR', 1], ['AC', 2], ['SC', 3]]) {
    const rows = sub4(n).split('\n').filter((l) => /^\|/.test(l) && /(FR|AC|SC|NFR)-\d/.test(l));
    const set = new Set();
    for (const l of rows) {
      for (const x of ids(l, kind)) set.add(x);
      if (!/T-\d{3}/.test(l)) problems.push(`tasks.md §4.${n} 行缺主责任务：${l.trim().slice(0, 70)}`);
    }
    t4[kind] = set;
  }
  const o4 = { FR: orphans(defs.FR, t4.FR, 'FR'), AC: orphans(defs.AC, t4.AC, 'AC'), SC: orphans(defs.SC, t4.SC, 'SC') };
  lines.push(`   tasks.md §4.1/4.2/4.3：FR ${t4.FR.size}/${defs.FR.length} · AC ${t4.AC.size}/${defs.AC.length} · SC ${t4.SC.size}/${defs.SC.length}`);
  for (const [k, v] of Object.entries(o4)) if (v.length) problems.push(`tasks.md §4.${k === 'FR' ? 1 : k === 'AC' ? 2 : 3} 孤儿 ${k}：${v.join(', ')}`);

  // ---- 3. 澄清标记 ----
  lines.push('3. [NEEDS CLARIFICATION] = 0');
  const docs = [['SPEC.md', specText]];
  for (const rel of mdFiles(root)) {
    if (rel === 'SPEC.md') continue;
    docs.push([rel, readFileSync(join(root, rel), 'utf8')]);
  }
  let quoted = 0;
  const real = [];
  for (const [name, text] of docs) {
    text.split('\n').forEach((l, i) => {
      if (!l.includes('[NEEDS CLARIFICATION')) return;
      if (REAL_CLARIFICATION.test(l)) real.push(`${name}:${i + 1} ${l.trim().slice(0, 90)}`);
      else quoted++;
    });
  }
  lines.push(`   扫描 ${docs.length} 份 md · 名词引用/元描述 ${quoted} 处 · 真实未决标记 ${real.length} 处  ${real.length === 0 ? 'PASS' : 'FAIL'}`);
  for (const r of real) problems.push(`未关闭澄清标记：${r}`);

  // ---- 4. 规格不含实现关键字 ----
  lines.push('4. 规格需求正文不含实现关键字（P-04，仅 §6 / §8 / §12）');
  const hits = [];
  for (const n of [6, 8, 12]) {
    (sec.get(n) || '').split('\n').forEach((l, i) => {
      const found = IMPL_WORDS.filter((w) => l.toLowerCase().includes(w.toLowerCase()));
      if (found.length) hits.push(`§${n} 行 ${i + 1}：${found.join(', ')} → ${l.trim().slice(0, 70)}`);
    });
  }
  lines.push(`   命中 ${hits.length} 处  ${hits.length === 0 ? 'PASS' : 'FAIL'}`);
  for (const h of hits) problems.push(`规格含实现关键字：${h}`);

  return { problems, lines };
}

export function run(argv = process.argv.slice(2)) {
  const specPath = arg(argv, '--spec', join(ROOT, 'SPEC.md'));
  const tasksPath = arg(argv, '--tasks', join(ROOT, 'tasks.md'));
  let result;
  try {
    result = check(specPath, tasksPath);
  } catch (e) {
    console.error(`[AIGC] ${AUDIT} · 检查无法执行：${e.message}`);
    return 1;
  }
  console.log(`[AIGC] ${AUDIT} · 规格一致性检查（FR-038 / SC-001 / P-01,03,04,09）`);
  console.log(`对象：${specPath} · ${tasksPath}`);
  console.log('');
  for (const l of result.lines) console.log(l);
  console.log('');
  if (result.problems.length) {
    console.log(`结果：FAIL（${result.problems.length} 项）`);
    for (const p of result.problems) console.error('  x ' + p);
    return 1;
  }
  console.log('结果：PASS · 编号连续、追溯矩阵无孤儿、澄清标记为 0、规格不含实现关键字');
  return 0;
}

process.exitCode = await run();
