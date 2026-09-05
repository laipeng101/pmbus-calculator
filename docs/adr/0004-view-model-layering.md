# ADR 0004: view-model 层次化——共享装配 + 模式级纯投影

- 状态：Accepted
- 日期：2026-09-05
- 决策者：项目维护者

## 背景（Context）

v3.1.0 之前，`src/app/view-model.ts` 是约 1117 LOC 的单文件，同时承载五个模式
（L11 / L16 / VOUT_MODE / DIRECT / HALF）的值投影、warning/error 语义、量化读数、
copy/serialization 装配与公共 view-model 组装。领域 helper（`l16-payload-contract`、
`vout-mode-requirements`、`relative-voltage`、`direct-exact`、`quantization-error` 等）
已逐步单一来源化，但最终投影仍汇入同一个大文件。

实际维护成本已经显性化：PR #92（canonical Raw Word 重构）第一次 verify 暴露了
accessible name、术语 DOM placement、持久化测试依赖、L16 旧字节流文案、stale
surface 五类跨表面耦合问题。对单一维护者而言，跨模式聚合文件意味着任何局部领域
变更都要面对整个文件的回归半径。

## 决策（Decision）

把 `view-model.ts` 重构为 `src/app/view-model/` 层（公共行为保持不变，
characterization corpus 先行锁定），公共入口与导出形状不变：

```text
src/app/view-model/
  index.ts          共享装配：canonical raw、serialization/copy 公共字段、模式 dispatch
  types.ts          全部公共 VM 接口（唯一导出面）
  format.ts         纯呈现格式化（hex/number/signed error/special/bit groups）
  l11.ts            L11 投影：值文本、饱和警告、N 范围
  l16.ts            L16 投影：值文本、payload 合同卡、VOUT_MODE 关联信息、相对诊断、复制可用性
  direct.ts         DIRECT 投影：值文本、精度折叠（fidelity）与折叠警告
  half.ts           HALF 投影：值文本、§7.6.2 特殊值语义
  vout-mode.ts      VOUT_MODE 字节投影（L16 与独立页共享）：InfoVM、字节级警告
  value-text.ts     模式 dispatch + 共享 fail-closed catch
  warnings.ts       警告聚合、命令参考只读注记、历史推送顺序
  quantization.ts   量化读数呈现（exact/quantized/saturated/overflow/special → kind/text/note）
```

依赖方向单向：`index → {value-text, warnings, quantization, l16, direct, half,
vout-mode, l11, format, types}`；`warnings → {l11, direct, l16, vout-mode}`；
`l16 → vout-mode`。无循环依赖。模式专属数学、warning 文案 policy 与量化 policy
不进入 `index.ts`；projector 只复用既有领域单一来源，不复制公式、命令 metadata、
VOUT_MODE 位域或舍入 policy；不把领域逻辑推回 React 组件；`state.raw` 保持唯一
canonical 真值。

## 后果（Consequences）

- 模式级变更的 blast radius 收敛到单个 projector 文件 + 对应 characterization
  断言；共享装配层稳定。
- 公共行为由 `src/app/view-model.characterization.test.ts` 与既有
  `view-model.test.ts` 双层锁定；视觉基线与 E2E 不因本重构变化。
- 新增模式表面时在层内加 projector/类型，不再扩展单文件。
