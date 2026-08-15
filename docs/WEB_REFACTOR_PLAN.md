# PMBus Calculator Web 重构规划与代码同步追踪文档

> 文件建议路径：`docs/WEB_REFACTOR_PLAN.md`  
> 当前阶段重点：**99% 聚焦 Web 设计重构**  
> 当前源文件：`pmbus-calculator.html`  
> 当前目标：从单文件工具页重构为可长期维护的专业 Web App。  
> 非当前主线：Tauri、Electron、移动原生 App、真实硬件通信、后端服务。

---

## 0. 文档状态

| 字段         | 内容                                                        |
| ------------ | ----------------------------------------------------------- |
| 文档类型     | Web 重构主规划 / 代码同步追踪 / Agent 执行基线              |
| 适用项目     | PMBus 协议计算器                                            |
| 当前阶段     | Web 设计重构优先                                            |
| 推荐技术栈   | Vite + React + TypeScript + Tailwind CSS + Radix Primitives |
| 初始代码形态 | 单文件 HTML，内联 CSS / JS                                  |
| 发布目标     | Web App 优先；保留未来 PWA / App / single HTML 的可能性     |
| 最后更新     | 2026-08-15                                                  |
| 维护规则     | 每次结构性代码变更必须同步更新本文件对应章节                |

---

## 1. 核心原则

### 1.1 当前最重要目标

当前 99% 的重心是：

```text
重构 Web 设计
稳定 UI 架构
建立可演进组件边界
保留现有计算逻辑正确性
为后续 App 化预留架构空间
```

### 1.2 当前不追求的目标

现阶段不要把注意力分散到：

```text
Tauri / Electron / Capacitor
iOS / Android 原生适配
真实硬件通信
后端服务
账号系统
云同步
大规模数据库
复杂状态库
完全重写 PMBus 数学逻辑
```

这些可以作为后续阶段，但不进入当前主线。

### 1.3 总体策略

```text
先 Web 设计
再状态模型
再计算核心抽离
再测试体系完善
最后考虑 PWA / App 壳 / 单 HTML 备用产物
```

### 1.4 禁止策略

禁止直接进行以下重构：

```text
一次性推倒重写所有功能
先拆目录但不建立状态边界
引入复杂状态库替代基本架构思考
为了“现代化”重写已经正确的数学算法
改 UI 时破坏 L11 / L16 / DIRECT / HALF 任一模式
删除 debug / boundary test 而没有迁移测试
```

---

## 2. 当前代码资产盘点

当前 `pmbus-calculator.html` 已经包含以下重要资产，重构时必须保留或等价迁移。

### 2.1 计算核心

当前已有：

```text
PMBusMath
- toSigned
- fromSigned
- clamp
- swapBytes
- pow2 cache
- decodeLinear11
- encodeLinear11
- findBestLinear11
- decodeLinear16
- encodeLinear16
- decodeDirect
- encodeDirect
- decodeHalf
- encodeHalf
- parseVoutMode
- checkSpecial
- calculatePEC
```

迁移要求：

```text
不得在 UI 重构阶段重写这些算法。
第一阶段只允许机械迁移、包裹 adapter、补测试。
算法变更必须单独提交，并附带 golden test。
```

### 2.2 命令字典

当前已有 `COMMAND_METADATA`，包含：

```text
VOUT_COMMAND
VOUT_OV_FAULT_LIMIT
READ_VOUT
READ_VIN
READ_IOUT
READ_TEMPERATURE_1
VIN_OV_FAULT_LIMIT
OT_FAULT_LIMIT
FAN_COMMAND
READ_POUT
READ_FAN_SPEED_1
STATUS_WORD
READ_EIN
```

迁移要求：

```text
命令数据必须迁移为结构化 TypeScript 数据。
不得硬编码到 UI 组件里。
CommandPicker 必须从统一 command metadata 读取。
```

### 2.3 UI 功能资产

当前页面已有：

```text
模式切换 tabs
命令字典 select
VOUT_MODE 输入
Linear / Direct 显隐区
bit grid / nibble grouping
Hex 输入
Y / N / Value 输入
DIRECT m / b / R 输入
复制 Hex / Value / C 代码
0x / 空格 / 字节序复制选项
主题切换
InfoBar
DebugPanel
Boundary Tests
移动端 sticky result
移动端触控反馈
```

迁移要求：

```text
所有现有功能必须在新版 Web 中有对应组件或明确替代方案。
如暂时未实现，必须写入 Migration Gap 表。
```

---

## 3. 重构目标架构

### 3.1 阶段目标架构

```text
pmbus-calculator/
├─ docs/
│  ├─ WEB_REFACTOR_PLAN.md
│  ├─ DECISIONS/
│  │  └─ ADR-0001-web-first-refactor.md
│  └─ MIGRATION_LOG.md
│
├─ apps/
│  └─ web/
│     ├─ index.html
│     ├─ package.json
│     ├─ vite.config.ts
│     ├─ tsconfig.json
│     └─ src/
│        ├─ main.tsx
│        ├─ App.tsx
│        ├─ app/
│        ├─ components/
│        ├─ legacy/
│        ├─ styles/
│        └─ test/
│
├─ packages/
│  └─ core/
│     ├─ src/
│     └─ tests/
│
├─ AGENTS.md
├─ CLAUDE.md
├─ package.json
└─ README.md
```

