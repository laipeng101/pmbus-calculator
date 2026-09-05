# ADR 0005: 通用数值呈现单一事实源（canonical plain-number policy）

- 状态：Accepted
- 日期：2026-09-05
- 决策者：项目维护者

## 背景（Context）

2026-09 的呈现层审计确认：同一条「字段 → 公式 → 计算步骤 → 结果」用户链上，
同一领域数值的 plain-text 呈现规则存在多份独立实现：

- `src/app/view-model/format.ts` 的 `formatNumber`（finite-only：-0 / integer /
  12 significant digits；special values 由调用者另行走 `formatSpecial`）；
- `src/app/formula-presentation.ts` 的本地 `formatNumber` 与 `formatLatexNumber`
  （NaN / ±Infinity / -0 / integer / 12 significant digits 全量重复）；
- `src/app/calculation-steps.ts` 的本地 `formatNumber`（与 formula 层逐字相同）；
- 另有局部复制的 special 文本：`view-model/half.ts` 的 `resolveHalfValueText`
  内联 NaN / ±Infinity 分支、`calculation-steps.ts` overflow 步骤内联拼接
  `+Infinity` / `-Infinity`。

三处策略当前输出一致，但「大体一致」不是合同：任何一处单独修改都会让用户在
结果卡、公式、计算步骤之间看到互相矛盾的数字文本。

## 决策（Decision）

新建 `src/app/numeric-presentation.ts` 作为通用 plain-number 呈现的唯一事实源，
全部表面（结果 view-model、公式 plain text、计算步骤）只允许组合该层，不允许
重新实现数值规则：

```text
src/app/numeric-presentation.ts
  formatPlainNumber       NaN / ±Infinity / -0 / integer / 12 significant
                          digits（parseFloat(toPrecision(12)).toString()）
  formatPlainNumberLatex  KaTeX 适配：仅 NaN / ±Infinity 换 LaTeX 包装，
                          有限值（含 -0）逐字复用 formatPlainNumber
  formatSpecial           量化读数端点的 sign-explicit 变体：special 文本与
                          canonical 一致，零值恒带符号（'+0' / '-0'）
```

policy 语义：

| 输入类     | 输出                                          |
| ---------- | --------------------------------------------- |
| NaN        | `NaN`                                         |
| +Infinity  | `+Infinity`                                   |
| -Infinity  | `-Infinity`                                   |
| -0         | `-0`                                          |
| 整数       | `Number.prototype.toString`（最短精确十进制） |
| 其余有限值 | 12 位有效数字，尾零折叠                       |

- `view-model/format.ts` 不再持有数值文本规则：`formatNumber` 删除，五个
  view-model projector（l11/l16/direct/half/quantization）与 `formatSignedError`
  的自适应分支直接消费 `formatPlainNumber`；`formatSpecial` 迁入 canonical 模块。
- `formula-presentation.ts` 与 `calculation-steps.ts` 的本地 formatter 删除，
  LaTeX 包装收敛为 `formatPlainNumberLatex` 薄适配。
- `half.ts` 的内联 special 分支与 `calculation-steps.ts` 的 overflow 三元拼接
  改为组合 canonical。所有可达状态下输出逐字节一致（overflow 的 represented
  恒为 ±Infinity）；唯一不可达的 represented=NaN 状态从旧的 `'-Infinity'`
  收敛为 canonical `'NaN'`，属潜在改进而非回归。
- 层级单向：`numeric-presentation` 为无依赖纯模块，位于 formula-presentation、
  calculation-steps 与 view-model 之下；不复制 PMBus 数学、命令 metadata、
  raw 真值或舍入合同；领域计算不进入组件层。

## 后果（Consequences）

- 通用数值呈现事实源从 3 套独立 policy 收敛为 1 个 canonical policy；
  special 文本的内联副本（half、overflow 步骤）一并消除。
- 行为保持：`src/app/numeric-presentation.test.ts` 先行 characterization
  （27 个跨表面向量：NaN/±Infinity/±0、整数、12 位有效数字折叠、极大/极小
  有限值、DIRECT 指数结果、L11/L16 exact/quantized 请求、HALF 有限请求溢出）
  在重构前后逐字通过；视觉基线与 E2E 无变化。
- 新增呈现表面时必须组合本模块，而不是复制 `toPrecision(12)` 或 special 文本；
  LaTeX/单位/label 等上下文差异只允许以薄 adapter 表达。
