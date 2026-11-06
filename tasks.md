# tasks.md · 任务分解（SDD · Tasks 阶段）

> **项目**：recipe-recommender　|　**版本**：`v1.0.0-draft`　|　**日期**：2026-11-06
> **状态**：✅ **已产出（M2）**，用户已授权推进；**M3 开工前须人工审查本清单**（P-10），审查通过后转 `v1.0.0`
> **上游**：[`SPEC.md`](SPEC.md) `v0.4.0-draft`、[`constitution.md`](constitution.md) `v1.0.0`、[`plan.md`](plan.md) `v1.0.0`、[`docs/decisions.md`](docs/decisions.md) ADR-002 / ADR-003
> **下游**：M3 Implement（代码 + 测试）→ M4（社区规范）→ M5 Converge + Release

---

## 1. 约定与读法

| 记号 | 含义 |
|------|------|
| `- [ ]` | 未完成；仅当「相关 AC 转绿 + CI 全绿 + `constitution.md §3` DoD 满足」后才可改为 `- [x]` |
| `[P]` | 可与同 Phase 内其他 `[P]` 任务并行：无相互依赖、不修改同一文件 |
| 依赖 | 前置任务 ID；`—` 表示仅依赖 Phase 0 出口（T-006） |
| 映射 | 该任务承载的 FR / AC / SC；MUST 级 FR 至少关联 1 条可执行 AC（SC-001） |
| 产出 | 相对仓库根的路径；`src/` 下模块划分以 `plan.md §4` 为准，不得擅自新增架构层 |

**四条硬约束**

1. **红→绿前置**：T-004 先把 AC-01～19 全部登记为失败（红）基线；任何任务开工前，其映射的 AC 必须仍为红（P-02 / AC-14）。禁止「先实现后补场景」。
2. **规格锚定**：行为变更先改 `SPEC.md` 与版本号，再改实现（P-01）；本清单不新增、不改写任何 FR / AC / SC 语义。
3. **不写实现**：M2 只拆任务。所有 `src/`、`tests/`、`locales/` 内容均在 M3/M4 产出。
4. **语言策略**：维持单一主实现语言；第二实现语言须过 ADR-003 G-01～G-06 门禁且 v1 默认关闭（A-10 / E-18 / P-16）。

---

## 2. 阶段总览

| Phase | 里程碑 | 目标 | 任务区间 | 出口门禁 |
|-------|--------|------|----------|----------|
| **P0** | M3 前置 | 工程骨架、确定性端口、AC 红态基线、规格一致性脚本、CI 骨架 | T-001～T-006 | T-006：CI 可运行且 AC 全红 |
| **P1** | **M3** | 核心域 + CLI + P1 用户故事（US-01～05） | T-010～T-022 | T-022：AC-01～12 转绿、覆盖率 ≥80%、CI 绿 |
| **P2** | **M4** | MCP Server、i18n 七语言、区域策略、LLM 降级、数据源适配器 | T-030～T-037 | T-037：AC-14～17 转绿 |
| **P3** | **M4** | 社区规范文件、合规文档、全量 CI 门禁与静态扫描 | T-040～T-046 | T-046：§10 必需文件齐备、AC-13/18/19 转绿 |
| **P4** | **M5** | Converge 报告、追溯矩阵核验、Release 归档 | T-050～T-054 | T-051/052：SC-001～015 全部达成 |

> 里程碑出口条件以 `SPEC.md §17` / `plan.md §12` 为准，本表不重写。

### 阶段依赖图

```mermaid
flowchart LR
    P0["P0 骨架与红态基线"] --> P1["P1 核心域 · M3"]
    P1 --> P2["P2 适配层与 i18n · M4"]
    P2 --> P3["P3 社区规范 · M4"]
    P3 --> P4["P4 Converge · M5"]
    P0 --> P3
    P1 --> P3
```