### 3.2 第一阶段可以更轻量

第一阶段不强制 monorepo。可以先使用：

```text
pmbus-calculator/
├─ docs/
├─ src/
│  ├─ main.tsx
│  ├─ App.tsx
│  ├─ legacy/
│  ├─ components/
│  ├─ styles/
│  └─ tests/
├─ AGENTS.md
├─ package.json
└─ vite.config.ts
```

如果项目还小，优先减少目录复杂度。等 Web UI 稳定后再拆 `packages/core`。

---

## 4. 推荐技术栈

### 4.1 Web 主栈

| 层           | 推荐                         |
| ------------ | ---------------------------- |
| 构建         | Vite                         |
| UI           | React                        |
| 语言         | TypeScript                   |
| 样式         | Tailwind CSS + CSS variables |
| 基础交互组件 | Radix Primitives             |
| 单元测试     | Vitest                       |
| UI/E2E 测试  | Playwright                   |
| 格式化       | Prettier                     |
| 静态检查     | ESLint                       |
| 类型检查     | `tsc --noEmit`               |

### 4.2 为什么不是直接用原生 DOM

原生 DOM 可以继续维护，但现在目标已经变成“专业 Web App 设计重构”，组件化收益更大：

```text
更容易拆分 ModeWorkspace
更容易做 ResultInspector
更容易做移动端 bottom sheet / responsive shell
更容易维护主题
更容易做 CommandPicker
更容易做可测试状态流
```

### 4.3 为什么不是现在做 Tauri

Tauri 是后续 App 化的壳，不是当前 Web 设计重构的核心。当前应该保证 Web App 本身架构干净。只要 Web App 做好，Tauri 后面可以作为包装层接入。

---

## 5. 新 Web 信息架构

### 5.1 桌面端布局

```text
┌─────────────────────────────────────────────────────┐
│ Header                                               │
│ PMBus Calculator                  Theme / Settings   │
├─────────────────────────────────────────────────────┤
│ Mode Switcher                                        │
├─────────────────────────────────────────────────────┤
│ Command Picker                                       │
├───────────────────────────────┬─────────────────────┤
│ Workspace                     │ Result Inspector    │
│                               │                     │
│ Hex Input                     │ Value               │
│ Formula Editor                │ Raw Hex             │
│ Bit Grid                      │ Byte Order          │
│ Mode Options                  │ Formula             │
│ Direct Coefficients           │ Error               │
│                               │ Copy Tools          │
├───────────────────────────────┴─────────────────────┤
│ Info / Warning / Debug Drawer                        │
└─────────────────────────────────────────────────────┘
```

### 5.2 移动端布局

```text
┌──────────────────────────────┐
│ Header                       │
├──────────────────────────────┤
│ Mode Switcher                │
├──────────────────────────────┤
│ Command Picker               │
├──────────────────────────────┤
│ Workspace                    │
│ Hex / Formula / BitGrid      │
├──────────────────────────────┤
│ Sticky or Bottom Result Dock │
└──────────────────────────────┘
```

### 5.3 核心 UI 区域

| 区域   | 组件名            | 说明                    |
| ------ | ----------------- | ----------------------- |
| 顶部   | `AppHeader`       | 标题、主题、设置        |
| 模式   | `ModeSwitcher`    | L11/L16/DIRECT/HALF     |
| 命令   | `CommandPicker`   | 可搜索命令选择          |
| 工作区 | `ModeWorkspace`   | 按模式渲染输入区        |
| 位图   | `BitGrid`         | 16 bit / nibble 分组    |
| 公式   | `FormulaEditor`   | Y × 2^N / DIRECT 等     |
| 结果   | `ResultInspector` | 值、公式、误差、复制    |
| 提示   | `InfoPanel`       | warnings、notes、status |
| 调试   | `DebugDrawer`     | 边界测试入口            |

---

## 6. 组件规划

### 6.1 AppShell

```tsx
<AppShell>
  <AppHeader />
  <MainLayout>
    <PrimaryPanel>
      <ModeSwitcher />
      <CommandPicker />
      <ModeWorkspace />
    </PrimaryPanel>
    <SecondaryPanel>
      <ResultInspector />
      <InfoPanel />
    </SecondaryPanel>
  </MainLayout>
  <DebugDrawer />
</AppShell>
```

### 6.2 ModeWorkspace

```tsx
function ModeWorkspace({ state, dispatch }: Props) {
  switch (state.mode) {
    case 'L11':
      return <Linear11Workspace state={state} dispatch={dispatch} />
    case 'L16':
      return <Linear16Workspace state={state} dispatch={dispatch} />
    case 'DIRECT':
      return <DirectWorkspace state={state} dispatch={dispatch} />
    case 'HALF':
      return <HalfWorkspace state={state} dispatch={dispatch} />
  }
}
```

### 6.3 组件职责边界

