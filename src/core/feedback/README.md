# `src/core/feedback/` · 反馈 A/B/C/D 状态机与修订护栏（T-017）

> [AIGC] 审计追踪 ID：`RR-T017-20261108-0001` · 待人工审查（P-10）

**依据**：`tasks.md` T-017；`SPEC.md` FR-022～027、FR-041、FR-044、FR-049、AC-10、AC-11、SC-006、E-01 / E-04 / E-07 / E-09、§9 不变式 3/5、P-05 / P-11 / P-12 / P-14；`plan.md §5.3 / §5.4 / §6.1 / §7.2 / §7.3 / §9`。

**范围**：`classifyFeedback(issue, timeline)` 的 A/B/C/D1/D2 动作推导；反馈台账 `feedback.md` 与变更记录 `changelog.md`；A 类上行「只改错误点」与 D 类下发的落盘修订；每份周 / 日计划的「上级反馈检查」结构化章节。不生成菜谱、不渲染完整 Markdown、不联网、不重算计划正文。

## 文件职责

| 路径 | 职责 |
|------|------|
| `errors.js` | `FEEDBACK_ERROR` 13 码、`FeedbackError`（只含稳定码 + Canonical ID） |
| `contract.js` | 常量与状态机、issue / timeline / patch / 台账行白名单、规则版本序号复算、状态流转 |
| `classify.js` | `(方向 × 类型)` 映射表、双源取证、时间线护栏、台账行构造器 |
| `annotation.js` | 单行纯 ASCII「修订标注 / 上级下发修订标注」，幂等剥离且不误删用户批注 |
| `ledger.js` | 两本只追加台账的渲染 / 解析 / 追加与历史字节复验 |
| `revision.js` | A 类上行与 D 类下发落盘、P-05 切分与历史哈希复验 |
| `section.js` | FR-026「上级反馈检查」结构化章节与 ASCII 索引 |
| `index.js` | 统一出口 |
| `tests/unit/feedback.test.js` | 29 条先红后绿单测 |

复用 T-012 `splitPlanFilesByDate`（`≤ run_date` 归历史）与 T-002 `FsPort`（`hash` / `readText` / `writeText` / `appendText` / `exists`）；**不改动任何已跟踪文件**。`src/core/feedback/.gitkeep` 按用户 2026-11-08 裁决留 T-040 统一清理，本任务不删。

## 口径细化（不改 SPEC.md，仅记录工程解释）

| 规格措辞 | 实现口径 |
|---|---|
| FR-022「A/B/C/D 四类」 | 类别**不由调用方注入**：`issue` 只描述事实（`kind` / `direction` / 层级 / 日期 / 取证来源），由 `(direction, kind)` 映射表推导 A / B / C / D1 / D2；`down\|coverage_gap` 无定义即拒绝（上级不得向下级提覆盖缺口提案） |
| FR-022「每条含 ID、日期、类别、发起层、问题、处理、状态、落点」 | `feedback.md` 固定 8 列，全部 ASCII Canonical ID / ISO 日期 |
| FR-023「双源取证」 | A 类要求 ≥2 个互不相同、符合 `source.*` 的独立取证标识；少于 2 源 / 同源重复 / 非 source 前缀一律拒绝 |
| FR-023「只改错误点」 | 补丁是**精确命中一次的单行替换**：0 次或多次命中都拒绝；正文其余字节逐字保留，只新增一行头部标注（FR-025 不整篇重写、不生成尚不存在的菜单） |
| FR-024「D2 只加提示、登记 `待对齐`」 | D2 零正文改动，只在未来计划头部加 `action=D2 status=status.pending_alignment` 标注；传入任何补丁即拒绝 |
| FR-025「覆盖用户批注 / 实际执行记录 / 已完成采购清单」 | 幂等剥离只匹配**文件最开头**的 `<!-- rr-feedback ... -->` 行，正文中的任意 `<!-- ... -->`（含 E-07 用户批注）不扫描、不删除，逐字保留 |
| FR-026「上级反馈检查章节」 | 输出结构化 `checks: {A,B,C,D}`（各带 `checked` 计数与登记 ID）+ 确定性纯 ASCII 索引；标题 / 免责声明 / 文案归 T-018 / T-031；零反馈时四类仍齐全且计数 0，不虚构记录（E-05） |
| FR-027「不突破护栏」 | 补丁 `field_key` 若是 7 类护栏字段（能量下限 / 蛋白下限 / 短期去重 / 安全禁忌 / 减脂目标 / 周期口径 / 调度配置）一律拒绝；核心不重算营养数值，故不可能改低数值 |
| plan.md §5.3「`待采纳 / 待接收 / 待对齐 → 已*`」 | 状态流转是**追加新行**（事件溯源），`latestStatusById()` 取同 ID 最后一行；绝不就地改写历史行（§9 不变式 5） |
| AC-10「变更记录追加一条规则版本」 | A 与 D1 的修订经 `appendFeedbackRecord()` 同时追加 `rule-NNNN` 版本行；序号由已有变更记录复算（`nextRuleVersionId`），不由日期或调用方猜测（E-08） |