> P0 完成后，P3 的文档类任务（T-040/T-041）可与 P1/P2 并行；P1 的验收结果也是 P3 静态扫描的输入。

---

## 3. 任务清单

### Phase 0 · 工程骨架与验收基线（M3 前置）

- [ ] **T-001** `[P]` 建立 `package.json`：纯 ESM（`"type": "module"`）、`engines.node >= 20`、开发期 `scripts`（test / lint / acceptance / spec-check）；**禁止** `publishConfig` / `files` / `bin` / `prepack` 等发布字段（`plan.md §2.2`）。
  - 依赖：`—`　｜　产出：`package.json`、`src/` 目录骨架　｜　映射：FR-052, NFR-004, NFR-014, AC-18, AC-19
- [ ] **T-002** `[P]` 实现确定性 IO 端口 `clock` / `fs` / `net` 及测试替身，使固定运行日期、下载失败、临时工作区可注入（`plan.md §3` / `§10`）。
  - 依赖：T-001　｜　产出：`src/io/`、`tests/fixtures/`　｜　映射：FR-028, AC-02, AC-03, AC-04, AC-06, AC-17
- [ ] **T-003** `[P]` 校验两份虚构 Profile 是合法最小实例，可直接用于 AC-01 / AC-15 / AC-16；补齐虚构性声明与 `fictional` 标记。
  - 依赖：T-001　｜　产出：`examples/profiles/*.json`、`examples/profiles/README.md`　｜　映射：FR-034, AC-01, AC-12, AC-18, SC-014
- [ ] **T-004** `[P]` 建立 AC-01～19 的可执行验收驱动，并把 **19 条全部登记为红态基线**（含快照位与红→绿状态记录）。
  - 依赖：T-002　｜　产出：`tests/acceptance/ac-01.md` … `ac-19.md` + 驱动、`tests/snapshots/`　｜　映射：AC-01～19, AC-14, SC-001, FR-038, P-02
- [ ] **T-005** `[P]` 规格一致性检查脚本：FR / AC / SC / NFR / P 编号连续、追溯矩阵无孤儿、`[NEEDS CLARIFICATION]` = 0、规格中出现实现关键字时报警。
  - 依赖：T-001　｜　产出：`scripts/spec-check.*`　｜　映射：FR-038, SC-001, P-01, P-03, P-04, P-09
- [ ] **T-006** 搭建 CI 骨架：`spec-consistency` / `lint-typecheck` / `unit` / `acceptance` / `privacy-scan` / `matrix`（`plan.md §11`）。此时 AC 全红为**预期状态**，不得为了让 CI 变绿而删除场景。
  - 依赖：T-002, T-004, T-005　｜　产出：`.github/workflows/ci.yml` 骨架　｜　映射：FR-038, SC-002, SC-008, NFR-004, NFR-005

### Phase 1 · 核心域与 CLI（M3，US-01～05）

- [ ] **T-010** `[P]` `loadProfile(path, fsPort)`：Profile 解析、schema 校验、四类版本号比对；缺 BMR / 体脂越界 / 能量下限 < BMR / 非法语言标签 / 非 ISO 3166-1 地区码一律拒绝（E-08）。
  - 依赖：T-002, T-003　｜　产出：`src/core/profile/`　｜　映射：FR-001, E-08, AC-01, AC-12, SC-014
- [ ] **T-011** `[P]` `computeRx(body, guidelineAdapter)` 与可插拔指南适配器接口：推导每日处方，强制总能量 ≥ BMR、蛋白 ≥ 保肌下限，输出指南对照表（不复制指南原文）。
  - 依赖：T-010　｜　产出：`src/core/rx/`、`src/core/guideline/`、`data/guideline/`　｜　映射：FR-002, FR-003, FR-032, AC-01, AC-16, SC-003
