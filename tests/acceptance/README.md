# AC 验收驱动 · 红态基线（T-004）

> [AIGC] 审计追踪 ID：`RR-T004-20261107-0001` · 待人工审查（P-10）

## 这是什么

`SPEC.md §8` 的 19 条 Gherkin 场景，逐字复制到 `ac-01.md` … `ac-19.md`，全部登记为 **RED**。P0 出口门禁已通过、P1 已开工；19 条 AC 仍全部为红，可执行业务断言由 T-010 起的实现任务按 P-02 逐条补齐——这正是 ATDD「先红后绿」的过程。

每个 `ac-XX.md` 含：状态、规格来源、FR/SC 映射、主责任务（`tasks.md §4.2`）、红态原因、快照位、逐字场景、**红→绿记录**表。

## 运行

```bash
npm run acceptance                       # node scripts/acceptance.mjs --ac all
node tests/acceptance/run.mjs --ac 01    # 单条
```

驱动做的事：

1. 从 `SPEC.md §8` **实时提取** 19 条场景文本（SPEC 是唯一权威）；
2. 与每个 `ac-XX.md` 的场景**逐字比对**，任何删改、跳过或弱化立即报错（P-09 / RK-03）；
3. 校验每条状态为 `RED`、快照位已登记且文件存在；
4. 输出 `AC / 状态 / 场景比对 / 快照位` 状态表与 `N/N RED` 汇总。

**`exit 0` 的含义**：红态基线**完整有效**，不是「验收通过」。P0 出口门禁（T-006）要求 AC-01～19 全部为红；进入 P1 后仍保持全红，直到各实现任务按 P-02 逐条转绿（T-022 才启用全绿门禁）。CI 的 `acceptance` job 以「全红」为通过条件，不得靠删场景换绿。

## 命名护栏（勿违反）

- 本目录**不得**出现 `*.test.js` / `*.test.mjs`：`npm test` 用 `node --test` 无参数自动发现，会误跑红态场景（原因见 `tasks.md §2`）。
- 驱动入口 `run.mjs`；`package.json` 的 `acceptance` script 经 `scripts/acceptance.mjs` 调用它。
- T-006 搭 CI 时须把 `unit` 与 `acceptance` 隔离为两个 job。

## 转绿规则

| 阶段 | 动作 |
|------|------|
| P0 出口后 / P1 进行中 | 19 条全 RED，驱动校验基线完整性；实现任务逐条补可执行断言 |
| T-010 起 | 各实现任务只把自己映射的 AC 转绿，并在 `ac-XX.md` 的「红→绿记录」登记时间、状态与提交 |
| T-006 / T-022 | CI 隔离 unit / acceptance；P1 出口 AC-01～12 全绿 |
| 全程 | 未满足「AC 转绿 + CI 全绿 + DoD」不得把 `tasks.md` 的 `- [ ]` 改为 `- [x]` |
