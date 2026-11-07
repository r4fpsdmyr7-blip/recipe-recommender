# 示例档案 · Example Profiles

> **完全虚构 / FICTIONAL ONLY**

本目录仅有两份示例档案，均为**凭空合成的全球平均量级数据**：

| 文件 | 标识 | 用途 |
|------|------|------|
| `global-average-male.json` | `FIX-GLOBAL-AVG-M-01` | 男性合成档案；AC-01（处方与 BMR 护栏）、AC-15（多语言）默认 fixture；演示**无国籍/居住地 → 回退中立基线** |
| `global-average-female.json` | `FIX-GLOBAL-AVG-F-01` | 女性合成档案；AC-16 / AC-18 fixture；演示**用户显式覆盖**（指南 + 节气历 + 拉丁语输出） |

## 合规声明

- 两份档案的所有数值均为**虚构合成值**，**不代表任何真实个人**，**不是**任何统计资料的引用、计算或结论。
- 仓库**不包含** `../diet-plan/` 的任何真实身体数据、计划、台账或档案副本；`../diet-plan/` 仅作方法论参照（SPEC FR-034 / FR-035 / FR-053）。
- 示例**不含**姓名、联系方式、身份证号、设备标识、位置轨迹等可识别个人数据。
- 请**不要**把真实体测数据写进本目录或提交到仓库。真实档案请放在本机 `profiles/`（已被 `.gitignore` 忽略），或任何本地路径。
- 本项目为纯本地处理、零上传（SPEC FR-047～050）；本目录文件随仓库分发，故必须永久保持虚构性。

## Schema v0.1.0-fixture（说明性）

字段契约以 [`plan.md §5.1`](../../plan.md) 为准，下表区分「Profile 契约字段」与「fixture 专有字段」。

### Profile 契约字段（`plan.md §5.1`）

| 字段 | 类型 | 说明 |
|------|------|------|
| `schema_version` | string | Profile schema 版本；两份均为 `0.1.0-fixture` |
| `fictional` / `notice` | bool / string | **仅示例档案必填**，且 `fictional` 必须为 `true`；CI 静态扫描校验 |
| `body` | object | `height_cm` `weight_kg` `bmi` `body_fat_pct` `water_pct` `bmr_kcal` `muscle_kg` `bone_kg` `protein_pct` `age_years` `sex` 共 11 项；`bmr_kcal` 为合成基线值 |
| `nutrition_rx` | object | 各项目标区间 `[min, max]` + `floor_rule`（表达「能量下限 ≥ `body.bmr_kcal`」不变式） |
| `goal` | object | 目标类型 `type` + `note_key`（Canonical ID，不存自然语句） |
| `locale_policy` | object | `declared_nationality` / `declared_residence` / `guideline_override` / `calendar_override` / `output_language` / `expected_resolution` / `expected_source` 共 7 项；后两项供 AC-16 断言 |
| `privacy` | object | `storage: "local-only"`、`upload: false`、`telemetry: false`、`real_person_data: false` |
| `versions` | object | 四个数据版本 + 当前 `rule-` 版本（FR-001 / FR-009）。**两份 fixture 有意省略**，见下节 |

### fixture 专有字段（非 Profile 契约）

| 字段 | 说明 |
|------|------|
| `fixture_id` | 稳定标识，供 ATDD 场景引用（`FIX-GLOBAL-AVG-M-01` / `FIX-GLOBAL-AVG-F-01`） |
| `notice_en` | 英文虚构性声明，与 `notice` 并列（多语言示例） |
| `usage` | 说明该 fixture 的验收用途与免责口径 |
| `label_key` | Canonical ID，供语言包渲染（`plan.md §5.4`：只处理 ASCII 稳定键） |

### `versions` 为何缺省

`plan.md §5.1` 明确允许：「**fixture 缺省时由引擎补 `fixture-*` 默认值并在输出标注**」。因此省略 `versions` 是**合法最小实例**的刻意设计，不是字段缺失；引擎级补齐由 **T-010 `loadProfile`** 承担，本目录不预填猜测值（E-08：不得用猜测值填充）。请勿在后续任务中把 `versions` 当作缺陷回填。

`CDG-2022` / `solar-terms` / `generic-guideline` 等为**占位策略标识符**，仅用于说明区域策略解析与覆盖优先级，本仓库不内置任何指南原文、图表或受版权保护内容（SPEC FR-032）。

## 在 ATDD 中使用

```
Given 使用完全虚构的示例档案 FIX-GLOBAL-AVG-M-01
When  生成或刷新任一周期计划 / 以 la 输出
Then  ...
```

具体断言见 [`../../SPEC.md` §8](../../SPEC.md)。

## T-003 · 合法最小 Profile 实例校验（2026-11-07）

**依据**：`plan.md §5.1`（Profile 数据契约 + E-08 校验规则）、`SPEC.md` FR-034 / FR-035、AC-01 / AC-12 / AC-15 / AC-16 / AC-18、SC-014，`constitution.md` P-06 / P-14，`tasks.md` T-003。