| 组件              | 允许做                       | 禁止做              |
| ----------------- | ---------------------------- | ------------------- |
| `HexInput`        | 输入、显示、校验 Hex 字符    | 直接计算 PMBus 值   |
| `BitGrid`         | 显示 bit、触发 toggle action | 直接改 raw 全局变量 |
| `FormulaEditor`   | 编辑 Y/N/Value               | 直接操作 DOM        |
| `ResultInspector` | 展示 ViewModel               | 修改计算状态        |
| `CommandPicker`   | 选择命令                     | 复制命令算法        |
| `ThemeToggle`     | 切换主题状态                 | 写散落的 class      |
| `CopyToolbar`     | 复制动作                     | 重新计算值          |
| `InfoPanel`       | 展示 warning/note            | 直接解析输入        |

---

## 7. 状态模型规划

### 7.1 第一阶段状态模型

第一阶段使用 React `useReducer`，不要引入复杂状态库。

```ts
export type AppMode = 'L11' | 'L16' | 'DIRECT' | 'HALF'
export type Endian = 'le' | 'be'

export interface AppState {
  mode: AppMode
  raw: number
  commandKey: string | null
  byteOrder: Endian

  l11: {
    n: number
    y: number
    autoN: boolean
  }

  l16: {
    n: number
    voutMode: number
  }

  direct: {
    y: number
    m: number
    b: number
    r: number
  }

  copy: {
    prefix0x: boolean
    spaceBetweenBytes: boolean
    endian: Endian
  }

  ui: {
    theme: 'light' | 'dark' | 'system'
    focusedField: string | null
    debugOpen: boolean
  }
}
```

### 7.2 Action 设计

```ts
export type AppAction =
  | { type: 'mode/set'; mode: AppMode }
  | { type: 'command/set'; commandKey: string | null }
  | { type: 'raw/set-from-hex'; hex: string }
  | { type: 'raw/set'; raw: number }
  | { type: 'bit/toggle'; bit: number }
  | { type: 'value/set'; value: string }
  | { type: 'l11/set-n'; n: string }
  | { type: 'l11/set-y'; y: string }
  | { type: 'l11/toggle-auto-n' }
  | { type: 'l16/set-vout-mode'; hex: string }
  | { type: 'direct/set-y'; y: string }
  | { type: 'direct/set-coeff'; name: 'm' | 'b' | 'r'; value: string }
  | { type: 'copy/toggle-prefix' }
  | { type: 'copy/toggle-space' }
  | { type: 'copy/set-endian'; endian: Endian }
  | { type: 'ui/set-theme'; theme: 'light' | 'dark' | 'system' }
```

### 7.3 ViewModel

所有 UI 展示优先来自 ViewModel：

```ts
export interface CalculatorViewModel {
  mode: AppMode
  valueText: string
  rawHex: string
  rawBytesLE: string
  rawBytesBE: string
  formulaText: string
  deltaText?: string
  deltaKind?: 'ok' | 'warn' | 'error'
  warnings: Array<{ id: string; level: 'info' | 'warning' | 'error'; text: string }>
  bitGroups: BitGroupViewModel[]
  commandNote?: string
  visible: {
    voutMode: boolean
    directCoefficients: boolean
    halfNote: boolean
    nRange: boolean
  }
}
```

原则：

```text
组件不直接调用 PMBusMath。
组件只消费 state / viewModel / dispatch。
计算逻辑集中在 reducer / selectors / view-model 层。
```

---

## 8. 样式与设计系统规划

### 8.1 Token 层

建立 `src/styles/tokens.css`：

```css
:root {
  --color-bg: #f8fafc;
  --color-surface: #ffffff;
  --color-surface-muted: #f1f5f9;
  --color-text-primary: #0f172a;
  --color-text-secondary: #475569;
  --color-text-muted: #64748b;
  --color-border: #e2e8f0;

  --color-accent: #1e40af;
  --color-success: #10b981;
  --color-warning: #f59e0b;
  --color-danger: #ef4444;
  --color-info: #3b82f6;

  --radius-sm: 0.375rem;
  --radius-md: 0.625rem;
  --radius-lg: 0.875rem;
  --radius-xl: 1.25rem;

  --shadow-panel: 0 20px 25px -5px rgb(0 0 0 / 0.05), 0 8px 10px -6px rgb(0 0 0 / 0.05);
}

:root[data-theme='dark'] {
  --color-bg: #0f172a;
  --color-surface: #1e2937;
  --color-surface-muted: #334155;
  --color-text-primary: #e2e8f0;
  --color-text-secondary: #94a3b8;
  --color-text-muted: #cbd5e1;
  --color-border: #475569;

  --color-accent: #60a5fa;
  --color-success: #34d399;
  --color-warning: #fbbf24;
  --color-danger: #f87171;
  --color-info: #60a5fa;
}
```

### 8.2 样式原则

```text
布局优先使用 Tailwind utility。
主题颜色使用 CSS variables。
复杂组件如 BitGrid / FormulaEditor 可以用 CSS module。
不要在 JSX 中写大量 inline style。
不要用硬编码颜色绕过 token。
```

### 8.3 需要从旧代码继承的设计经验

保留这些方向：

```text
bit grid 使用 nibble 分组
移动端 bit grid 自动降级 4x4 / 2x8 / 1x16
结果区在移动端保持易见
输入框对工程数值友好
复制操作有明确反馈
暗色模式必须完整支持
```

### 8.4 必须修正的旧问题

