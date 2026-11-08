# `src/core/profile/` · 档案解析与校验（T-010）

> [AIGC] 审计追踪 ID：`RR-T010-20261108-0001` · 待人工审查（P-10）

**依据**：`tasks.md` T-010、`SPEC.md` FR-001 / FR-009 / E-08 / AC-01 / AC-12 / SC-014、`plan.md §3 / §4 / §5.1 / §5.3 / §6.1 / §9 / §10`、`constitution.md` P-01 / P-02 / P-04 / P-11 / P-14。

**范围**：`loadProfile(path, fsPort)` 与 `parseProfile(raw)` —— Profile 解析、schema 校验、四类版本号解析与比对、E-08 五类拒绝。核心域纯函数、零第三方依赖、纯 ESM、不注入 `clock` / `net`，只经 `FsPort.readJson` 读文件。

## 文件职责

| 文件 | 职责 |
|------|------|
| `errors.js` | `PROFILE_ERROR` 稳定码、`ProfileValidationError`（汇总 `issues`）、`issue()` |
| `iso3166-1.js` | ISO 3166-1 alpha-2 官方代码集（249 项只读常量）与 `isIso3166Alpha2()` |
| `validate.js` | `validateProfile(raw)` 纯校验；E-08 五类护栏与 BMR 数值下限 |
| `versions.js` | 四类数据版本 + `rule` 的校验 / 规范化 / `compareVersions()` |
| `load-profile.js` | `parseProfile()` 纯函数 + `loadProfile()` IO 入口 |
| `index.js` | 统一出口 |

## 设计决策与边界

### 1. 体脂阈值：`BODY_FAT_PCT_RANGE = [3, 70]`

`SPEC.md` / `plan.md` 未定义数值上下限，T-003 的 README 明确把精确阈值留给 T-010。此处取**闭区间 [3, 70] 的物理可行性边界**，只用于落实 E-08「身体数据明显异常」的拒绝，不是医学 / 营养学判断，也不写入规格（P-04）。两份虚构 fixture 的 20 与 28 均在区间内。若后续规格明确阈值，须**先改 `SPEC.md` 再改本常量**（P-01）。

### 2. 语言标签：只校验 BCP 47 语法，不校验是否内置

`E-11` 要求「请求语言无对应语言包 → 按 FR-042 回退链输出并标注缺失键，**不失败**」。因此 `loadProfile` 只拒绝**语法非法**标签（`zh_CN` / `中文` / `en--US` / 数字 / 空串等），语法合法但未内置（如 `pt-BR`、`xx-Private`）一律放行，回退链由 **T-031** 实现。用纯正则而非 `Intl.getCanonicalLocales`，避免不同 Node / ICU 构建的判定差异（NFR-004 / SC-002 三平台一致）。

### 3. 地区码：ISO 3166-1 alpha-2 只读表

零依赖且需跨三 OS × 三 Node 确定一致，故内置 249 项官方 alpha-2 代码（大写两字母严格匹配）。`null` 表示未声明（两份 fixture 即是），不触发校验。中国香港 `HK` / 中国澳门 `MO` / 中国台湾 `TW` 是**中国的地区级 ISO 3166-1 条目**，按 `E-14` 作为地区级选项处理，不是独立国家。区域到指南 / 历法 / 单位的映射属 **T-033**（`data/region/`），本目录不做映射。

### 4. `versions`：整体缺省才补默认值，部分缺省一律拒绝

`plan.md §5.1` 允许「fixture 缺省时由引擎补 `fixture-*` 默认值并在输出标注」。落地为：

- 整个 `versions` 缺省 → 五类（`body` / `rx` / `loc` / `st` / `rule`）全部补 `fixture-<key>`，`updated_at: null`，输出 `versioning = { source: 'fixture-default', defaulted: [五类] }`；
- **显式声明但缺任一类 → 拒绝**（`ERR_PROFILE_VERSION`），不猜测补齐；
- `updated_at: null` 是「未声明」的显式表示，**不猜测日期**（E-08：不得用猜测值填充）；
- 版本条目为 `{ id, updated_at, defaulted }`，`id` 为 ASCII 稳定键，`updated_at` 为 `YYYY-MM-DD` 或 `null`。

### 5. BMR 护栏按数值计算，不执行 `floor_rule` 字符串

