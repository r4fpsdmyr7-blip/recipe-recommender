# `src/core/purchase/` · 两栏采购计划、四餐明细与工作区索引（T-016）

> [AIGC] 审计追踪 ID：`RR-T016-20261108-0001` · 待人工审查（P-10）

**依据**：`tasks.md` T-016；`SPEC.md` FR-010、FR-019～021、FR-027、FR-041、FR-044、FR-049、AC-03、AC-09、SC-002、E-05 / E-06、§9 不变式 1/3、P-05 / P-11 / P-12 / P-14；`plan.md §5.3 / §6.1 / §7.2 / §9`。

**范围**：`buildPurchasePlan(weekPlan, remainingWindow)` 两栏折算、分批采购日、储存 / 缺货替换 / 渠道预算参考、备餐建议；`buildDailyPlan(day, purchasePlan)` 四餐明细、全天合计与九项处方对照表、补购缺口与前夜备餐；工作区 `weekly-plan.md` / `daily-plan.md` 的**确定性 ASCII 结构索引**。不生成菜谱本体、不渲染完整 Markdown、不联网、不做反馈下发。

## 文件职责

| 路径 | 职责 |
|------|------|
| `errors.js` | `PURCHASE_ERROR` 13 码、`PurchaseError`（只含稳定码 + Canonical ID） |
| `contract.js` | 四餐 / 储存类别 / 路径常量、固定键集白名单、周计划与剩余窗口校验、食材按 ID 聚合与守恒合计 |
| `purchase.js` | 两栏采购计划与分批采购（纯函数、零 IO） |
| `daily.js` | 四餐明细、九项对照表、补购缺口、前夜备餐与 BMR / 蛋白硬护栏（纯函数、零 IO） |
| `workspace.js` | 纯 ASCII 结构索引渲染与经 `FsPort.writeText` 落盘；日索引写前时间线校验 |
| `index.js` | 统一出口 |
| `tests/unit/purchase.test.js` | 25 条先红后绿单测 |

复用 T-011 的 `RX_FIELDS`（九项处方）与 T-002 的 `FsPort.writeText`；**不改动任何已跟踪文件**。`src/core/purchase/.gitkeep` 按用户 2026-11-08 裁决留 T-040 统一清理，本任务不删。

## 口径细化（不改 SPEC.md，仅记录工程解释）

| 规格措辞 | 实现口径 |
|---|---|
| FR-010 / AC-09「全周理论用量」 | `theoretical` 汇总周计划 7 天全部菜单，与运行日无关 |
| FR-010 / AC-09「剩余窗口实际补购量」 | `actual` 只汇总 `date > run_date` 的未来日期；`date ≤ run_date` 全部归入 `past_dates`，绝不覆盖已过去日期的食材（P-05） |
| FR-019「分批采购日」 | 耐储品在剩余窗口首日一批买齐；易腐品按剩余窗口逐日分批，采购日 = 使用当日；每批给出储存键集合与合计生重 |
| FR-019「预算参考」 | 只输出结构化 `price_bands`（每档食材计数），**不编造货币金额、不引入 `amount` / `currency`**（P-11） |
| FR-019「缺货等价替换」 | 只透传注入的 `substitute_ids`，不自行推断、不允许替换自身；原因统一为 `purchase.reason.substitute_equivalent`（E-06） |
| FR-020「日计划只列补购缺口」 | `top_up` 只列当日易腐品（耐储品已在窗口首日买齐），不重复整周清单 |
| FR-021「全天对照表」 | 九项处方逐项给 `prescribed / estimated / compliant`；仅 `energy_kcal` / `protein_g` 有注入的每 100g 参数可估算，其余七项 `estimated: null` + `plan.notice.not_estimated`，**不编造数值** |
| FR-020「前夜备餐」 | 按 `prep_key` 聚合当日食材，统一 `prep.timing.previous_evening` |

**核心域零营养学常量、零内置食材表**：菜品、生重、每 100g 参数、储存类别、等价替换、价格档、备餐动作全部由上层注入的结构化菜单提供（T-013 计划对象 + 数据层菜单）。核心只做校验、聚合、折算与护栏。

## 设计决策与边界

### 1. 剩余窗口不可注入

`remainingWindow` 固定键集只有 `run_date`；剩余日期由周计划菜单按 `> run_date` 推导，不接受调用方传入 `dates` / `short_term_days` 之类参数放宽（FR-041 / P-05）。`buildDailyPlan()` 二次校验 `date ≤ run_date` 或不在 `remaining_dates` 内一律拒绝；`writeDailyPlan()` 在**任何写入之前**校验目标日期，拒绝回改历史快照（§9 不变式 3）。

### 2. 两栏守恒与分批可复算