**结论**：两份 fixture **全部通过**（每份 19 项字段/规则检查 + 5 项跨文件与仓库级检查，零 FAIL），均为**合法最小 Profile 实例**，可直接作为 AC-01 / AC-15 / AC-16 的 Given，并满足 AC-12 / AC-18 / SC-014 的静态前提。校验为纯静态检查：未新增实现代码、未新增依赖、未新增文件。

### 逐项结果

| 校验项 | `FIX-...-M-01` | `FIX-...-F-01` | 依据 |
|--------|----------------|----------------|------|
| `fictional === true` + 中英虚构性声明 | ✅ | ✅ | FR-034 / AC-18 / P-14 |
| `body` 11 字段齐备 | ✅ | ✅ | `plan.md §5.1` |
| `bmr_kcal` 存在 | 1450 | 1200 | E-08 |
| 体脂未越界 | 20.0 | 28.0 | E-08（注 1） |
| 能量下限 ≥ BMR | 1550 ≥ 1450 | 1300 ≥ 1200 | E-08 / AC-01 |
| `protein_g` 区间 | 88–100 | 72–85 | AC-01 |
| BMI 自洽 | 23.03 ≈ 23.0 | 22.60 ≈ 22.6 | 数据自洽性 |
| `output_language` 合法且属内置七语言 | `en` | `la` | E-08 / FR-040 |
| `locale_policy` 7 字段 / `privacy` 4 字段 | ✅ | ✅ | `plan.md §5.1` |
| `label_key` / `note_key` 为 Canonical ID | ✅ | ✅ | `plan.md §5.4` |
| 无真实身体数据令牌 | ✅ | ✅ | P-14 / AC-18 / SC-014 |
| `versions` 缺省 | 允许 | 允许 | `plan.md §5.1`（见上节） |

**注 1**：`SPEC.md` 与 `plan.md` 未给出体脂的数值上下限，本次只确认两份数值落在常见成人合理区间、未触发 E-08 越界条件；精确阈值由 **T-010 `loadProfile`** 定义，并在 **T-004** 的 E-08 场景中登记为红态断言，此处不自行发明阈值。

### E-08 五条校验规则

| 规则 | 结果 |
|------|------|
| 缺 `bmr_kcal` | 两份均有，PASS |
| 体脂越界 | 未越界，PASS（见注 1） |
| 能量下限 < BMR | 1550 ≥ 1450、1300 ≥ 1200，PASS |
| 语言标签非法 | `en` / `la` 均为合法 BCP-47 基础标签且在内置七语言内，PASS |
| 地区码不在 ISO 3166-1 | 两份 `declared_nationality` / `declared_residence` 均为 `null`，不触发校验，PASS |

### 与验收场景的对齐

| AC / SC | 对齐情况 |
|---------|----------|
| **AC-01** | Given 的「168 cm / 65 kg / 体脂 20% / BMR 1450 kcal」与 M-01 逐值一致；Then 的能量 1550–1700 kcal、蛋白 88–100 g 与 `nutrition_rx` 一致 |
| **AC-15** | 两份均带中英 `notice`、Canonical ID 与 `output_language`；七语言输出由 CLI `--lang` 覆盖（T-019），不复制 fixture |
| **AC-16** | M-01 → `auto:fallback`（第三场景：无声明，回退中立基线）；F-01 → `user`（第二场景：显式覆盖 `CDG-2022` + `solar-terms` + `la`）。**第一场景「仅声明国籍」由 T-004 的驱动构造运行时 Profile 承担，不新增第三份示例**——AC-18 要求示例恰为两份、FR-034 要求男女各一份 |
| **AC-12** | `.gitignore` 的 `/profiles/` 已忽略真实个人档案；本目录仅含虚构示例 |
| **AC-18 / SC-014** | 示例恰两份、男女各一、均标注「完全虚构 / 非真实个人 / 非统计引用」；仓库不含 `diet-plan` 真实数据 |

### 本次边界声明

- **未修改两份 JSON**：`fictional: true` 与中英虚构性声明在 M0′（提交 `c646141`）已存在，T-003 复核确认合规，**不重复添加、不改写任何数值或字段**。
- **未修改 `SPEC.md`**：本次无行为变更，FR / AC / SC / P 编号与业务语义保持不变（P-01）。
- **AC 仍为红态**：AC-01 / AC-12 / AC-18 尚未由 T-004 建立红态基线，更未转绿；`tasks.md` 的 T-003 保持 `- [ ]` 未勾选（`tasks.md §1` / P-02）。
- **不新增校验器文件**：引擎级 schema 校验属 T-010 产出（`src/core/profile/`）；`tasks.md` T-003 的产出列仅含 `examples/profiles/*.json` 与 `examples/profiles/README.md`。
- 本校验记录经**用户人工审查**后方可作为基线（P-10）；AI 不自行批准。

> [AIGC] 示例档案生成 · 审计追踪 ID：`RR-FIXTURES-20261106-0001`　|　T-003 校验与文档补强 · 审计追踪 ID：`RR-T003-20261107-0001`（待人工审查，P-10）
