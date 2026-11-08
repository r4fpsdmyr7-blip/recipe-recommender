# `src/core/dedup/` · 短期去重与只追加台账（T-015）

> [AIGC] 审计追踪 ID：`RR-T015-20261108-0001` · 待人工审查（P-10）

**依据**：`tasks.md` T-015；`SPEC.md` FR-015～018、FR-041、FR-044、FR-049、AC-07、AC-08、SC-004、E-05、§9 不变式 3/5、P-05 / P-11 / P-14；`plan.md §5.3 / §5.4 / §6.1 / §9`。

**范围**：`applyDedup(candidate, ledger, window)` 与周计划批量判定 `applyDedupWeek(candidates, ledger, window)`；组合指纹、台账 `history.md` 的结构化渲染 / 解析 / **只追加**写入。不生成菜谱本体、不渲染 Markdown、不联网、不做反馈下发。

## 文件职责

| 路径 | 职责 |
|------|------|
| `errors.js` | `DEDUP_ERROR` 11 码、`DedupError`（只含稳定码 + Canonical ID） |
| `contract.js` | 常量与窗口口径、Canonical ID / 版本 / 周期键校验、FNV-1a 组合指纹、候选与台账行白名单 |
| `ledger.js` | Markdown 表格表头 / 数据行渲染、台账解析、**只追加**写入与历史字节复验 |
| `apply.js` | 单候选与周计划批量去重判定（纯函数、零 IO） |
| `index.js` | 统一出口 |
| `tests/unit/dedup.test.js` | 22 条先红后绿单测 |

复用 T-010 的 `VERSION_KEYS`（五类版本）与 T-002 的 `FsPort.appendText`；**不改动任何已跟踪文件**。`src/core/dedup/.gitkeep` 按用户 2026-11-08 裁决留 T-040 统一清理，本任务不删。

## 口径细化（不改 SPEC.md，仅记录工程解释）

| 规格措辞 | 实现口径 |
|---|---|
| FR-015「最近 7 天」/ AC-07 | 短期窗口 = `[候选日期 - 7, 候选日期 - 1]`（7 个自然日，**不含目标日本身**，否则自指循环）；窗口外记录不参与短期拒绝 |
| FR-016「最近 4 周」 | 目标 ISO 周之前的 4 个 ISO 周，即 `[week_start - 28, week_start - 1]` |
| FR-016「重合 ≤ 2 道」 | 近 4 周台账出现过的**不同主菜标识**与本周 7 个主菜标识的交集大小 ≤ 2 |
| FR-015「去重优先级高于周计划」 | `source: 'week_plan'` 不豁免任何冲突；冲突时额外回传 `dedup.reason.override_week_plan` |
| E-05「无历史台账」 | 首次写入只落表头（零数据行），`parseLedgerText(header) === []`，绝不虚构历史记录 |

**窗口长度（7 天 / 4 周 / 上限 2 道）是不可注入的常量**：`window` 固定键集只有 `run_date`，额外键（如 `short_term_days: 1`）一律拒绝，防止调用方以参数方式放宽护栏。

## 设计决策与边界

### 1. 两条独立规则：组合指纹 vs 主标识

`comboFingerprint(main_id, staple_id)` 是纯 JS FNV-1a（零 `node:crypto` 依赖），只由两个 Canonical ID 决定，因此切换输出语言后哈希不变（FR-044 / NFR-011）。FR-015 的「主菜 + 主食组合不重复」与 FR-016 / AC-08 的「同一周内主标识互斥」是**独立判定**：主菜相同但主食不同，跨周允许、同周仍拒绝。

### 2. 周期性重复只豁免「窗口之外」

`cycle_key` 限定为 `term.*` / `month.*` / `year.*`。台账中存在同主菜 + 同周期键且**落在短期窗口之外**的记录时，结果标 `periodic_reuse: true` 与 `dedup.reason.periodic_reuse`（AC-08 跨年立冬代表菜可复用）；**周期键绝不作为豁免条件**——同一组合落在 7 天内仍然拒绝（FR-017）。台账里更早的记录不参与短期拒绝，是「允许周期性重复」的自然结果，不需要额外白名单。

### 3. 纯函数与 IO 严格分离

`applyDedup` / `applyDedupWeek` 不接收 `FsPort` / `ClockPort` / `NetPort`，输入输出完全确定；台账落盘由调用方显式调用 `appendDedupEntry(fsPort, path, entry)`。写后复验「历史字节前缀不变 + 新增部分恰好等于该行」，若端口把 `appendText` 实现成覆盖写，抛 `ERR_DEDUP_APPEND`（§9 不变式 5 / P-05）。候选日期 `≤ run_date` 一律拒绝，避免向历史台账补写记录（§9 不变式 3）。

### 4. 台账格式与防篡改

`history.md` 是 9 列纯 ASCII Markdown 表格：`date | level | period_id | main_id | staple_id | combo_fp | version_ids | cycle_key | source`，登记 FR-018 要求的全部字段（版本号为 `body/rx/loc/st/rule` 五键）。解析时校验固定列数、Canonical ID、真实日期、版本键集，并复算 `combo_fp` 与内容一致；任何损坏行一律拒绝，**不静默跳过**。工作区台账不入库、测试用注入的内存替身，零磁盘写入（P-14）。

### 5. 错误脱敏与语言解耦

`DedupError` 消息只拼稳定码，`issues` 只含 `{code, field, hint}`，`hint` 为 ASCII Canonical ID；不含身体数值、菜名自然语言或原始输入（FR-049 / P-11）。返回值中的「替换原因 / 冲突原因 / 周期性复用」全部是结构化 `reason_keys` / `conflict_keys`，面向人的文案归 T-018 渲染、语言包归 T-031。

### 6. 本任务边界

**AC-07 / AC-08 仍为 RED**：本任务只产出核心域判定与台账能力，「生成第 7 天日计划」「在文中说明替换原因」「周 / 日计划端到端接线」需要 T-016（四餐 / 采购）、T-018（渲染）、T-019（CLI 调度）；可执行业务断言尚不能端到端跑通。`tasks.md` 39 项仍全部 `- [ ]`（P-02）。仓库内**不预置**任何真实 `history.md`。

## 校验记录（2026-11-08）

| 项 | 结果 |
|----|------|
| 先红证据 | 实现前 `npm test`：91 条 / 90 pass / **1 fail**（`src/core/dedup/index.js` 缺失） |
| 转绿 / 全量 | `dedup.test.js` **22/22**；`npm test` **112/112** |
| 基线回归 | `npm run acceptance` **19/19 RED · 0 GREEN**；`npm run spec-check` PASS |
| 负向探针 | **21/21** 项弱化全部被单测检出、全部字节级还原、还原后 22/22，见 `reviews/round-7/t015-negative.md` |
| 双代理复审 | Round 7：P0 PASS 11/0/0、P1 PASS 22/0/1（唯一 WARN = 已裁决留 T-040 的 `.gitkeep`） |
| 隐私 / IO | 零真实网络请求、零磁盘台账、核心域零 `node:` 直接 IO、真实身体数据令牌 0 |

**实现侧修复**：首轮转绿时 4 条单测失败，定位到 `parseLedgerText` 把 Markdown 表头行误当数据行解析；修实现（显式跳过 `HEADER_LINE` / `SEPARATOR`），**未改测试、未放宽断言**。