- [ ] **T-012** `detectVersionChanges(profile, planHeader)`：体测 / 处方 / 居住地 / 气候版本变更触发重算；**先按「计划日期 ≤ 运行日」切分**，历史文件逐字节不变，只改未来计划并写重算标注。
  - 依赖：T-010, T-011　｜　产出：`src/core/profile/` 版本检测、`src/core/planner/` 重算切分　｜　映射：FR-004, FR-005, FR-014, AC-05, AC-06, SC-006, P-05
- [ ] **T-013** 五级计划生成器 `planYear/planSeason/planMonth/planWeek/planDay`：新周期首日产出本周期、日级 20:00 产出次日、年/季/月三层合并调度 + `periodic-plan.md`、非首日补跑的执行窗口标注、计划头部五类版本与上承/下接。
  - 依赖：T-011, T-012, T-014　｜　产出：`src/core/planner/`、工作区 `periodic-plan.md`　｜　映射：FR-006, FR-007, FR-008, FR-009, FR-010, AC-02, AC-03, SC-002
- [ ] **T-014** `[P]` 历法适配器与 `refreshCalendarData(year, calendarAdapter, netPort)`：年计划时联网下载 24 节气精确交节时刻、≥2 源交叉校验、UTC+8 落盘缓存、下层只读、失败 `FALLBACK / 未校验` + 人工复核提示；通用季节历同等约束。
  - 依赖：T-002　｜　产出：`src/core/calendar/`、`src/io/net.*`、`data/calendar/solar-terms-YYYY.md`　｜　映射：FR-011, FR-012, FR-013, FR-048, AC-04, SC-005, NFR-001
- [ ] **T-015** `[P]` `applyDedup(candidate, ledger, window)` + 去重台账：最近 7 天「主菜+主食」不重复、7 天内主标识互斥、近 4 周重合 ≤2 道、允许节气/月份/年度周期性重复、台账只追加。
  - 依赖：T-010　｜　产出：`src/core/dedup/`、工作区 `history.md`　｜　映射：FR-015, FR-016, FR-017, FR-018, AC-07, AC-08, SC-004
- [ ] **T-016** `buildPurchasePlan(weekPlan, remainingWindow)` 与四餐明细：两栏采购计划（全周理论用量 / 剩余窗口实际补购量）、分批采购日、储存、缺货替换、渠道与预算参考；日计划只列补购缺口与前夜备餐；四餐生重克数、做法要点、热量蛋白与全天对照表。
  - 依赖：T-013, T-015　｜　产出：`src/core/purchase/`、工作区 `weekly-plan.md` / `daily-plan.md`　｜　映射：FR-019, FR-020, FR-021, AC-03, AC-09, SC-002
- [ ] **T-017** `classifyFeedback(issue, timeline)` 与 A/B/C/D 状态机：A 类双源取证只改错误点并留痕、B 类提 `待采纳`、C 类走版本、D1 只改未来下级、D2 记 `待对齐`；每份周/日计划输出「上级反馈检查」章节；所有修订不突破护栏。
  - 依赖：T-012, T-013　｜　产出：`src/core/feedback/`、工作区 `feedback.md` / `changelog.md`　｜　映射：FR-022, FR-023, FR-024, FR-025, FR-026, FR-027, AC-10, AC-11, SC-006
- [ ] **T-018** `[P]` `render(planObject, languagePack, intlFormatter)`：Markdown 表格渲染、头部元数据、免责声明 / 估算值说明 / `[AIGC]` 标注、Git 可 diff 输出；语言切换只替换字符串，不改任何数值。
  - 依赖：T-013　｜　产出：`src/core/render/`　｜　映射：FR-006, FR-009, FR-028, FR-033, FR-044, AC-12, AC-13, NFR-006
- [ ] **T-019** CLI `rr init / plan / validate / ledger / acceptance`，含 `--level --date --lang --guideline --calendar --country --profile` 覆盖入口与 `CLI > 环境变量 > 配置 > 自动解析` 优先级。
  - 依赖：T-013, T-015, T-017, T-018　｜　产出：`src/cli/`　｜　映射：FR-029, FR-046, AC-12, AC-14, SC-009