```text
暗色 token 不再三处重复定义
.infoBar 必须有明确样式
themeToggle 不再使用绝对定位 inline style
tab 不再使用 onclick
linearSection/directSection 不再用 display:none 作为主状态管理
```

---

## 9. 迁移路线图

## Milestone 0：准备期

### 目标

```text
添加 docs
添加 AGENTS.md
确认当前功能列表
建立迁移追踪表
```

### 任务

- [ ] 新增 `docs/WEB_REFACTOR_PLAN.md`
- [ ] 新增 `AGENTS.md`
- [ ] 新增 `CLAUDE.md` 或让其指向 `AGENTS.md`
- [ ] 新增 `docs/MIGRATION_LOG.md`
- [ ] 列出现有功能清单
- [ ] 列出现有已知问题清单

### 验收标准

- [ ] Agent 能在不询问额外背景的情况下理解当前重构目标
- [ ] 每个后续 PR / commit 都能引用此规划章节
- [ ] 当前旧 HTML 仍可运行

---

## Milestone 1：Vite + React + TS Web 骨架

### 目标

建立新 Web 项目，但不破坏旧 HTML。

### 任务

- [x] 创建 Vite React TS 项目
- [x] 接入 Tailwind
- [x] 接入 ESLint / Prettier
- [x] 接入 Vitest
- [x] 建立 `src/App.tsx`
- [x] 建立 `src/styles/tokens.css`
- [x] 建立 `src/legacy/`
- [x] 迁入 `PMBusMath` 到 legacy adapter
- [x] 迁入 `COMMAND_METADATA`

### 验收标准

- [x] `npm run dev` 可启动
- [x] `npm run build` 可通过
- [x] 页面显示基础 AppShell
- [x] 旧 HTML 未被删除
- [x] `PMBusMath` 至少有 smoke test（13 pass）

---

## Milestone 2：新版 Web 视觉框架

### 目标

完成新 UI 骨架，不要求所有计算交互可用。

### 任务

- [x] `AppHeader`
- [x] `ModeSwitcher`
- [x] `CommandPicker` 静态版
- [x] `WorkspaceLayout`
- [x] `ResultInspector` 静态版
- [x] `InfoPanel`
- [x] 响应式桌面双栏
- [x] 移动端单栏
- [x] 暗色模式 token

### 验收标准

- [x] 1440px 桌面布局无明显空洞（Playwright 验证双栏）
- [x] 768px 平板布局不溢出
- [x] 390px 手机布局无横向滚动（Playwright 验证）
- [x] 暗色模式所有文字可读（data-theme token 体系）
- [x] UI 不依赖旧 DOM ID

---

## Milestone 3：L11 模式闭环

### 目标

新版 Web 中 LINEAR11 完整可用。

### 任务

- [x] `HexInput`（暂内联于 `ModeWorkspace`，未拆独立组件）
- [x] `BitGrid`（独立组件，toggle 已接 reducer）
- [x] `FormulaEditor`（L11 Y/N 双向编辑已通过 `IntegerInput` 接入；独立组件拆分待办）
- [x] `ResultInspector`（展示 L11 的 value/raw/bytes）
- [x] L11 decode（`view-model.ts` 已调用 `decodeLinear11`）
- [x] L11 encode（`value/set` 经 `findBestLinear11` / 手动 N 接入 reducer）
- [x] Value -> best N/Y（`findBestLinear11` 已接入 auto-N 路径）
- [x] N manual / auto toggle（toggle 会按当前值重算 raw）
- [x] 误差展示（`deltaText/deltaKind` 已填充，`ErrorDelta` 组件展示）
- [x] overflow / special warning（`checkSpecial` 已接入 warnings）

### 实际状态（2026-08-15）

L11 已实现 **双向闭环**：Hex/bit → raw → Y/N/Value 同步；Y/N 编辑经 `encodeLinear11` 回写 raw；Value 编辑经 `findBestLinear11`（auto-N）或手动 N 回写 raw；`l11.valueInput` 记录请求值，`view-model` 填充 `deltaText/deltaKind`，`ErrorDelta` 展示量化误差；`nRangeText` 展示当前 N 可表示范围。`tests/fixtures/linear11-cases.ts` 已接入 `tests/linear11.test.ts`（decode 9 + roundtrip 9 + special 3）。Chromium 390px 浏览器实测：无横向滚动，Value 12.5 → Hex 0xF819、Y=25、N=-1。`FormulaEditor` 独立组件与 `HexInput` 拆分仍待后续 UI 专项。

### 验收标准

- [x] 修改 Hex 更新 Y/N/Value
- [x] 修改 bit 更新 Hex/Value
- [x] 修改 Y/N 更新 Hex/Value
- [x] 修改 Value 更新 Hex/Y/N
- [x] 自动 N 行为与旧版一致或有明确设计变更记录
- [x] 关键 golden case 测试通过

---

## Milestone 4：L16 / VOUT 模式闭环

### 目标

新版 Web 中 LINEAR16 完整可用。

### 任务

