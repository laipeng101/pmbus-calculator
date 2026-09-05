# ADR 0006: L16/VOUT 语义事实单一事实源（canonical semantic derivation）

- 状态：Accepted
- 日期：2026-09-05
- 决策者：项目维护者

## 背景（Context）

2026-09 的呈现层审计（继 ADR 0005 收敛数值文本 policy 之后）确认：L16 / VOUT_MODE
的**跨表面语义推导**同样存在多份独立实现。同一条「字段 → 公式 → 计算步骤 → 结果」
链上，下列语义判定各自重复推导：

- 共享 VOUT_MODE 字节是否 LINEAR、`effectiveL16VoutMode` 的 linked/non-linear
  分派；
- payload 解释（absolute ULINEAR16 / relative 比值 / SLINEAR16 有符号偏移 /
  非 LINEAR fail-closed）；
- 指数 N（`linearExponent ?? 0` 的重复兜底）；
- relative 乘积的 missing-reference / finite / overflow / underflow 分类；
- 非 LINEAR 的原因合同（VID profile、§13.3/§13.4 offset 禁止、DIRECT 系数、
  Half 范围、保留/非法字节）。

重构前的静态清单（行为保持重构的证据基线）：

| 独立推导点                                              | 处数                                                                                                                                   |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 独立解释决策树                                          | 4（`formula-presentation.ts`、`calculation-steps.ts`、`view-model/l16.ts` 的 6 个 resolver、`quantization-error.ts` 的 2 个 L16 分支） |
| `effectiveL16VoutMode` 呈现调用点                       | 10（formula 1、steps 1、view-model/l16 5、warnings 1、quantization 2）                                                                 |
| L16 相关 `analyzeVoutMode` 呈现调用点                   | 9                                                                                                                                      |
| `resolveRelativeVoltage` 调用点（每次 VM 构建实际执行） | 5（formula、steps、valueText、diagnostics、physical copy）                                                                             |
| L16 payload decode 调用点                               | 10                                                                                                                                     |

一致性当时由多处分支与测试共同维持，而不是由一个 typed fact object 保证；
任何一处单独修改都会让结果卡、公式、步骤、警告与复制之间出现语义矛盾。

## 决策（Decision）

新建 `src/app/l16-derivation.ts`，入口 `deriveL16Semantics(state): L16Semantics`，
作为 L16 页**呈现面向语义事实**的唯一事实源。层级单向（镜像 ADR 0005）：

```text
legacy/vout-mode + legacy/pmbus-math          （受保护算法，零变更）
  → vout-mode-selector / l16-payload-contract / relative-voltage
      （既有单域原语，各司其职，被组合一次）
    → l16-derivation（纯函数 state → facts）
      → formula-presentation / calculation-steps / quantization-error /
        view-model/*（只渲染，不再重分类）
```

facts 编码领域事实，不编码组件布局、KaTeX 字符串或文案：

```text
L16Semantics
  analysis        VoutModeAnalysis（字节真值：format/isRelative/parameter/
                  linearExponent/vidCode/status/reason）
  source          'linked' | 'non-linear'（§8.4 fail-closed 分派）
  payloadKind     'ulinear16' | 'slinear16-offset'
  payloadContext  L16PayloadContext（字节 × payload 判别合同，v2.5.3）
  interpretation  L16RawInterpretation——判别联合：
                  'non-linear'（原因看 payloadContext.semantics）
                  'signed-offset'  { n, y, value }（任意 LINEAR 字节，bit7 不参与）
                  'relative-ratio' { n, ratio, nominal, finalVoltage }
                                    （finalVoltage: missing-reference/finite/
                                      overflow/underflow）
                  'absolute-unsigned' { n, value }
```

- 解释顺序逐字复现历史合同：非 LINEAR fail-closed 优先，其次 signed-offset
  payload，再次 relative 比值，最后 absolute 无符号。`finalVoltage` 继续由
  `relative-voltage.ts` 分类——missing / 零 / 下溢 / 溢出不可混淆（v2.5.9/v2.6.4
  合同不变）。
- 全部消费方（结果 value text、公式呈现、计算步骤、warnings、物理值复制、量化
  outcome 的 L16 分支）改为消费 facts；每个消费方内部各调用一次
  `deriveL16Semantics`（纯位运算 + 至多一次 decode，成本与原先多次重推导相当），
  不引入第二个状态存储、不做双向同步。
- 不改变受保护算法、raw 合同、字节序、VOUT_MODE 位布局、命令 metadata、持久化、
  公共措辞、DOM/a11y 与视觉基线。`view-model/l16.ts` 中已无外部消费者的
  `resolveL16Relative` 一并移除（其职责由 facts 承担）。
- 残余直接调用均有界外职责（见测试文件头注释）：`reducer.ts`（状态事务与输入
  校验）、`bit-regions.ts`（位网格编辑器）、`view-model/vout-mode.ts` 与
  `calculation-steps.ts` 的 `buildVoutModeSteps`（VOUT_MODE 字节配置页自身表面，
  已有 `resolveVoutModeRequirement` 单一来源）、以及各单域原语模块自身。

## 后果（Consequences）

- 独立解释决策树从 4 份收敛为 1 份；公式/步骤/量化/结果/警告/复制中
  `effectiveL16VoutMode`、`analyzeVoutMode`、`resolveRelativeVoltage`、payload
  decode 的直接呈现调用点归零（全部经 facts 层）。
- 行为保持：15 行语义矩阵先在重构前以表面合同锁定
  （`src/app/l16-semantic-matrix.test.ts`，19 用例：absolute/relative × nominal
  缺失/零/有限、比值零、溢出、下溢、signed offset（含 relative 字节）、VID（含
  1Eh）、DIRECT、Half、保留/非法组合、器件资料 fail-closed、raw 边界），重构后
  逐字通过；facts 分类合同由 `src/app/l16-derivation.test.ts` 锁定。
- 新增 L16 呈现表面时必须组合 `deriveL16Semantics`，不得重新推导解释判定；
  表面差异（文案、LaTeX、label）只允许存在于消费方。
- 领域语义变更（例如新的 payload 合同）现在只需修改 facts 层与
  `l16-payload-contract`，跨表面文案由测试矩阵守护同步。