- [ ] **T-020** `[P]` 隐私与数据主体操作：`rr export-data` / `rr delete-data`、删除后无残留校验、日志只记 Canonical ID 与错误码、零上传零遥测、请求不含个人参数。
  - 依赖：T-002, T-010　｜　产出：`src/cli/` 数据命令、`src/io/` 日志适配器　｜　映射：FR-047, FR-048, FR-049, FR-050, AC-17, SC-013, NFR-002
- [ ] **T-021** 离线集成测试：断网 + LLM 关闭 + 网络端口禁用下生成年/季/月/周/日计划，断言零对外请求、核心功能完整、日志与示例不含身体数据。
  - 依赖：T-019, T-020　｜　产出：`tests/acceptance/` 离线集成用例　｜　映射：FR-028, FR-051, AC-12, AC-17, SC-008, NFR-001, NFR-009
- [ ] **T-022** **Phase 1 门禁**：AC-01～12 全部转绿、单元测试覆盖率 ≥80%、lint / 类型检查 / 规格一致性 / 隐私扫描通过、三 OS × 三 Node 矩阵结果一致；未绿不得进入 Phase 2。
  - 依赖：T-016, T-017, T-019, T-021　｜　产出：CI 报告、红→绿记录　｜　映射：SC-001, SC-002, SC-003, SC-004, SC-005, SC-006, SC-008, M3 出口

### Phase 2 · 适配层、i18n 与区域策略（M4，US-08 / 11 / 12 / 14）

- [ ] **T-030** `[P]` MCP Server `rr serve-mcp`：stdio transport、注册 `rr_generate_plan` / `rr_validate_plan` / `rr_query_ledger` / `rr_list_locales`；不监听端口、工具描述与返回值均不含身体数据（FR-030 / FR-048）。SDK 许可存疑时退化为零依赖最小 stdio JSON-RPC 层。
  - 依赖：T-019, T-020　｜　产出：`src/mcp/`　｜　映射：FR-030, FR-048, AC-14, SC-009, NFR-008
- [ ] **T-031** `[P]` Canonical ID 键集与七语言包：`locales/_schema/keys.json` + `zh-Hans` / `en` / `fr` / `de` / `es` / `ru` / `la` 的 `strings.json`；回退链「请求语言 → 基础标签 → 配置默认 → en」、缺失键显式标注不静默混排；`rr locales --verify` 校验键集 100% 一致。
  - 依赖：T-018　｜　产出：`locales/`、CLI `rr locales`　｜　映射：FR-040, FR-041, FR-042, FR-044, AC-15, SC-011, NFR-011, P-11
- [ ] **T-032** `[P]` `resolveLocalePolicy(profile, overrides)`：按声明国籍 → 居住地解析指南/历法/单位/语言，用户覆盖优先，头部记录 `auto:nationality` / `auto:residence` / `user` / `auto:fallback`；禁止 IP / 定位 / 静默推断。
  - 依赖：T-010, T-031　｜　产出：`src/core/locale/`　｜　映射：FR-045, FR-046, AC-16, SC-012, NFR-012, P-12
- [ ] **T-033** 区域映射表（ISO 3166-1 → 指南 / 历法 / 单位）与中立通用基线回退；`gregorian-season` 历法同等遵守「年刷新 / 下层只读 / FALLBACK」。中国香港 / 中国澳门 / 中国台湾作为地区级选项。
  - 依赖：T-011, T-014, T-032　｜　产出：`data/region/`、`src/core/guideline/` 映射　｜　映射：FR-003, FR-014, FR-045, AC-16, E-14, SC-012