- [x] VOUT_MODE 输入（`ModeWorkspace` 内联输入，写 `state.l16.voutMode`）
- [x] VOUT_MODE parse（`parseVoutMode` 已在 reducer 中据其推导 `l16.n`）
- [x] L16 raw value（`view-model.ts` 已调用 `decodeLinear16`，使用 `state.l16.n`）
- [x] byte order 控制（L16 字节序 select 已接入 `state.byteOrder`；Hex 输入/显示按 BE 交换）
- [x] L16 bit grid（复用 `BitGrid`，图例已按模式切换为 V [15:0]）
- [x] value <-> raw 转换（decode 显示可用；encode 已接入 `value/set` 与手动 V 输入）

### 实际状态（2026-08-15）

L16 已实现 **双向闭环**：`l16/set-vout-mode` 经 `parseVoutMode` 推导 `l16.n`（LINEAR 模式）且非 LINEAR 保持原 N；`value/set` 在 L16 模式按 `V = clamp(round(value / 2^N), 0, 65535)` 回写 raw；L16 workspace 提供 VOUT_MODE、字节序（LE/BE）、V (16-bit) 输入、物理值输入与可表示范围；`view-model` 对非 LINEAR VOUT_MODE 生成 `l16-vout-mode-nonlinear` warning，并输出 `voutModeInfo`；`BitGrid` 图例按模式切换（L16 为 V [15:0]）。测试 126 pass。

### 验收标准

- [x] VOUT_MODE=0x18 时 N=-8
- [x] Raw 与 Value 转换正确
- [x] LE/BE 显示和复制正确（Hex 显示按字节序；LE/BE 字节展示；复制偏好仍待 M7 开关）
- [x] 非 LINEAR VOUT_MODE 有明确 warning

---

## Milestone 5：DIRECT 模式闭环

### 目标

新版 Web 中 DIRECT 完整可用。

### 任务

- [ ] DirectCoeffPanel（未拆独立组件，内联于 `ModeWorkspace`）
- [x] m / b / R 输入（内联输入，写 `state.direct`）
- [x] DIRECT decode（`view-model` 调用 `decodeDirect`，m=0 返回 NaN）
- [ ] DIRECT encode（未接入）
- [ ] signed 16-bit Y（action `direct/set-y` 已定义，无 UI 输入）
- [ ] preset profiles（未实现）
- [x] m=0 warning（`view-model` 已生成 error 级提示）

### 实际状态（2026-08-15）

DIRECT 可编辑 m/b/R 并从 `state.direct.y`（恒为初始 0）解码显示 value；Y 无输入入口、value→Y 未实现、profiles 未实现。里程碑未完成。

### 验收标准

- [ ] 修改 Y 更新 value
- [ ] 修改 value 更新 Y
- [ ] 修改系数更新结果
- [ ] profile 能正确写入 m/b/R
- [ ] m=0 不崩溃，有错误提示

---

## Milestone 6：HALF 模式闭环

### 目标

新版 Web 中 IEEE Half 完整可用。

### 任务

- [ ] Half bit grid 分区（复用通用 `BitGrid`，无 sign/exp/mantissa 分区与图例）
- [x] decodeHalf（`view-model` 已接入，显示 NaN/±Infinity/subnormal/0）
- [ ] encodeHalf（未接入 UI）
- [x] NaN（0x7E00 显示 NaN）
- [x] +Infinity / -Infinity（0x7C00/0xFC00 显示正确）
- [x] subnormal（`decodeHalf` 已处理 exp=0 情形）
- [x] signed zero（`decodeHalf` 返回 -0；当前 `valueText` 显示为 0，未区分符号）

### 实际状态（2026-08-15）

HALF 具备 raw→value 的 decode 显示；无 Value 输入，encode 未接入；bit grid 无半精度分区。里程碑未完成。

### 验收标准

- [ ] 0x7C00 显示 Infinity
- [ ] 0xFC00 显示 -Infinity
- [ ] NaN 有提示
- [ ] -0 可处理
- [ ] Value 输入可编码为 half

---

## Milestone 7：复制与工程输出

### 目标

新版复制功能完整可用。

### 任务

- [x] Copy Hex（`CopyToolbar` 可用）
- [x] Copy Value（`CopyToolbar` 可用）
- [x] Copy C Macro（简化版：仅 `#define RAW_VALUE <rawHex> /* <formula> */`，未含命令信息）
- [ ] 0x prefix toggle（action 已定义，无 UI）
- [ ] space toggle（action 已定义，无 UI）
- [ ] endian toggle（action 已定义，无 UI）
- [x] copy feedback（clipboard API 成功/失败提示）
- [ ] clipboard fallback（仅 try/catch 提示，无 `execCommand` 回退）

### 实际状态（2026-08-15）

复制按钮可用；LE/BE 字节展示受 `state.copy.prefix0x/spaceBetweenBytes` 初始值影响，但三个偏好开关无 UI，设置未持久化。里程碑未完成。

### 验收标准

- [ ] 按钮点击后有视觉反馈
- [ ] LE/BE 输出符合预期
- [ ] 设置能持久化
- [ ] 浏览器不支持 clipboard 时有 fallback 或提示

---

## Milestone 8：测试和回归保护

### 目标

把旧 debug test 迁移到自动化测试。

### 任务

