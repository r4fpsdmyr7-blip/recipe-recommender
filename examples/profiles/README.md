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

| 字段 | 含义 |
|------|------|
| `fixture_id` | 稳定标识，供 ATDD 场景引用 |
| `fictional` | **必须为 `true`**；CI 静态扫描校验 |
| `notice` / `notice_en` | 虚构性声明（多语言示例） |
| `body` | 合成身体数据；`bmr_kcal` 为合成基线值 |
| `nutrition_rx` | 由 `body` 推导的目标区间；`floor_rule` 表达「总能量不得低于 BMR」不变式 |
| `locale_policy` | 国籍 / 居住地声明、用户覆盖、输出语言与**预期解析结果**（供 AC-16 断言） |
| `privacy` | 本地化与零上传标记 |

`CDG-2022` / `solar-terms` / `generic-guideline` 等为**占位策略标识符**，仅用于说明区域策略解析与覆盖优先级，本仓库不内置任何指南原文、图表或受版权保护内容（SPEC FR-032）。

## 在 ATDD 中使用

```
Given 使用完全虚构的示例档案 FIX-GLOBAL-AVG-M-01
When  生成或刷新任一周期计划 / 以 la 输出
Then  ...
```

具体断言见 [`../../SPEC.md` §8](../../SPEC.md)。

> [AIGC] 生成 · 审计追踪 ID：`RR-FIXTURES-20261106-0001`
