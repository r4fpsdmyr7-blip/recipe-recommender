# `src/core/profile/` 版本检测 + `src/core/planner/` 重算切分（T-012）

> [AIGC] 审计追踪 ID：`RR-T012-20261108-0001` · 待人工审查（P-10）

**依据**：`tasks.md` T-012；`SPEC.md` FR-004 / FR-005 / FR-009 / FR-014 / FR-049、E-04、AC-05 / AC-06、SC-006、P-05 / P-11、§9 不变式 3 / 4；`plan.md §5.2 / §7.3 / §9`；`constitution.md` P-01 / P-02 / P-10。

**范围**：`detectVersionChanges(profile, planHeader)` 判定档案版本与计划头部是否一致并产出重算原因；`splitPlanFilesByDate()` 按「计划日期 ≤ 运行日」切分；`buildRecalcAnnotation()` 生成可 diff 的重算标注；`applyRecalcToFuture()` 只写未来计划并复验历史哈希。纯 ESM、零第三方依赖、零直接 `node:` IO，时间与文件一律经注入端口。

## 文件职责

| 路径 | 职责 |
|------|------|
| `src/core/profile/recalc-errors.js` | `RECALC_ERROR` 稳定码、`RecalcError`（只含稳定码 + Canonical ID） |
| `src/core/profile/detect-version-changes.js` | `detectVersionChanges()`、`RECALC_REASON`、`RECALC_SOURCE` |
| `src/core/profile/index.js` | 追加上述出口 |
| `src/core/planner/split.js` | `isIsoDate()`、`splitPlanFilesByDate()` |
| `src/core/planner/annotation.js` | `buildRecalcAnnotation()`、`stripRecalcAnnotations()` |
| `src/core/planner/apply.js` | `applyRecalcToFuture(fsPort, { clock, planFiles, change })` |
| `src/core/planner/index.js` | 统一出口 |
| `tests/unit/recalc.test.js` | 12 条先红后绿单测 |

## 设计决策与边界

### 1. 版本检测口径是「ID 比对」，不比较 `updated_at`

§9 不变式 4 要求「计划头部版本集合 ⊆ 档案当前版本集合，否则触发重算」。`plan.md §5.2` 的计划头部只携带五个版本 **ID 字符串**；`updated_at` 只存在于 T-010 规范化后的档案侧。因此检测以 ID 为准，复用 `VERSION_KEYS` 顺序与 `compareVersions()`（两侧都只给 `{ id }`）。**绝不由日期推断版本变化，也绝不猜测补齐版本集合**；任一侧缺键 / 未知键 / 空 ID 一律抛 `RecalcError`（E-08 / E-04 护栏前置）。

原因分组（Canonical ID，面向人文案归 T-018 / T-031，P-11）：

| 变化键 | `reason_keys` | 规格来源 |
|--------|---------------|----------|
| `body` / `rx` | `plan.recalc.body` | FR-004「已按新体测重算」 |
| `loc` / `st` | `plan.recalc.residence` | FR-005 / FR-014「已按新居住地重算」 |
| `rule` | `plan.recalc.rule` | FR-009 / 变更记录 `rule-` 分型 |

`version_ids` 只含**发生变化**的键，即计划头部要标注的「所依据版本号」；`source: 'E-04'` 是 §15 的错误情形编号，不是自由文本。

### 2. 等号归历史：时间线不可侵犯（P-05 / SC-006）

`计划日期 ≤ 运行日` → `historical`（只读快照）；`> 运行日` → `future`。ISO 日期字符串字典序等于日历序，但仍先做严格的格式 + 真实存在性校验（拒绝 `2026-13-01`、`2026-11-6`、`2026-02-30`），非法输入抛 `ERR_RECALC_DATE`。运行日由 `ClockPort.today()` 注入，不读系统时钟。切分是纯函数，输入数组与元素均不改写。

### 3. 写入前 / 写入后双次哈希，历史零写入

`applyRecalcToFuture()` 顺序即护栏：先对**全部**计划文件取 SHA-256 基线 → 仅对 `future` 调用 `writeText` → 再复取 `historical` 哈希；任一不一致立即抛 `ERR_RECALC_TIMELINE`。单测通过注入被篡改的 `hash` 端口验证该检出路径，也验证 `fsPort.writes()` 中绝不出现历史路径（AC-06「历史文件内容逐字节不变」、SC-006）。`needs_recalc === false` 时直接零写入返回。

### 4. 重算标注是可 diff 的 ASCII 单行，且幂等

格式示例（纯 ASCII、无换行、无面向人文案）：