`timeline` 固定键集只有 `run_date`；历史 / 未来一律按 `plan_date ≤ run_date` 推导，不接受注入 `dates` 之类参数放宽（P-05）。

## 设计决策与边界

### 1. 分类是推导，不是标签透传

若允许调用方直接写 `category: 'A'`，分类函数就只是回显，无法证明「双源取证 / 时间线」被正确执行。因此输入只承载可观测事实，动作由映射表唯一决定；`down|fact_error → D1`、`down|framework_change → D2`、`up|fact_error → A`、`up|coverage_gap|framework_change → B`、`*|data_change → C`。C 类只交接 `feedback.handoff.detect_version_changes`（T-012 `detectVersionChanges`），**本任务不重算计划正文**。

### 2. 时间线复验两次，且写入期间也受保护

A 类与 D 类都先取**全部**计划文件的哈希基线，只写未来文件，再复验所有未写入文件（含历史计划）的哈希；若端口在写入回调里夹带改动历史文件，立即抛 `ERR_FEEDBACK_TIMELINE`（SC-006）。`≤ run_date` 的等号归历史，`skipped` 数组逐条回传「已跳过(已执行)」状态，不回改历史快照。

### 3. 只追加与事件溯源

`feedback.md` / `changelog.md` 是纯 ASCII Markdown 表格，首次只写表头零数据行；追加后复验「历史字节前缀不变 + 新增部分恰好等于该行」，覆盖写伪装成 `appendText` 即抛 `ERR_FEEDBACK_APPEND`。状态变化不是 UPDATE 而是 INSERT，因此历史行永远不变。工作区文件不入库，测试仅用注入的 `createMemoryFs` 替身（P-14）。

### 4. 错误脱敏与语言解耦

`FeedbackError` 消息只拼稳定码，`issues` 只含 `{code, field, hint}`，`hint` 为 ASCII Canonical ID；不含身体数值、自然语句或原始输入（FR-049 / P-11）。「已即时修订 / 待采纳 / 待接收 / 待对齐 / 已跳过(已执行)」全部是 `status.*` Canonical ID，中文标签归 T-031 语言包；切换语言不改变任何分类结果、台账行或时间线判定（FR-044）。

### 5. 相关边界决策的归属

E-01（交节 ≥12:00 的暂行规则）已由 T-014 `resolveActiveTerm()` 落实并标注 `E-01-provisional`，其「B 类提案待上级采纳」的登记位在本任务的状态机中；E-07 用户批注由幂等剥离保护；E-09 许可证冲突可经 `changelog.md` 的 `reason_key` 登记且拒绝进入产物。这些**都不改变本任务的分类口径**，也不需要新的规格条款。

### 6. 本任务边界

**AC-10 / AC-11 仍为 RED**：本任务只产出核心域分类、只追加台账、结构化检查章节与 ASCII 索引；「周 / 日计划的完整 Markdown 呈现」「端到端级联调度与快照比对」归 T-018 / T-019。`tasks.md` 39 项仍全部 `- [ ]`（P-02）。仓库内**不预置**任何真实 `feedback.md` / `changelog.md`。

## 校验记录（2026-11-08）

| 项 | 结果 |
|----|------|
| 先红证据 | 实现前 `npm test`：138 条 / 137 pass / **1 fail**（`src/core/feedback/index.js` 缺失） |
| 转绿 / 全量 | `feedback.test.js` **29/29**；`npm test` **166/166** |
| 基线回归 | `npm run acceptance` **19/19 RED · 0 GREEN**；`npm run spec-check` PASS；已跟踪 diff 与暂存均空 |
| 负向探针 | **41/41** 项弱化全部被单测检出、全部字节级还原、还原后 29/29，见 `reviews/round-9/t017-negative.md` |
| 双代理复审 | Round 9：P0 PASS 11/0/0、P1 PASS 28/0/1（唯一 WARN = 已裁决留 T-040 的 `.gitkeep`） |
| 隐私 / IO | 零真实网络请求、零磁盘工作区文件、核心域零 `node:` 直接 IO、真实身体数据令牌 0 |

**实现侧一处修复（非审查器误报）**：首轮转绿时 1 条单测失败，定位 `nextRuleVersionId()` 复用了无捕获组的 `/^rule-\d{4}$/`，`hit[1]` 为 `undefined` → `rule-0NaN`；改用带捕获组的 `RULE_VERSION_SEQ`。**未改测试、未放宽断言**。

**主动加固（沿用 Round 6 / 8 的反耦合教训）**：在写负向探针前补 3 条独立取证单测——两本台账表头/数据行的纯 ASCII 确定性，以及「写入回调夹带改动历史文件」时 A 类与 D 类各自的 SC-006 复验。避免护栏被别的错误掩盖，单测 26→29、全量 163→166。
