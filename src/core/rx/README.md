# `src/core/rx/` + `src/core/guideline/` · 每日处方与指南适配器（T-011）

> [AIGC] 审计追踪 ID：`RR-T011-20261108-0001` · 待人工审查（P-10）

**依据**：`tasks.md` T-011、`SPEC.md` FR-002 / FR-003 / FR-032 / E-09、AC-01 / AC-16 / SC-003、`plan.md §4 / §5.1 / §6.1 / §8 / §9`、`constitution.md` P-04 / P-11 / P-12。

**范围**：`computeRx(body, guidelineAdapter)` 由身体数据推导九项每日营养处方，强制 BMR 与保肌下限护栏，输出「当前生效膳食指南适配器」的结构化对照表；`src/core/guideline/` 提供可插拔适配器契约、校验与加载；`data/guideline/` 存放中立通用基线的量化指标。核心域纯函数、零第三方依赖、纯 ESM，不直接 import `node:fs`，不注入 `clock` / `net`。

## 文件职责

| 路径 | 职责 |
|------|------|
| `data/guideline/generic-guideline.json` | 中立通用基线的量化系数 / 目标 / 硬约束（唯一数据源） |
| `src/core/guideline/contract.js` | `RX_ERROR` 稳定码、`RxValidationError`、`validateGuidelineAdapter()`、允许键集 |
| `src/core/guideline/loader.js` | `loadGuidelineAdapter(fsPort, id)`，经注入端口读取并校验 |
| `src/core/guideline/index.js` | 统一出口 |
| `src/core/rx/compute-rx.js` | `computeRx()` 推导、护栏、对照表 |
| `src/core/rx/index.js` | 统一出口 |

## 设计决策与边界

### 1. 推导公式与系数全部由适配器提供（FR-003 可插拔）

`computeRx` 不内置任何营养学常量，九项处方 = `body` × 适配器 `coefficients`：

| 指标 | 推导 |
|------|------|
| `energy_kcal` | `bmr_kcal × energy_factor`，取整到 10 kcal |
| `protein_g` | `weight_kg × protein_g_per_kg`，取整到 0.1 g |
| `fat_g` / `carb_g` | 能量 × 供能占比 ÷ 9 / 4（kcal per g） |
| `fiber_g` / `water_ml` | 适配器区间 / `weight_kg × water_ml_per_kg` |
| `salt_g` / `oil_g` / `added_sugar_g` | 适配器 `targets` |

换一个合规适配器即可改变全部推导结果（单测已覆盖）。**默认适配器由 FR-045 区域策略解析是 T-032 / T-033 的职责**；本任务只提供 `generic-guideline`（`source: 'neutral-baseline'`）作为无匹配时的显式回退基线，不做任何国籍 / 居住地推断（P-12）。

### 2. 系数是「项目自撰的引擎量化参数」，不是指南原文

`generic-guideline` 的系数（能量系数 1.10–1.15、蛋白 1.4–1.5 g/kg 等）是为确定性演示与 ATDD 对齐而设的中立量级参数，**不代表任何特定膳食指南的结论，也不是医学 / 营养学建议**，不写入规格（P-04）。落实 FR-003 / FR-032：

- 数据文件只允许固定键集（`id` / `version` / `source` / `notice_key` / `coefficients` / `protein_floor_g_per_kg` / `targets` / `limits`），**任何额外键一律拒绝加载**——既防复制原文 / 图表，也防注入（E-09）；
- 无外部 URL、无中文原文段落、无图片 / PDF 引用；单测静态断言；
- 真正的第三方数据源（含许可声明、版本号、来源 URL）归 **T-035**，本目录不内置。

**数据文件命名约定**：文件名必须与 `id` 一致（`generic-guideline.json` ↔ `id: generic-guideline`），加载器按 `data/guideline/<id>.json` 拼接，`id` 经 `^[a-z0-9][a-z0-9-]{0,63}$` 白名单化以防路径穿越。

### 3. AC-01 对齐（两份虚构 fixture 实测）

| fixture | BMR | 推导能量 | 推导蛋白 | 对照表 | 护栏调整 |
|---|---|---|---|---|---|
| `FIX-GLOBAL-AVG-M-01` | 1450 | `[1600, 1670]`（⊆ 1550–1700） | `[91, 97.5]`（⊆ 88–100） | `compliant: true` | 无 |
| `FIX-GLOBAL-AVG-F-01` | 1200 | `[1320, 1380]` | `[77, 82.5]` | `compliant: true` | 无 |