```text
<!-- rr-recalc v=1 source=E-04 reasons=plan.recalc.body changed=body,rx versions=body:body-2026-11-08,rx:rx-2026-11-08 -->
```

重复重算时整行替换旧标注，不叠加；`stripRecalcAnnotations()` 只剥离文件**开头**符合本模块格式的注释行，不扫描正文，避免误删用户手工批注（E-07，正式冲突处理归 T-017）。所有值受 `SAFE_VALUE` 白名单约束，最终再做一次 ASCII / 单行双保险。

### 5. 本任务不重新生成计划正文

T-012 只写「重算标注 + 依据版本号」；热量 / 蛋白 / 菜谱正文的重算归 T-013（五级计划）与 T-016（四餐明细），D 类下发修订归 T-017，语言包与免责声明归 T-018 / T-031，区域策略归 T-032 / T-033。单测中 `computeRx(newBody, adapter)` 只用于证明「按新 body 推导仍不低于新 BMR」这一 AC-06 第一句的数值护栏，**不构成计划正文重算**。

因此 **AC-05 / AC-06 在本任务完成后仍为 RED**，`tasks.md` 的 39 项仍全部 `- [ ]`（P-02：AC 未转绿不得勾选）。

### 6. 错误脱敏

`RecalcError.message` 只由 `ERR_RECALC_*` 稳定码拼成，`issues` 只含 `{ code, field, hint }`，`hint` 为 ASCII Canonical ID；错误消息、标注、结论对象中均不含身体数值、自然语句或原生异常文本（FR-049 / plan.md §9 / P-11）。

## 校验记录（2026-11-08）

| 项 | 结果 |
|----|------|
| 先红证据 | 实现前 `npm test`：40 条中 39 pass / 1 fail（`recalc.test.js` 因实现模块缺失整文件加载失败） |
| 转绿 | `node --test tests/unit/recalc.test.js`：12 / 12 PASS |
| 回归 | `npm test` 全绿；`npm run acceptance` 仍 `19/19 RED · 0 GREEN`；`npm run spec-check` PASS |
| 负向探针 | 见 `reviews/round-4/t012-negative.md`：弱化等号归属 / 时间线复验 / 标注幂等 / rule 检测 / 头部完整性，均被单测检出 |
| 隐私 | 新增文件无真实身体数据令牌；示例与单测全部虚构 |

---

# T-013 · 五级计划生成器（同目录，追加）

> [AIGC] 审计追踪 ID：`RR-T013-20261108-0001` · 待人工审查（P-10）

**依据**：`tasks.md` T-013；`SPEC.md` FR-006～010、FR-027、E-02 / E-03 / E-05、AC-02 / AC-03、SC-002、P-05 / P-11 / P-12、§9 不变式 1/2/4；`plan.md §5.2 / §5.3 / §6.1 / §7.1 / §7.2 / §7.3`。

**新增文件**：`errors.js`（`PLAN_ERROR` 13 码 + `PlanError`）、`period.js`（周期解析 / ISO 周 / 合并调度）、`calendar.js`（只读时令缓存视图）、`plan.js`（`buildPlan` + 五个层级入口 + 层级一致性校验）、`periodic.js`（三层合并视图与 `periodic-plan.md` 结构索引）、`tests/unit/plan.test.js`（18 条单测）；`index.js` 追加出口。

## T-013 设计决策与边界

### 1. 输出是「未渲染的结构化计划对象」

`plan.md §6.1` 定义 `planYear / … / planDay(ctx)` 的输出为「结构化计划对象（未渲染）」。因此计划对象内部只有 Canonical ID、周期标识、版本 ID、数值区间与稳定的 `notice_keys`，**不含任何自然语言的计划正文**（P-11）。Markdown 表格、免责声明、`[AIGC]` 人可读标注、输出语言切换全部归 T-018；四餐明细与采购归 T-016；去重归 T-015；反馈下发归 T-017；CLI / MCP 入口归 T-019。

`periodic-plan.md` 在本任务中只写**确定性 ASCII 结构索引**（文件清单 / 周期标识 / 版本 ID / 刷新标记 / 剩余窗口），不写渲染表格。AC-02 要求的三份 `.md` 渲染文件尚未产出，故 **AC-02 / AC-03 仍为 RED**，`tasks.md` 39 项仍全部 `- [ ]`。

### 2. T-014 依赖以「只读缓存端口」解耦，不越界实现