`nutrition_rx.floor_rule` 在数据中是一句表达式文本（`"energy_kcal.min >= body.bmr_kcal"`）。引擎**直接比较 `energy_kcal[0] >= body.bmr_kcal` 数值**，绝不 `eval` / 解析该字符串，避免把数据当代码执行。等于 BMR 合法，低于即拒绝。

### 6. 错误消息零个人数据

`ProfileValidationError.message` 只由 `ERR_PROFILE_*` 稳定码拼接；`issues` 每项仅含 `{ code, field, hint }`，`hint` 是 ASCII Canonical ID（如 `action.profile.provide_bmr_kcal`），不含任何输入数值、路径或自然语句。面向人的文案由 **T-019 CLI** 经 **T-031 语言包**渲染（P-11 / FR-049 / `plan.md §9`）。`ERR_FS_*` 端口错误原样传播；JSON 语法错误被包装为 `ERR_PROFILE_JSON`，不透传可能含文件内容的原生 `SyntaxError.message`。

### 7. 「版本号比对」只提供基础能力，不触发重算

`compareVersions(current, expected)` 返回发生变化的版本键（按 `VERSION_KEYS` 顺序）。「版本变更 → 重算未执行计划」是 **T-012 `detectVersionChanges(profile, planHeader)`** 的职责，本任务不越界实现重算、时间线切分或历史文件保护。

## 错误码对照

| 稳定码 | 触发条件 | 修复动作 ID |
|--------|----------|-------------|
| `ERR_PROFILE_JSON` | 档案不是合法 UTF-8 JSON | `action.profile.valid_utf8_json` |
| `ERR_PROFILE_SCHEMA` | 顶层结构 / 必填字段 / 区间格式 / `floor_rule` 不合规 | `action.profile.*` |
| `ERR_PROFILE_BMR_MISSING` | `body.bmr_kcal` 缺失或不是有限正数 | `action.profile.provide_bmr_kcal` |
| `ERR_PROFILE_BODY_FAT_RANGE` | 体脂越界或非数值 | `action.profile.body_fat_pct` |
| `ERR_PROFILE_ENERGY_FLOOR` | `energy_kcal[0] < bmr_kcal` | `action.profile.energy_floor` |
| `ERR_PROFILE_LANGUAGE_TAG` | `output_language` 不是合法 BCP 47 | `action.profile.language_tag` |
| `ERR_PROFILE_REGION_CODE` | 国籍 / 居住地不是 ISO 3166-1 alpha-2 | `action.profile.region_code` |
| `ERR_PROFILE_VERSION` | `versions` 结构不完整 / 日期非法 / 未知键 | `action.profile.version_*` |
| `ERR_PROFILE_PRIVACY` | `privacy` 四项声明不合规 | `action.profile.privacy_contract` |

> `ERR_FS_NOT_FOUND` / `ERR_FS_PATH_ESCAPE` 由 `src/io/ports.js` 定义并原样传播，不在本表。

## 与其它任务的边界

- **T-003** 的「`body` 11 项 / `locale_policy` 7 项 / `privacy` 4 项齐备」是对两份**虚构 fixture 的静态校验**；运行时只强制 E-08 护栏与顶层结构，其余字段「存在则校验类型、缺失不拒绝」，避免误拒后续任务产出的档案。
- **AC 仍为红态**：AC-01 还需 T-011 `computeRx` + T-013 计划生成 + T-018 渲染；AC-12 还需 T-020 / T-021 / T-042。T-010 **不转绿任何 AC**、不改 `ac-*.md` 状态、不勾 `tasks.md` 的 `- [ ]`（P-02 / `tasks.md §1`）。
- 不修改 `SPEC.md` / `plan.md` / `tasks.md` / `constitution.md` / `package.json` / 两份 fixture JSON；不新增架构层，全部文件落在 `plan.md §4` 已声明的 `src/core/profile/`。
- 单测为 `tests/unit/profile.test.js`（`*.test.js`，由 `npm test` 自动发现）；验收驱动仍在 `tests/acceptance/`，两者隔离（`tasks.md §2`）。

## 测试

```bash
node --test tests/unit/profile.test.js   # T-010 单测
npm test                                 # 全部单测
npm run acceptance                       # 应仍为 19/19 RED
```

先红后绿：实现产出前 `profile.test.js` 因 `ERR_MODULE_NOT_FOUND` 失败（红态证据），实现落盘后转绿。负向用例覆盖 E-08 五类拒绝、部分 `versions` 拒绝、错误脱敏、IO 错误码传播、无网络依赖。