盐 `[0, 4.5]` < 5 g、油 `[25, 30]` g、添加糖 `[0, 20]` < 25 g，全部 `status: 'within'`。

> 这里的「对齐」是**单元级**：T-011 让 AC-01 的数值与上限约束有了可执行实现，但 AC-01 的 When 是「生成或刷新任一周期计划」，仍需 **T-013 计划生成 + T-018 渲染**才能真正转绿；AC-16 仍需 **T-032 / T-033**。因此两条 AC 继续保持 **RED**，`tasks.md` 不勾选（P-02）。

### 4. 护栏是「强制抬升 + 留痕」，不是简单报错

FR-002 要求总能量不得低于 BMR、蛋白不得低于保肌下限。若适配器系数导致推导值越界，`computeRx` 把下限抬到护栏值（能量向上取整到 10 kcal、蛋白向上取整到 1 g），同步抬高上限以保持区间有序，并在 `guardrails` 标 `energy_adjusted` / `protein_adjusted`。抬升后仍无法满足则抛 `ERR_RX_GUARDRAIL`。这落实 `SPEC.md §9` 不变式 1 与 SC-003。

### 5. 对照表是结构化数据，渲染归 T-018

`comparison` 含 `adapter_id` / `adapter_version` / `source` / 九行 `rows`（`key` / `min` / `max` / `limit_min` / `limit_max` / `status`）/ `violations` / `compliant`。全部键为 ASCII Canonical ID（P-11）；Markdown 表格与「当前生效膳食指南适配器」标题由 **T-018** 经 **T-031 语言包**渲染，本任务不输出自然语言。若任一行 `violation`，抛 `ERR_RX_LIMIT`（FR-003 硬约束）。

### 6. 来源标注只透传，不推断

`guideline.source` 与 `comparison.source` 原样来自适配器，`notice_key` 供语言包渲染免责 / 说明。计划头部的 `auto:nationality` / `auto:residence` / `user` / `auto:fallback` 来源标注，以及 IP / 定位禁用断言，属 **T-032 / T-033 / AC-16**，本任务不实现。

### 7. 错误码

| 稳定码 | 触发条件 |
|--------|----------|
| `ERR_RX_INVALID` | 聚合错误码（在 `RX_ERROR` 内可枚举） |
| `ERR_RX_BODY` | `bmr_kcal` / `weight_kg` 缺失或非有限正数 |
| `ERR_RX_ADAPTER` | 适配器契约不合规 / 目标违反自身上限 / 非法 id / 未注入 fsPort |
| `ERR_RX_JSON` | 数据文件不是合法 UTF-8 JSON（不透传原生 `SyntaxError.message`） |
| `ERR_RX_GUARDRAIL` | 护栏抬升后区间仍无法自洽 |
| `ERR_RX_LIMIT` | 对照表出现越界行 |

`RxValidationError.message` 只由稳定码拼接，`issues` 仅含 `{ code, field, hint }`，`hint` 为 ASCII Canonical ID；零身体数值、零自然语句（FR-049 / plan.md §9 / P-11）。`ERR_FS_*` 由 `src/io/ports.js` 定义并原样传播。

## 测试与边界

```bash
node --test tests/unit/rx.test.js   # T-011 单测 12 条
npm test                            # 全部单测
npm run acceptance                  # 仍应为 19/19 RED
```

先红后绿：实现产出前 `rx.test.js` 因 `ERR_MODULE_NOT_FOUND` 失败；实现落盘后转绿。单测覆盖 FR-002 九项、AC-01 区间与上限、BMR / 保肌护栏、可插拔适配器、FR-032 固定键集、路径穿越、IO 错误码传播、错误脱敏、与 T-010 的 fixture 衔接、纯函数确定性。

**不修改** `SPEC.md` / `plan.md` / `tasks.md` 正文 / `constitution.md` / `package.json` / 两份 fixture JSON；不新增架构层，全部落在 `plan.md §4` 已声明的 `src/core/rx/`、`src/core/guideline/`、`data/guideline/`。单测为 `tests/unit/rx.test.js`（`*.test.js`），与 `tests/acceptance/` 隔离（`tasks.md §2`）。
