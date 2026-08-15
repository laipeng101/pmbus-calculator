# PMBus Calculator Web 重构规划

> 本文件只保留架构、原则与决策。里程碑状态见 [`ROADMAP.md`](ROADMAP.md)；
> legacy parity 与变更记录见 [`MIGRATION_MATRIX.md`](MIGRATION_MATRIX.md)；
> 领域规则见 [`DOMAIN_MODEL.md`](DOMAIN_MODEL.md)；ADR 见 [`adr/`](adr/)。

## 0. 文档状态

| 字段       | 内容                                          |
| ---------- | --------------------------------------------- |
| 文档类型   | Web 重构架构与原则                            |
| 最后更新   | 2026-08-15                                    |
| 状态数据源 | `docs/ROADMAP.md`、`docs/MIGRATION_MATRIX.md` |

## 1. 核心原则

1. **Web-first**：先重构 Web UI，再谈 PWA / App / single HTML。
2. **先迁移，再替换，再验证，最后删除**：不推倒重写。
3. **算法不重写**：PMBusMath 只允许机械迁移和带 golden case 的修复。
4. **数据不硬编码**：命令字典、模式配置、profile 必须来自统一数据层。
5. **逐模式闭环**：每个模式必须 Hex/bit ↔ raw ↔ 物理值双向打通后才算 Review/Done。
6. **质量门禁前置**：DIRECT 进入前必须通过 M4.5 稳定化门禁。

## 2. 当前资产盘点

`pmbus-calculator.html` 包含：

- PMBusMath 计算核心（L11/L16/DIRECT/HALF/PEC）
- `COMMAND_METADATA` 命令字典
- bit grid、命令选择、复制偏好、主题切换、debug boundary tests
- 移动端样式优化

这些是需要迁移和保护的资产。

## 3. 目标架构

```text
src/
├─ main.tsx
├─ App.tsx
├─ app/
│  ├─ state.ts / actions.ts / reducer.ts / view-model.ts / persistence.ts
├─ legacy/
│  ├─ pmbus-math.ts
│  └─ command-metadata.ts
├─ components/
│  ├─ layout/ mode/ command/ inputs/ bits/ result/ feedback/ debug/
├─ styles/
│  └─ tokens.css
tests/
├─ e2e/
├─ fixtures/
└─ *.test.ts
```

## 4. 状态模型

`AppState` 统一保存：

```ts
mode, raw, commandKey, byteOrder,
l11: { n, y, autoN, valueInput },
l16: { n, voutMode },
direct: { y, m, b, r },
copy: { prefix0x, spaceBetweenBytes, endian },
ui: { theme, debugOpen }
```

- 使用 `useReducer`。
- 偏好持久化集中在 `src/app/persistence.ts`。
- 主题由 `state.ui.theme` 驱动并写入 `document.documentElement.dataset.theme`。

## 5. ViewModel

UI 不重复格式化结果。`toCalculatorViewModel(state)` 输出：

```ts
mode, valueText, rawHex, rawBytesLE, rawBytesBE, formulaText,
deltaText, deltaKind, warnings, bitGroups, commandNote,
nRangeText, voutModeInfo, visible: { voutMode, directCoefficients, halfNote, nRange }
```

## 6. 样式与设计系统

- 颜色/阴影/字体一律使用 CSS variables（`tokens.css` 的 `@theme` 与 `data-theme`）。
- 主题：`:root[data-theme='light']`、`:root[data-theme='dark']`，`system` 由 JS 解析。
- 响应式必查断点：1440 / 1024 / 768 / 430 / 390 / 360。
- 禁止散落 `text-blue-600` 或任意 hex 颜色。

## 7. 迁移路线图

```text
M0 准备期            ✅ Done
M1 Vite+React+TS 骨架 ✅ Done
M2 Web 视觉框架      ✅ Done
M3 L11 闭环          ✅ Review
M4 L16/VOUT 闭环     ✅ Review
M4.5 稳定化门禁      🔄 Active
M5 DIRECT 闭环       ⬜ Todo
M6 HALF 闭环         ⬜ Todo
M7 Copy/工程输出     ⬜ Todo
M8 测试回归保护      ⬜ Todo
M9 legacy 下线/保留  ⬜ Todo
```

里程碑任务与验收的实时状态见 [`ROADMAP.md`](ROADMAP.md)。

## 8. 里程碑要点

### M3 L11

- 常规 Hex/Y/N/Value 闭环可用。
- 超范围 Value 必须饱和到 ±极限码（已修复并有 golden case）。

### M4 L16

- VOUT_MODE 推导 N、Value↔Raw 闭环、LE/BE 显示。
- 手动 V 输入必须 clamp 到 `0..65535`（已修复并有 reducer case）。

### M5 DIRECT（未开始，门禁通过后进入）

- `raw` 与 signed `Y` 只能有一个事实来源。
- Hex、bit、Y、Value、m/b/R 全部双向同步。
- profile 必须绑定器件与来源。

### M6 HALF

- `encodeHalf` 已修正 tie-to-even，但未接 UI。
- 需要 Value 输入与 sign/exp/mantissa 分区图例。

### M7 Copy/工程输出

- 复制偏好 UI 已接（0x/空格/LE-BE），持久化已统一。
- 剩余：clipboard 测试覆盖更完整、C 宏格式规范化。

### M8 测试回归

- 已：L11 golden、reducer/view-model 单测、Playwright 真实流程。
- 缺：L16/DIRECT/HALF golden-case 文件。

## 9. 测试策略

| 层     | 工具       | 覆盖                                      |
| ------ | ---------- | ----------------------------------------- |
| 算法层 | Vitest     | L11/L16/DIRECT/HALF/PEC 及边界            |
| 状态层 | Vitest     | reducer 状态迁移                          |
| 展示层 | Vitest     | viewModel 格式化与警告                    |
| E2E    | Playwright | 模式切换、Hex/Value/bit、命令、复制、主题 |

## 10. 设计验收标准

- 1440px 桌面双栏无空洞。
- 390px 移动端无横向滚动。
- 暗色模式所有文字可读。
- 输入有 label、按钮有可读名称、结果区域 `aria-live`、错误不只靠颜色表达。