- [x] `tests/linear11.test.ts`（`tests/fixtures/linear11-cases.ts` 已接入 21 个 golden case）
- [ ] `tests/linear16.test.ts`
- [ ] `tests/direct.test.ts`
- [ ] `tests/half.test.ts`
- [ ] `tests/pec.test.ts`（PEC smoke test 已在 `pmbus-math.test.ts` 内）
- [x] `tests/view-model.test.ts`（35 tests，位于 `src/app/view-model.test.ts`）
- [x] `e2e/basic-flow.spec.ts`（以 `tests/e2e/home.spec.ts` 形式存在：标题/组件可见/390px 无横向滚动/调试面板展开）

### 实际状态（2026-08-15）

`npm run test:run` 当前 126 pass（13 math + 57 reducer + 35 view-model + 21 L11 golden）；`npm run typecheck`、`npm run build` 通过；`npm run lint` 有 3 个 `coverage/` 生成文件的 warning。L11/L16/DIRECT/HALF 的完整 roundtrip 测试尚未建立。里程碑未完成。

### 验收标准

- [ ] `npm test` 通过
- [ ] `npm run typecheck` 通过
- [ ] `npm run lint` 通过
- [ ] 至少覆盖 L11 / L16 / DIRECT / HALF 的核心 roundtrip
- [ ] 旧 debug panel 可删除或改为调用测试 fixture

---

## Milestone 9：旧 HTML 下线或保留

### 目标

决定旧单文件 HTML 的归宿。

### 选项

```text
A. 删除旧 HTML，只保留新版 Web
B. 保留 old/pmbus-calculator.html 作为 legacy
C. 继续提供 single HTML 构建产物
```

### 建议

当前建议选 B，然后后续再考虑 C。

### 验收标准

- [ ] README 明确说明新版入口
- [ ] legacy 文件不再作为主要开发对象
- [ ] 如果保留 single HTML，必须由构建生成，不手工维护

---

## 10. 代码同步追踪机制

### 10.1 每次变更必须更新的追踪表

在每个 PR / commit 中填写：

| 变更 ID  | 日期       | 文件                                                                                                                                                                                                     | 变更类型           | 影响模式                  | 测试                                  | 文档同步 | 状态 |
| -------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------- | ------------------------------------- | -------- | ---- |
| WEB-0001 | 2026-04-30 | `package.json`, `vite.config.ts`, `tsconfig*.json`, `index.html`, `.gitignore`, `.prettierrc`, `eslint.config.js`                                                                                        | 配置               | 全局                      | build / lint pass                     | 是       | Done |
| WEB-0002 | 2026-04-30 | `src/main.tsx`, `src/App.tsx`, `src/styles/tokens.css`                                                                                                                                                   | 新增               | 全局 / THEME              | build pass                            | 是       | Done |
| WEB-0003 | 2026-04-30 | `src/legacy/pmbus-math.ts`, `src/legacy/command-metadata.ts`, `src/legacy/legacy-adapter.ts`, `src/legacy/pmbus-math.test.ts`                                                                            | 迁移               | L11 / L16 / DIRECT / HALF | Vitest 13 pass                        | 是       | Done |
| WEB-0004 | 2026-04-30 | `src/app/state.ts`, `src/app/actions.ts`, `src/app/reducer.ts`, `src/app/view-model.ts`                                                                                                                  | 新增               | 全局                      | typecheck / lint                      | 是       | Done |
| WEB-0005 | 2026-04-30 | `App.tsx`, `AppHeader`, `WorkspaceLayout`, `ModeSwitcher`, `ModeWorkspace`, `CommandPicker`, `ResultInspector`, `InfoPanel`, `CopyToolbar`, `BitGrid`, `ThemeToggle`                                     | 新增               | GLOBAL / LAYOUT / THEME   | Playwright 1440px+390px               | 是       | Done |
| WEB-0006 | 2026-04-30 | `App.tsx`, `BitGrid`, `ResultInspector`, `ModeWorkspace`, `ModeSwitcher`, `command-metadata.ts`, `vite.config.ts`, `package.json`                                                                        | 修复               | GLOBAL / LAYOUT / THEME   | tsc+eslint+build+vitest 13 pass       | 是       | Done |
| WEB-0007 | 2026-04-30 | `BitGrid.tsx`, `tokens.css`, `App.tsx`                                                                                                                                                                   | 修复               | GLOBAL / LAYOUT           | Playwright 1440px+390px               | 是       | Done |
| WEB-0008 | 2026-04-30 | 删除 `src/legacy/legacy-adapter.ts`；新增 `src/app/reducer.test.ts`（38 tests）；配置 `simple-git-hooks` pre-commit                                                                                      | 清理 / 测试 / 配置 | 全局                      | 38 pass + tsc                         | 是       | Done |
| WEB-0009 | 2026-04-30 | `docs/WEB_REFACTOR_PLAN.md`（Migration Gap 同步）；新增 `src/components/debug/DebugDrawer.tsx`；更新 `src/App.tsx`                                                                                       | 文档 / 新增        | GLOBAL / LAYOUT           | tsc+build+vitest 51 pass + Playwright | 是       | Done |
| WEB-0013 | 2026-08-15 | `src/app/reducer.ts`, `src/app/actions.ts`, `src/app/view-model.ts`, `src/components/mode/ModeWorkspace.tsx`, `src/components/bits/BitGrid.tsx`, `src/app/reducer.test.ts`, `src/app/view-model.test.ts` | 新增 / 修复        | L16                       | Vitest 126 pass + typecheck + build   | 是       | Done |