- [ ] **T-034** `[P]` LLM 可选增强：默认关闭、启用需逐次显式同意并明确范围、不可用或断网时自动降级为规则/模板引擎；**运行期不得调用在线翻译或 LLM**。
  - 依赖：T-021　｜　产出：`src/core/render/` 增强适配点、配置开关　｜　映射：FR-051, AC-17, E-16, SC-013, NFR-009, P-13
- [ ] **T-035** `[P]` 数据源适配器：HowToCook(Unlicense) / USDA FDC(CC0) + 人工校验中国食材子集 / 用户自建；每个数据源带许可声明、版本号、来源 URL；存疑或冲突一律拒绝加载。
  - 依赖：T-010, T-013　｜　产出：`src/core/` 数据源端口、`data/` 元数据　｜　映射：FR-031, FR-032, AC-13, AC-18, SC-010, NFR-008
- [ ] **T-036** 多语言快照与术语：七语言输出快照、切换语言后营养数值 / 去重指纹 / 台账哈希不变；拉丁语「规范译名 + 学名/原文」并列，不改变菜谱结构；中文输出汉字落在 GB 18030-2022 实现级别 1 覆盖范围。
  - 依赖：T-031, T-032, T-033　｜　产出：`tests/snapshots/`　｜　映射：FR-043, FR-044, AC-15, SC-011, E-12
- [ ] **T-037** **Phase 2 门禁**：AC-14～17 全部转绿；MCP 工具脱敏、七语言键集、区域来源标注、断网降级均有可执行断言。
  - 依赖：T-030, T-033, T-034, T-035, T-036　｜　产出：CI 报告　｜　映射：SC-001, SC-002, SC-009, SC-011, SC-012, SC-013, M4 出口

### Phase 3 · 社区规范、合规与全量门禁（M4，US-10）

- [ ] **T-040** `[P]` 产出 `SPEC.md §10` 标注「必需」的社区规范文件：`CONTRIBUTING.md`、`CODE_OF_CONDUCT.md`、`SECURITY.md`、`SUPPORT.md`、`CHANGELOG.md`、Issue/PR 模板与 `config.yml`、`CODEOWNERS`、`ci.yml` 完整版等；`FUNDING.yml` / `GOVERNANCE.md` / `CITATION.cff` 按「建议/可选」登记。
  - 依赖：T-006　｜　产出：`.github/`、`CONTRIBUTING.md` 等　｜　映射：FR-036, FR-039, AC-13, SC-007, SC-014
- [ ] **T-041** `[P]` 合规文档：`PRIVACY.md`（纯本地、零上传、PIPL / 数据安全法 / 网络安全法 / GDPR、数据主体权利、存放位置）、`SECURITY.md`（漏洞渠道与响应）、`THIRD_PARTY_NOTICES.md`（逐项许可 / 来源 URL / 使用边界）。
  - 依赖：T-020, T-035　｜　产出：`PRIVACY.md`、`SECURITY.md`、`THIRD_PARTY_NOTICES.md`　｜　映射：FR-037, FR-050, AC-13, AC-17, AC-18, SC-010, SC-013
- [ ] **T-042** 全量 CI 门禁与静态扫描：规格一致性、单元、验收、lint、语言包键集、区域来源、断网、免责快照、许可、**真实身体数据令牌 / `diet-plan` 数据 / 包管理器清单 / 受版权保护指南原文** 扫描；`CHANGELOG.md` 补录 M1～M2 变更条目。
  - 依赖：T-040, T-041　｜　产出：`.github/workflows/ci.yml`、`scripts/` 扫描脚本、`CHANGELOG.md`　｜　映射：FR-038, FR-053, AC-12, AC-13, AC-18, SC-001, SC-002, SC-014
- [ ] **T-043** `[P]` 实现语言与 Corresponding Source 门禁（AC-19）：校验实现源码为人类可读、可修改的现行 ISO/IEC 标准化语言文本，仓库与 Release 无机器码 / ISA 绑定二进制作为实现主体，归档与产物一一对应，三平台 AC 结果一致。
  - 依赖：T-001, T-042　｜　产出：`scripts/` 语言与归档检查、发布审计记录　｜　映射：NFR-015, AC-19, SC-015, P-16
