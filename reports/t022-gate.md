# T-022 · Phase 1 出口门禁报告

> [AIGC] 本文件由 AI 依据 `SPEC.md v0.4.0-draft §8 / §17`、`tasks.md T-022`、`plan.md §10 §11 §12`、`constitution.md §3 §5` 生成 ·
> 审计追踪 ID：`RR-T022-20261108-0001` · **待人工审查（P-10）**

**结论：`BLOCKED` —— P1 出口尚未达成，本任务不把任何 `ac-*.md` 状态改为 GREEN，不把 `tasks.md` 的 `- [ ]` 改为 `- [x]`。**

这不是取证失败：六项门禁本身全部通过，失败的是「AC-01～12 全部转绿」这一出口条件。按 P-02 / P-09 / RK-03，不得靠删除、跳过或弱化场景换绿；按 P-10 / `constitution.md §3.1(5)`，`[AIGC]` 基线状态变更须经人工审查。因此本报告把「转绿」作为**待裁决动作**交付，而非擅自执行。

---

## 1. 六项门禁实测（2026-11-08 · macOS / Node v22.22.2）

| # | 门禁 | 命令 | 结果 |
|---|---|---|---|
| 1 | 规格一致性 | `npm run spec-check` | **PASS** · 编号连续、追溯矩阵无孤儿、澄清标记 0、规格不含实现关键字 |
| 2 | 单元测试与覆盖率 | `node scripts/coverage.mjs --json` | **PASS** · `npm test` **323/323**；line **94.16%** / branch **84.09%** / function **98.71%**，三列均 ≥80（SC-002） |
| 3 | lint | `npm run lint` | **PASS** · 10/10 项，98 个源码文件；SPDX、语法、架构边界、命名、第三方依赖、JSDoc 契约、动态求值、只读白名单 |
| 4 | 类型检查 | `npm run lint` 的 `typeCheckNote` | **PARTIAL / 待裁决** · `plan.md §11` 要求 `tsc --checkJs --noEmit`，需外部 TypeScript 工具链，与零第三方依赖冲突；现以 `node --check` + JSDoc 契约静态校验替代，**不等价**，见 §6 |
| 5 | 隐私扫描 | `node scripts/lint.mjs --json` / `p1-gate` 的 `gate.static_privacy` / CI 内联扫描器 | **PASS** · 真实数据令牌 0 命中、`diet-plan` 目录 0、`profiles/` 被忽略、门禁与离线用例只读 |
| 6 | 三 OS × 三 Node 矩阵 | 本地模拟 | **1/9 可实测** · 本机仅 macOS / Node 22；其余 8 组需 CI 实跑，见 §6 |
| 7 | 验收场景红→绿 | `npm run acceptance` / `node tests/acceptance/gates/p1-gate.mjs` | **BLOCKED** · 19/19 RED · 0 GREEN；P1 门禁 `e2e_pass=2 / core_only=7 / gap=3`、`verdict=BLOCKED`（exit 2） |

`node tests/acceptance/gates/p1-gate.mjs` 的稳定报告（`status=blocked` 收尾）：

```text
scenario=p1_gate  ac=12  scenario_count=12  scanned_files=98  independent_count=98
offline_checks=14  offline_failed=0  e2e_pass=2  core_only=7  gap=3
checks=6  failed=0  baseline_touched=0  verdict=BLOCKED  status=blocked
```

**防假绿取证**：12 条场景文本实时从 `SPEC.md §8` 提取并逐字比对；门禁 ID 唯一、`verdict` 恒等于「12 条全 `E2E_PASS` 且六项门禁全过」；静态扫描文件数与**另一种独立遍历实现**的清点结果逐项比对（98 = 98）；每条非端到端通过的 AC 必须给出具体缺口；每条端到端通过的 AC 必须给出 ≥2 项可复算证据。

---

## 2. AC-01～12 逐条取证