### 10.2 变更类型

```text
新增
迁移
重命名
删除
修复
样式
测试
文档
配置
```

### 10.3 影响模式

```text
L11
L16
DIRECT
HALF
COPY
THEME
COMMAND
LAYOUT
GLOBAL
```

### 10.4 状态

```text
Todo
In Progress
Blocked
Review
Done
Reverted
```

### 10.5 示例

| 变更 ID  | 日期       | 文件                              | 变更类型 | 影响模式            | 测试            | 文档同步 | 状态   |
| -------- | ---------- | --------------------------------- | -------- | ------------------- | --------------- | -------- | ------ |
| WEB-0001 | 2026-04-29 | `src/styles/tokens.css`           | 新增     | THEME               | 手测 light/dark | 是       | Done   |
| WEB-0002 | 2026-04-29 | `src/components/ModeSwitcher.tsx` | 新增     | GLOBAL              | 手测模式切换    | 是       | Done   |
| WEB-0003 | 2026-04-29 | `src/legacy/pmbus-math.ts`        | 迁移     | L11/L16/DIRECT/HALF | Vitest smoke    | 是       | Review |

---

## 11. Migration Gap 表

每迁移一个旧功能，必须更新本表。

| 旧功能          | 旧位置                            | 新组件/模块                  | 状态        | 备注                                                                                                                                 |
| --------------- | --------------------------------- | ---------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| PMBusMath 核心  | 内联 `PMBusMath`                  | `legacy/pmbus-math.ts`       | Done        | 机械迁移完成，带完整类型定义；smoke test 13 pass                                                                                     |
| 命令字典数据    | 内联 `COMMAND_METADATA`           | `legacy/command-metadata.ts` | Done        | 数据层迁移完成；`CommandPicker` 已从该数据源读取                                                                                     |
| 模式 Tabs       | HTML `.tabs` + `switchMode`       | `ModeSwitcher`               | Done        | React 组件化，无 inline onclick；支持 Ctrl+1/2/3/4 快捷键                                                                            |
| 命令字典 UI     | `#commandSelect`                  | `CommandPicker`              | Done        | 可搜索下拉框；数据来自 `command-metadata.ts`；键盘方向键导航待补                                                                     |
| Bit Grid        | `renderBits` / `renderDirectBits` | `BitGrid`                    | 部分完成    | 保留 nibble 分组与响应式策略；图例按模式切换（L11 N/Y、L16 V、HALF S+Exp/Mant、DIRECT Y）                                            |
| 结果面板        | `#resultBox`                      | `ResultInspector`            | Done        | 桌面端右侧 sticky 面板，移动端跟随流式布局                                                                                           |
| 信息栏          | `#infoBar`                        | `InfoPanel`                  | Done        | 警告/信息/错误三级提示，带图标和颜色区分                                                                                             |
| 公式界面        | `.formula-mode` DOM               | `ModeWorkspace` 内联公式区   | 部分完成    | L11 双向编辑（Hex ↔ Y/N/Value）已接入；L16 双向编辑（Hex ↔ V/Value）已接入；DIRECT/HALF 双向待闭环；独立 FormulaEditor 组件待拆      |
| DebugPanel      | `#debugPanel`                     | `DebugDrawer`                | 部分完成    | 可折叠面板与诊断信息已建；测试状态显示“51/51”已过时（实际 126 pass）；边界测试入口待 M8 接入                                         |
| 主题切换        | `#themeToggle` + `.dark`          | `ThemeToggle`, `data-theme`  | 部分完成    | 功能可用（light/dark/system）；但 localStorage 在组件内直接读写，未走 persistence 层/`state.ui.theme`                                |
| 复制设置        | 复制按钮 + 全局状态               | `CopyToolbar`                | 部分完成    | Hex / 值 / C 宏复制按钮可用；0x/空格/LE-BE 偏好开关未接 UI，设置未持久化                                                             |
| DIRECT profiles | inline buttons                    | `DirectCoeffPanel`           | Todo        | 数据化 preset profiles 未实现                                                                                                        |
| Boundary tests  | `runBoundaryTests`                | Vitest + DebugDrawer         | In Progress | Vitest 已接入 126 pass（13 math + 57 reducer + 35 view-model + 21 L11 golden）；L11 fixture 已接入；L16/DIRECT/HALF golden-case 待补 |

---

## 12. 测试策略

### 12.1 测试分层

```text
Unit tests:
  PMBusMath / core functions

Reducer tests:
  action -> state

ViewModel tests:
  state -> display result

Component tests:
  key UI components

E2E tests:
  real user flow
```

### 12.2 必测场景

#### LINEAR11

```text
Hex -> N/Y/Value
Y/N -> Hex/Value
Value -> best N/Y
边界 Y=1023
边界 Y=-1024
N=-16
N=15
0 值
负值
误差显示
```

#### LINEAR16

```text
VOUT_MODE 0x18 -> N=-8
Raw 0x0C00 -> 12
Byte order LE/BE
非 LINEAR VOUT_MODE
Raw clamp 0..65535
```

#### DIRECT

```text
m=0
R 正负
Y signed 16-bit
value -> Y
Y -> value
profile apply
```