- [ ] **T-044** `[P]` `polyglot-gate`：登记 ADR-003 G-01～G-06 检查结果；v1 **恒为拒绝**（默认关闭），不引入任何第二实现语言工具链。
  - 依赖：T-043　｜　产出：CI 中的 `polyglot-gate` 登记项　｜　映射：A-10, E-18, NFR-015, P-16, ADR-003 §4.4
- [ ] **T-045** `encoding-check`：中文输出汉字满足 GB 18030-2022 实现级别 1 覆盖范围的静态校验（落盘编码仍为 UTF-8）。
  - 依赖：T-031, T-042　｜　产出：`scripts/` 编码校验、AC-15 附加断言　｜　映射：FR-043, AC-15, SC-011, ADR-003 §4.7
- [ ] **T-046** **Phase 3 门禁**：§10「必需」文件 100% 存在且非空；AC-13 / AC-18 / AC-19 转绿；SC-007 / SC-014 / SC-015 达成。
  - 依赖：T-042, T-043, T-044, T-045　｜　产出：CI 报告、文件清单审计　｜　映射：SC-007, SC-014, SC-015, M4 出口

### Phase 4 · Converge 与发布（M5）

- [ ] **T-050** 全量回归：AC-01～19 全绿、红→绿记录齐备、覆盖率 ≥80%、所有 CI job 通过；逐条核对 SC-001～SC-015 的度量证据。
  - 依赖：T-022, T-037, T-046　｜　产出：验收汇总报告　｜　映射：SC-001～SC-015, P-02
- [ ] **T-051** 追溯矩阵核验与 Converge 报告：`SPEC.md §16` 无孤儿项（无 AC 的 MUST FR、无 FR 的 AC、无 SC 的 AC），FR ↔ AC ↔ SC ↔ 任务 ↔ 提交全链路可查。
  - 依赖：T-050　｜　产出：`docs/converge-report.md`　｜　映射：SC-001, SC-002, P-03, M5 出口
- [ ] **T-052** `[P]` Release 归档：源码 + 语言包 + `LICENSE` + `THIRD_PARTY_NOTICES.md` + 校验和 + 安装说明；附完整 Corresponding Source；**不含包管理器清单、不含任何真实个人数据**。
  - 依赖：T-051　｜　产出：GitHub Releases 归档与校验和　｜　映射：FR-037, FR-052, AC-18, AC-19, SC-014, SC-015
- [ ] **T-053** `[P]` 三 OS × 三 Node 矩阵复核与专项断言（SC-003～SC-013），确认同一组 AC 在各平台结果一致。
  - 依赖：T-051　｜　产出：矩阵报告　｜　映射：NFR-004, SC-003～SC-013, SC-015
- [ ] **T-054** `[P]` 快速开始演练（≤3 步产出第一份日计划）与文档定稿：README / CHANGELOG / 免责与 `[AIGC]` 标注核对；CL-07 正式仓库名与归属在发布前确认。
  - 依赖：T-051　｜　产出：演练记录、文档定稿　｜　映射：SC-009, AC-13, R-01, CL-07

---

## 4. 追溯矩阵（任务 → FR / AC / SC）

### 4.1 FR 覆盖（按 `SPEC.md §6` 分组）