| AC | 结论 | 可复算证据 | 缺口 |
|---|---|---|---|
| **01** 处方推导与 BMR 护栏 | **E2E_PASS** | 日计划 `rr-data`：`energy=1600..1670`（落在 1550–1700 且 ≥ 1450）、`protein=91..97.5`（88–100）、`salt.max=4.5`（<5）、`oil=25..30`、`sugar.max=20`（<25）、`guideline_id=generic-guideline` | — |
| **02** 五级周期与首日口径 | CORE_ONLY | 五级计划全部 `exit=0`；`plan.test.js` 覆盖 1/1 三层与周一产当周 | 两处固定日期场景（2026-01-01 三层合并视图、2026-11-02 周任务）只在 T-013 单测层取证，未用固定时钟在 CLI 端到端复跑；当前装配时钟固定 2026-11-06 |
| **03** 日级次日口径 | **GAP** | `period_id=2026-11-07`、`file=plans/2026-11-07.md`、`trigger=plan.trigger.daily_2000` | `sections.count=0`：无早/午/晚/加餐生重克数、做法要点、四餐热量与蛋白、全天合计；食材内容依赖 T-035 数据源（P2），P1 核心域按定案零内置食材表 |
| **04** 节气下载与失败回退 | CORE_ONLY | `calendar.test.js` 覆盖 24 条解析、≥2 独立来源、FALLBACK、URL 静态约束 | SPEC 写 `_data/solar-terms-2027.md`，实现默认 `data/calendar/`（T-014 已登记待裁决张力）；2027 联网刷新与双源一致校验在离线门禁下不可端到端复跑 |
| **05** 居住地变更重算 | **GAP** | `recalc.test.js` 覆盖未来切分与版本检测 | T-012 定案「**不重算计划正文**」：计划不会采用新城市的气候 / 时令 / 饮水量 / 采购渠道；区域映射归 T-033（P2） |
| **06** 身体数据变更重算 | **GAP** | `recalc.test.js` 覆盖「仅未来写 + 历史文件哈希不变」（SC-006 部分） | 「热量 / 蛋白按新数据重算」需重算正文，T-012 按定案不重算；时间线护栏不能替代整条场景 |
| **07** 短期去重 | CORE_ONLY | `dedup.test.js` 覆盖组合不重复、台账只追加、历史字节不变 | 去重结果未接入 `rr plan` 端到端正文（`sections.count=0`），无「第 7 天组合」可观察产物 |
| **08** 周期性重复允许 | CORE_ONLY | `dedup.test.js` 覆盖跨年 `cycle_key` 复用与同周主菜互斥 | 未在「今年立冬生成计划」的年度端到端场景复跑 |
| **09** 采购两栏与剩余窗口 | CORE_ONLY | `purchase.test.js` 覆盖 `theoretical` 7 天 / `actual` 仅未来、分批、`price_bands` | 周计划正文未接两栏；储存方式、缺货替换、居住地渠道、备餐建议依赖 T-035 / T-033（P2） |
| **10** A 类即时修订与留痕 | CORE_ONLY | `feedback.test.js` 覆盖双源取证、精确单行替换、台账状态、`rule-NNNN` | 「上级矛盾 → 下级生成时发现」的端到端链路未取证 |
| **11** D 类下发与时间线护栏 | CORE_ONLY | `feedback.test.js` 覆盖哈希不变、只写未来、D1/D2、`待对齐` | 未在 CLI 向下级联命令端到端复跑 |
| **12** 离线与隐私 | **E2E_PASS** | T-021 `runOfflineIntegration()` 14 条门禁全过；月/周/日三份成功、`requests=0`、`llm_calls=0`、`disk_writes=0`、隐私静态扫描通过 | — |

**取证分级口径（刻意从严）**：只有「从端到端产物可复算」才算 `E2E_PASS`；仅核心域单测可证、但未进入 CLI 产物的一律 `CORE_ONLY`；场景明确要求而实现尚不存在的正文能力一律 `GAP`。用纯函数单测冒充整条业务场景通过，属 P-09 禁止的弱化验收。

---

## 3. 红→绿记录（草案 · 未写入基线）

`tests/acceptance/ac-01.md` … `ac-12.md` 的「红→绿记录」表是 P0 已跟踪基线，本任务**一行未改**（`baseline_touched=0`）。按 P-10，写入须在人工审查本报告后进行。建议的裁决顺序：

| 优先级 | 动作 | 依据 |
|---|---|---|
| 可立即考虑 | AC-01 / AC-12 具备端到端取证，审查通过后可登记 GREEN | 本报告 §2 的可复算证据 + T-021 的 14 条门禁 |
| 需补取证 | AC-02 / 04 / 07 / 08 / 09 / 10 / 11 需补**固定时钟的端到端复跑**，把 `CORE_ONLY` 提升为 `E2E_PASS` | 可用 `createOfflineHarness` 的参数化时钟 / 装配扩展，不必然依赖 P2 |
| 需补实现 | AC-03 / 05 / 06 的正文能力在 P1 架构下不存在 | 见 §4 |