#### HALF

```text
0
-0
subnormal
normal
Infinity
-Infinity
NaN
rounding
```

#### Copy

```text
0x prefix on/off
space on/off
LE/BE
C macro includes command if selected
```

---

## 13. 设计验收标准

### 13.1 桌面端

| 宽度   | 预期                                     |
| ------ | ---------------------------------------- |
| 1440px | 双栏布局，结果区右侧固定，输入区宽度舒适 |
| 1024px | 双栏仍可用，CommandPicker 不溢出         |
| 768px  | 可以降为单栏或紧凑双栏                   |

### 13.2 移动端

| 宽度  | 预期                         |
| ----- | ---------------------------- |
| 430px | 无横向滚动                   |
| 390px | BitGrid 不溢出               |
| 360px | 输入框不裁切                 |
| 320px | 允许布局降级，但核心输入可用 |

### 13.3 主题

```text
light 可读
dark 可读
system 跟随系统
切换后持久化
无黑底黑字 / 白底白字
```

### 13.4 可访问性

```text
所有输入有 label
tab 顺序合理
button 有明确 aria-label
结果区 aria-live
错误提示不只依赖颜色
CommandPicker 可键盘操作
```

---

## 14. Commit / PR 规则

### 14.1 Commit 前必须检查

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

### 14.2 Commit message 建议

```text
web: add app shell layout
web: migrate linear11 workspace
core: migrate PMBusMath legacy adapter
test: add linear11 golden cases
docs: update migration tracking table
```

### 14.3 PR 描述模板

```md
## Summary

## Changed Files

## Affected Modes

- [ ] L11
- [ ] L16
- [ ] DIRECT
- [ ] HALF
- [ ] Theme
- [ ] Copy
- [ ] Layout

## Tests

- [ ] lint
- [ ] typecheck
- [ ] unit
- [ ] build
- [ ] manual mobile check

## Migration Tracking

Updated:

- [ ] WEB_REFACTOR_PLAN.md
- [ ] MIGRATION_LOG.md
- [ ] AGENTS.md if workflow changed

## Screenshots

Desktop:
Mobile:
Dark:
```

---

## 15. 决策记录 ADR

### ADR-0001：Web-first 重构

```md
# ADR-0001: Web-first refactor

## Status

Accepted

## Context

当前项目从单文件 PMBus 计算器演进为长期维护的 Web 工具。虽然未来可能 App 化，但当前 99% 重心是 Web 设计重构。

## Decision

采用 Vite + React + TypeScript + Tailwind 的 Web-first 路线。Tauri / App 壳后置。旧计算逻辑先迁移，不重写。

## Consequences

- Web UI 可以快速现代化。
- 当前算法资产得到保留。
- 后续 PWA / App 化可以基于 Web App 包装。
- 短期内会同时存在 legacy HTML 和新 Web 源码。
```

---

## 16. 风险清单

| 风险                   | 影响 | 缓解                          |
| ---------------------- | ---- | ----------------------------- |
| UI 重构破坏计算正确性  | 高   | 先迁移测试，算法不重写        |
| 一次性重写范围过大     | 高   | 按 Milestone 分阶段           |
| 状态模型过早复杂化     | 中   | 第一阶段只用 useReducer       |
| Tailwind 与 token 混乱 | 中   | token 管主题，Tailwind 管布局 |
| 移动端体验退化         | 高   | 每个 Milestone 做 390px 检查  |
| 旧功能遗漏             | 高   | 维护 Migration Gap 表         |
| Agent 自作主张引入新库 | 中   | AGENTS.md 强约束              |

---

## 17. 完成定义 Definition of Done

一个 Milestone 完成必须满足：

```text
功能可用
视觉符合新版布局
无明显移动端溢出
暗色模式可读
相关测试通过
Migration Gap 更新
代码同步追踪表更新
没有无说明的旧功能删除
```

---

## 18. 当前下一步建议

M0–M4 已完成（docs、Vite React TS 骨架、tokens、AppShell、ModeSwitcher/CommandPicker/ResultInspector 静态版、PMBusMath 与 COMMAND_METADATA 迁移、L11 双向闭环、L16/VOUT_MODE 双向闭环）。  
当前按顺序执行：

```text
1. M3：L11 full loop ✅（2026-08-15 双向闭环）
2. M4：L16 / VOUT_MODE 闭环 ✅（2026-08-15 双向闭环）
3. M5：DIRECT 闭环（当前主任务）
4. M6：HALF 闭环
5. M7：复制偏好闭环（0x / 空格 / LE-BE）
6. M8：测试回归保护与 debug 测试迁移
7. M9：旧 HTML 下线或保留决策
```

---

## 19. 当前禁止删除清单

在测试迁移完成前，不得删除：

```text
PMBusMath
COMMAND_METADATA
runBoundaryTests
debugPanel
renderBits / renderDirectBits 的行为
copyHex / copyValue / copyC 的行为
localStorage preference 行为
theme toggle 行为
L11/L16/DIRECT/HALF 任一入口
```

---

## 20. 维护者备注

本文件不是一次性规划。它是重构期间的主同步文档。  
任何影响目录、状态模型、组件边界、迁移顺序、测试策略的变更，都必须同步更新本文件。
