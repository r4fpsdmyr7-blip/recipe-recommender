// SPDX-License-Identifier: GPL-3.0-only
// [AIGC] T-004 · package.json `acceptance` script 入口 · 审计追踪 ID: RR-T004-20261107-0001 · 待人工审查（P-10）
//
// 薄入口：实际逻辑在 tests/acceptance/run.mjs。
// 不得把驱动命名为 *.test.js —— npm test 用 node --test 自动发现，会误跑红态场景（tasks.md §2）。

import { run } from '../tests/acceptance/run.mjs';

process.exitCode = await run(process.argv.slice(2));