---

## 4. 结构性矛盾（本任务最核心的交付）

`tasks.md T-022` 要求「AC-01～12 全部转绿」，`SPEC.md §17` 要求「US-01～05 对应 FR 须通过全部 AC」；但 P1 的任务分解与架构定案使三条场景无法在 P1 内满足：

1. **AC-03**：`SPEC §8` 要求日计划含四餐生重克数 / 做法要点 / 全天合计。T-016 按定案「核心域零内置食材表」，食材数据由 **T-035 数据源适配器（P2）** 提供；T-018 的 `sections` 可选结构化表在 T-019 未接入 `rr plan`，因此五级计划正文实测 `sections.count=0`。
2. **AC-05 / AC-06**：`SPEC §8` 要求「按新居住地 / 新身体数据重算计划正文」。T-012 明确定案「**不重算计划正文**」（`src/core/planner/README.md`），只做未来文件切分与哈希复验；区域映射归 **T-033（P2）**。
3. **AC-04 / AC-09**：缓存路径 `_data/` vs `data/calendar/`、两栏采购的渠道与储存信息，分别卡在 T-014 已登记的规格张力与 P2 数据源上。

**结论**：这不是审查器口径滞后，也不是探针 MISS，而是「M3 出口条件」与「P1 任务边界」之间的规格级张力。按 `constitution.md §4`，原则与规格冲突须由用户裁决，**AI 不得静默改规格、不得自行豁免**。

### 请裁决（四选一）

| 选项 | 内容 | 代价 |
|---|---|---|
| **A** | 维持 M3 出口条件不变，把「计划正文重生成接线 + 四餐/采购结构化表 + 固定时钟端到端复跑」纳入 P1 新增任务，食材内容仍由 T-035 提供 | 需改 `tasks.md` / 可能改 `SPEC.md`，按 P-01 走规格变更流程；P1 出口延后 |
| **B** | 修订 M3 出口条件：把「AC-01～12 全绿」改为「核心域可执行断言全绿 + 端到端链路取证齐备」，把三条正文场景的转绿移到 P2/P3 | 需用户书面确认并递增版本（`constitution.md §4`），同步 `SPEC.md §17` / `plan.md §12` / `CHANGELOG.md` |
| **C** | 人工审查后先只把 AC-01 / AC-12 登记 GREEN，其余保持 RED，明确记为「P1 部分出口」 | 需用户明确「部分出口」是否算 M3 达成；`tasks.md` 勾选规则同步 |
| **D** | 维持 `BLOCKED`，P1 不出口；T-022 作为体检报告基线化，P2 完成后回头补转绿 | 最保守，零规格改动；但 `tasks.md §2` 的阶段依赖图需记录 M3 未出口 |

AI 建议 **A 或 D**（都不需要降低验收强度）；**B / C 涉及降低或拆分出口条件，须用户明确书面裁决**。在裁决前，本任务停在 T-022 审查点，不推进 T-030。

---

## 5. CI 接入草案（**未落地**，保持 P0 基线零改动）

`.github/workflows/ci.yml` 是 P0 已跟踪基线，且其中的 `const TOKENS = /.../;` 是 T-021 动态提取的**唯一权威规则**。按 P-10，CI 变更应在人工审查后单独授权。建议的最小 diff（保持 TOKENS 行字节不变）：

| Job | 建议追加 | 说明 |
|---|---|---|
| `unit` | `node scripts/coverage.mjs` | 启用 SC-002 的 ≥80% 门禁；Node 20 自动退化为全仓口径并显式标注 |
| `lint-typecheck` | 把内联骨架检查替换为 `npm run lint` | 10 项检查严格覆盖原 SPDX / 命名护栏，并新增架构边界与 JSDoc 契约 |
| `acceptance` | 追加 `node tests/acceptance/gates/p1-gate.mjs` | **注意：当前返回 exit 2（`BLOCKED`）**，接入即 CI 红 —— 这是如实反映 P1 未出口，不应回避 |
| `privacy-scan` | 保持内联扫描器不变 | 现有 TOKENS 规则已是唯一权威 |
| `matrix` | 追加 `node scripts/coverage.mjs` 与 `node tests/acceptance/gates/p1-gate.mjs` | 使 9 个组合跑同一组门禁，满足「结果一致」 |