`theoretical.totals.raw_g = 7 × 单日生重`；`actual.totals.raw_g = 剩余天数 × 单日生重`；两者按 `ingredient_id` 聚合去重，`aggregated items` 的 `raw_g` 之和等于 `totals.raw_g`，所有采购批次展开后的 `raw_g` 之和等于 `actual.totals.raw_g`（SC-002）。同一食材跨日若出现参数不一致，直接抛 `ERR_PURCHASE_ITEM`，不静默取均值。

### 3. 去重结果作为前置条件

每日菜单的 `dedup.status` 必须为 `accepted`，`main_id` / `staple_id` 必须是 Canonical ID；未通过 T-015 去重的菜单不得进入采购折算（FR-027）。本任务**不重新实现去重**，只消费其结果。

### 4. 硬护栏与估算边界

日计划全天 `energy_kcal < guardrails.energy_floor_kcal` 或 `protein_g < guardrails.protein_floor_g` 即拒绝（§9 不变式 1）。护栏下限来自 T-011 注入，核心不内置 BMR 常量。处方区间收窄只改变对照表的 `compliant` 结论，**不改变任何营养数值**（FR-044）；`language_tag` 切换后两栏用量、营养数值与结构逐字节不变（FR-044 / FR-049）。

### 5. 结构索引而非完整渲染

与 T-013 `periodic-plan.md` 同口径：`weekly-plan.md` / `daily-plan.md` 当前只写确定性纯 ASCII 结构索引（周期、两栏总量、批次计数、四餐计数、稳定 `notice_keys`）。完整 Markdown 表格、免责声明、语言包文案归 T-018 / T-031。测试用注入的 `createMemoryFs` 替身，零磁盘写入（P-14）。

### 6. 错误脱敏与语言解耦

`PurchaseError` 消息只拼稳定码，`issues` 只含 `{code, field, hint}`，`hint` 为 ASCII Canonical ID；不含身体数值、菜名自然语言或原始输入（FR-049 / P-11）。「做法要点」「储存方式」「替换原因」「渠道 / 预算」「备餐时机」全部是结构化 Canonical ID / `*_keys`，面向人的文案归 T-018 渲染、语言包归 T-031。

### 7. 本任务边界

**AC-03 / AC-09 仍为 RED**：本任务只产出核心域结构与 ASCII 索引，「周 / 日计划的完整 Markdown 呈现」「端到端调度与快照比对」归 T-018 / T-019；可执行业务断言尚不能端到端跑通。`tasks.md` 39 项仍全部 `- [ ]`（P-02）。仓库内**不预置**任何真实 `weekly-plan.md` / `daily-plan.md`。

## 校验记录（2026-11-08）

| 项 | 结果 |
|----|------|
| 先红证据 | 实现前 `npm test`：113 条 / 112 pass / **1 fail**（`src/core/purchase/index.js` 缺失） |
| 转绿 / 全量 | `purchase.test.js` **25/25**；`npm test` **137/137** |
| 基线回归 | `npm run acceptance` **19/19 RED · 0 GREEN**；`npm run spec-check` PASS；已跟踪 diff 与暂存均空 |
| 负向探针 | **33/33** 项弱化全部被单测检出、全部字节级还原、还原后 25/25，见 `reviews/round-8/t016-negative.md` |
| 双代理复审 | Round 8：P0 PASS 11/0/0、P1 PASS 25/0/1（唯一 WARN = 已裁决留 T-040 的 `.gitkeep`） |
| 隐私 / IO | 零真实网络请求、零磁盘工作区文件、核心域零 `node:` 直接 IO、真实身体数据令牌 0 |

**负向探针发现的一处测试耦合（已修）**：首轮 33 项探针中 NEG-06（每 100g 参数非负护栏）与 NEG-07（储存类别枚举护栏）未被检出。定位为这两处坏值只改写了周计划第 1 天的食材，`aggregateItems` 的「同一食材跨日参数一致性」检查先抛错，使 `assert.throws` 因**错误的原因**通过，掩盖了单条食材自身的护栏。按 T-014 Round 6 的同类处置，新增两条独立单测：让 7 天的同一食材都带同一处缺陷，直接对 `validateWeekPlan` 断言具体错误码与 hint（`ERR_PURCHASE_NUTRITION` / `action.purchase.per_100g`、`ERR_PURCHASE_ITEM` / `action.purchase.shelf_class`）。**未放宽任何既有断言、未改实现**，单测从 23 条增至 25 条后复跑 33/33 全检出。

**测试写法订正**：`fs.list()` 返回 Promise，原断言与数组直接 `deepEqual` 永远不相等；改为 `await fs.list()` 使断言真正生效（属加强而非弱化）。