`tasks.md` 声明 T-013 依赖 T-014，但 T-014（历法下载 / 双源校验 / UTC+8 缓存）尚未开工。本任务**不下载、不缓存、不计算任何节气交节时刻，也不内置 / 套用固定近似节气日期表**（FR-012），只消费调用方注入的只读缓存视图 `{ cache_id, year, status, terms: [{ id, at }] }`：

- 固定键集白名单，额外键 / 缺键 / 非法 `id` / 非法时间戳一律拒绝（与 T-011 FR-032 同口径）；
- 只按日期**筛选缓存中已存在的条目**，把 Canonical ID 透传进计划头部；
- `status: 'FALLBACK'` 时透传 `plan.review.calendar_fallback` 人工复核提示键，不静默取近似值（E-03）；
- 单测中的缓存是**合成测试替身**（`term.fixture_*`），不是真实节气表。

年计划联网刷新与缓存落盘仍归 T-014；在此之前端到端调度不能声称可用。

### 3. 「季」= 日历季度，节气主线另走缓存

AC-02 指定 1/1 产出 `2026-Q1.md`，故 `season` 按日历季度 Q1–Q4（1/4/7/10 月首日）解析。24 节气 / 时令主线不由日期推断，一律来自注入缓存；`validatePlanHierarchy()` 校验下层的 `term_ids ⊆ 上层 term_ids` 且 `cache_id` 一致（§9 不变式 2）。

### 4. 首日口径、合并调度与执行窗口

| 层级 | 触发 | 目标周期 | 文件标识 |
|------|------|----------|----------|
| year | 1/1 | 当年 | `2026-annual.md` |
| season | 季首日 | 当季 | `2026-Q1.md` |
| month | 每月 1 日 | 当月 | `2026-01-month.md` |
| week | 周一 | **当周**（ISO 周，非下一周） | `2026-W45-week.md` |
| day | 每日 **20:00** | **次日**（唯一例外） | `2026-11-07.md` / 标题同日期 |

FR-008 合并调度：1/1 产出 3 层；4/1、7/1、10/1 产出 2 层；其余月首日产出 1 层；非首日不刷新低频层。非 20:00 调用 `planDay` 一律抛 `ERR_PLAN_WINDOW`。

FR-010 非首日补跑：仍产出完整周期框架（周计划恒为 7 天），但 `execution_window` 明确标注剩余窗口。该窗口**复用 T-012 `splitPlanFilesByDate`**：`计划日期 ≤ 运行日` 为已执行历史，剩余只含未来日（例如周五 2026-11-06 补跑 W45 → 已执行 5 天 / 剩余 2 天：11-07、11-08），与 P-05 完全一致。采购量按剩余窗口折算归 T-016（E-05）。

### 5. 滚动视图只在指向未来时刷新

`plan.md §5.3`：滚动速查「仅在指向未来周期时刷新」。`writePeriodicPlan()` 写前校验三层 `end_date > run_date`，否则抛 `ERR_PLAN_TIMELINE` 且**零写入**；同输入写出字节一致（幂等、Git 可 diff）。

### 6. 层级一致性与数据边界

`validatePlanHierarchy(parent, child)` 强制相邻层级 +1、上承 `period_id` 匹配、五类版本一致、九项处方一致、时令缓存一致（FR-006 / FR-027 / §9 不变式 1/2/4）。E-02 跨月周按「多数天数所属月份」定上承，另一月份写入 `link_references` 仅作衔接参考（实测 W49：11-30～12-06 → 上承 `2026-12`，衔接 `2026-11`）。

`locale_source` 只接受用户声明或已定义的自动来源枚举，**拒绝 `auto:inferred` 之类的静默推断**（P-12）；语言标签仅做 BCP 47 语法校验，未内置语言放行归 T-031。错误对象只含 ASCII 稳定码 + Canonical ID，计划对象不嵌入 `body` 字段（FR-049）。

## T-013 校验记录（2026-11-08）

| 项 | 结果 |
|----|------|
| 先红证据 | 实现前 `npm test`：52 条 / 51 pass / **1 fail**（`plan.test.js` 缺导出，整文件加载失败） |
| 转绿 / 全量 | `node --test tests/unit/plan.test.js` **18/18**；`npm test` **69/69** |
| 基线回归 | `npm run acceptance` **19/19 RED · 0 GREEN**；`npm run spec-check` PASS；CI 6 job 本地模拟 6/6 |
| 负向探针 | 见 `reviews/round-5/t013-negative.md` |
| 隐私 / 许可 | 新增 6 个源码文件 SPDX 齐备；核心域零 `node:` 直接 IO；真实数据令牌命中 0 |