**在 §4 裁决为 A / B / C 之前，不建议接入 `acceptance` / `matrix` 的门禁命令**：那会让 CI 长期红，反而掩盖真实回归。

---

## 6. 规格张力登记（本任务新发现 / 沿用）

| # | 张力 | 现状 | 处置 |
|---|---|---|---|
| T-022-A | `plan.md §11` 的 `tsc --checkJs --noEmit` vs 零第三方依赖 | 以 `node --check` + JSDoc 契约静态校验替代，**不等价** | 待人工裁决；本报告**不把「类型检查通过」记为已达成** |
| T-022-B | T-022 要求三 OS × 三 Node 矩阵一致 vs 本机仅 1 组 | 本地模拟 1/9；门禁源码零 OS 特定 API（`node:path` / 无 shell） | 其余 8 组需 CI 实跑 |
| T-014 沿用 | 缓存路径 `_data/` vs `data/calendar/` | `ctx.cachePath` 兼容，默认后者 | 待人工裁决（T-014 README 已登记） |
| T-014 沿用 | FR-013 内置近似表 vs FR-012 禁止内置 | 保守解：不内置 / 沿用旧缓存 / 空时令集 / 零写入 | 待人工裁决 |

---

## 7. 校验记录

| 项 | 结果 |
|---|---|
| 先红证据（P-02） | 实现前 `npm test` = **302 tests / 301 pass / 1 fail**（`ERR_MODULE_NOT_FOUND: p1-gate.mjs`） |
| `node --test tests/unit/p1-gate.test.js` | **16 / 16** |
| `node --test tests/unit/toolchain.test.js` | **6 / 6** |
| `npm test`（全量） | **323 / 323** |
| `node scripts/coverage.mjs` | PASS · 94.16 / 84.09 / 98.71 ≥ 80 |
| `npm run lint` | PASS · 10/10 |
| `npm run spec-check` | PASS |
| `npm run acceptance` | **19/19 RED · 0 GREEN**（基线完整，非验收通过） |
| `node tests/acceptance/gates/p1-gate.mjs` | `verdict=BLOCKED` · 14 条离线门禁全过 · 六项门禁全过 · exit 2 |
| 负向探针 `reviews/t022-negative.mjs` | **22 / 22 检出**、全部字节级还原、收尾 22/22（Round 14） |
| 工作树 | HEAD `4914e3d`（未 push）；暂存空；已跟踪 diff 仅 `src/io/index.js`(+1) / `ports.js`(+11) 零删除行；**98 个未跟踪文件**；`tasks.md` `0 [x]` / `39 [ ]` |
| P0 基线 | `tests/acceptance/ac-*.md` / `run.mjs` / `scripts/acceptance.mjs` / `ci.yml` / `SPEC.md` / `plan.md` / `constitution.md` / `tasks.md` **全部零改动** |

**先红阶段的一处真实发现**：新单测初版复制了真实数据令牌字面量，被 T-021 的 `privacy.static_scan` 正确判定为命中（连带 3 条 T-021 断言变红）。改为动态提取 `ci.yml` 的唯一权威规则后恢复。这证明跨任务静态门禁确实在起作用，而非空扫。

---

## 8. 边界

- **不改 `ac-*.md` 状态、不勾 `tasks.md`、不改任何 P0 已跟踪基线文件**：转绿属 P-10 的人工审查动作。
- **不删、不跳过、不弱化任何 AC 场景**：12 条场景文本与 `SPEC.md §8` 逐字一致（门禁实时比对）。
- `p1-gate.mjs` 零磁盘写入、零子进程、零第三方依赖；唯一外部取证是 T-021 的纯内存离线集成。
- 覆盖率 / lint / 门禁脚本均为**零依赖**：不跑 `npm install` / `npm ci`，不引入 c8 / nyc / istanbul / TypeScript。
- 语言包（`locales/`，T-031）、区域策略（`src/core/locale/`，T-032）、数据源（T-035）属 P2，本报告一律不预置。
- 仓库内不生成 `plans/` / `_exports/` / `logs/` 等运行期产物。
- **停在 T-022 审查点**；§4 裁决前不推进 T-030，也不把 P1 记为已出口。