| FR | 主责任务 | 验收场景 | 成功标准 |
|----|----------|----------|----------|
| FR-001～003 | T-010, T-011, T-033 | AC-01, AC-16 | SC-003, SC-012 |
| FR-004, FR-005, FR-014 | T-012, T-033 | AC-05, AC-06 | SC-003, SC-006 |
| FR-006～010 | T-013 | AC-02, AC-03 | SC-002 |
| FR-011～013 | T-014 | AC-04 | SC-005 |
| FR-015～018 | T-015 | AC-07, AC-08 | SC-004 |
| FR-019～021 | T-016 | AC-03, AC-09 | SC-002 |
| FR-022～027 | T-017 | AC-10, AC-11 | SC-006 |
| FR-028～030 | T-018, T-019, T-021, T-030 | AC-12, AC-14 | SC-008, SC-009 |
| FR-031～035 | T-035, T-003, T-018, T-042 | AC-13, AC-15, AC-18 | SC-010, SC-014 |
| FR-036～039 | T-040, T-041, T-042, T-006 | AC-13, AC-14, AC-18 | SC-001, SC-002, SC-007 |
| FR-040～044 | T-031, T-032, T-036, T-045 | AC-15 | SC-011 |
| FR-045, FR-046 | T-032, T-033, T-019 | AC-16 | SC-012 |
| FR-047～051 | T-020, T-021, T-034, T-041 | AC-17 | SC-008, SC-013 |
| FR-052, FR-053 | T-001, T-042, T-052 | AC-18 | SC-014 |
| NFR-001～015 | T-006, T-021, T-042, T-043, T-053 | AC-04, AC-12～19 | SC-001～SC-015 |

> **CL-11 落点**：FR-041 补注（开发期 LLM 候选译文）由 T-031 / T-045 覆盖；FR-043 的 GB 18030-2022 声明由 T-036 / T-045 覆盖，AC-15 附加断言在 T-004 登记红态。A-10 / E-18 由 T-044 覆盖。

### 4.2 AC 主责任务

| AC | 主责任务 | AC | 主责任务 |
|----|----------|----|----------|
| AC-01 | T-010, T-011 | AC-11 | T-017 |
| AC-02 | T-013 | AC-12 | T-021, T-020, T-042 |
| AC-03 | T-013, T-016 | AC-13 | T-040, T-041, T-042, T-018 |
| AC-04 | T-014 | AC-14 | T-004, T-005, T-019, T-030 |
| AC-05 | T-012 | AC-15 | T-031, T-036, T-045 |
| AC-06 | T-012 | AC-16 | T-032, T-033 |
| AC-07 | T-015 | AC-17 | T-020, T-021, T-034, T-041 |
| AC-08 | T-015 | AC-18 | T-003, T-041, T-042, T-052 |
| AC-09 | T-016 | AC-19 | T-043, T-052 |
| AC-10 | T-017 | 红态基线 | T-004（全部 19 条） |

### 4.3 SC 签署任务

| SC | 签署任务 | SC | 签署任务 |
|----|----------|----|----------|
| SC-001 | T-005, T-004, T-050 | SC-009 | T-019, T-030, T-054 |
| SC-002 | T-006, T-022, T-037, T-050 | SC-010 | T-035, T-041 |
| SC-003 | T-011, T-022, T-053 | SC-011 | T-031, T-036, T-045 |
| SC-004 | T-015, T-022, T-053 | SC-012 | T-032, T-033, T-053 |
| SC-005 | T-014, T-022, T-053 | SC-013 | T-020, T-041, T-053 |
| SC-006 | T-012, T-017, T-022, T-053 | SC-014 | T-003, T-042, T-052 |
| SC-007 | T-040, T-046 | SC-015 | T-043, T-052, T-053 |
| SC-008 | T-021, T-042, T-053 | 全量核验 | T-051 |

> CI 的 `spec-consistency` job（T-005 / T-042）**MUST** 校验三张表无孤儿项：每条 MUST 级 FR 有主责任务与 AC、每条 AC 有主责任务、每条 SC 有签署任务。

---

## 5. 红→绿执行顺序与门禁

| 步 | 动作 | 门禁 |
|----|------|------|
| 1 | 完成 P0（T-001～T-006），AC-01～19 全部为**红**，CI 骨架可运行 | T-006：红态是预期，不得删场景换绿 |
| 2 | P1 按依赖顺序实现，每个任务只把自己映射的 AC 转绿 | T-022：AC-01～12 全绿 + 覆盖率 ≥80% + 三平台矩阵一致 |
| 3 | P2 实现 MCP / i18n / 区域策略 / LLM 降级 / 数据源 | T-037：AC-14～17 全绿 |
| 4 | P3 产出社区规范与合规文档、启用全量 CI 与静态扫描 | T-046：AC-13 / 18 / 19 全绿、§10 必需文件齐备 |
| 5 | P4 全量回归、追溯矩阵核验、Release 归档 | T-051 / T-052：SC-001～015 全部达成 |

**并行边界**：`[P]` 任务只在同一 Phase 内并行；跨 Phase 的并行仅限 P3 文档类（T-040 / T-041）与 P1/P2。任何并行任务不得同时修改 `SPEC.md`（P-01：规格变更串行）。

**DoD（引用 `constitution.md §3`，不重写）**：规格已更新 → AC 存在且曾为红 → 实现通过全部 AC → 单元 / lint / 规格一致性通过 → 文档与 CHANGELOG 同步 → 追溯矩阵已勾选 → 人工审查通过。

---

## 6. 本阶段明确不做

- ❌ 不写任何 `src/` 实现代码、测试实现、语言包内容或社区规范文件（M3/M4）。
- ❌ 不新增、不改写任何 FR / AC / SC / P 编号与业务语义；本清单只做分解与映射。
- ❌ 不引入第二实现语言（ADR-003 G-06 默认拒绝），不改变 `plan.md §2` 的技术选型。
- ❌ 不创建 GitHub 远程仓库、不推送、不发布 Release、不运行 `npm publish`。
- ❌ 不把 `../diet-plan/` 的任何真实数据带入本仓库或任务产出物。
- ❌ 不让 CI 通过删除 / 跳过验收场景变绿（P-02 / P-09）。

---

## 7. 风险与开放项

| # | 风险 / 开放项 | 处理 |
|---|---------------|------|
| RK-01 | 任务粒度偏粗，单条任务可能覆盖多个 AC | M3 开工前人工审查本清单（P-10）；允许在 `tasks.md` 内拆子任务，但**必须保持 FR / AC / SC 映射不变**并递增版本 |
| RK-02 | 并行 `[P]` 任务误改同一文件 | 开工前按「产出」列核对；冲突即取消 `[P]` 标记并串行 |
| RK-03 | AC 红态基线被提前「做绿」 | T-006 门禁显式允许 AC 全红；`acceptance` job 记录每条 AC 的红→绿时间戳 |
| RK-04 | CL-07 正式仓库名 / 归属未定（沿用 `plan.md R-01`） | 发布前确认；不阻塞 P0～P3，影响 T-052 / T-054 |
| RK-05 | 指南 / 营养数据源许可或准确性存疑（沿用 R-04） | T-035 / T-041 逐项审计，存疑即降级为用户自建，不内置 |
| RK-06 | 七语言（尤其拉丁语）术语质量（沿用 R-06） | T-031 / T-036：人工审校 + 开发期 LLM 候选译文 + 「译名 + 学名/原文」并列；运行期不调用 LLM |
| RK-07 | 未来被要求引入第二实现语言（沿用 R-09） | T-044 `polyglot-gate` 默认拒绝；须过 G-01～G-06 + 用户书面确认 + 新增 ADR |
| RK-08 | AI 生成物基线化（沿用 R-08 / P-10） | 本清单标 `[AIGC]`，经用户审查后方可作为 M3 基线 |

---

> [AIGC] 本任务清单由 AI 依据 `SPEC.md v0.4.0-draft`、`constitution.md v1.0.0`、`plan.md v1.0.0` 与 ADR-002 / ADR-003 生成，**M3 开工前须用户人工审查**（P-10） · 审计追踪 ID：`RR-TASKS-20261106-0001` · 版本 `v1.0.0-draft`
