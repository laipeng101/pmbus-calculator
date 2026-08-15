# AGENTS.md

> 本文件是所有编程 Agent / Claude / Copilot / Cursor / Codex 在本仓库工作前必须阅读并遵守的强制规则。  
> 当前项目：PMBus Calculator Web 重构。  
> 当前阶段：**99% 聚焦 Web 设计重构**。  
> 本文件优先级高于临时优化冲动。不要在未满足条件时扩大范围。

---

## 0. 必读结论

当前任务不是“随便优化代码”，而是：

```text
把当前单文件 PMBus Calculator 重构为可维护的现代 Web App。
当前重心是 Web 设计、组件边界、响应式布局、主题系统。
不要优先做 Tauri / Electron / 移动原生 / 硬件通信。
```

---

## 1. 当前工作主线

你必须优先服务以下目标：

```text
1. Web UI 架构重建
2. 组件化
3. 设计 token 化
4. 响应式布局
5. 保留现有 PMBus 计算正确性
6. 建立可追踪迁移
7. 为后续 PWA / App 化预留空间
```

不要把当前阶段变成：

```text
全平台 App 工程
硬件通信工程
后端工程
算法重写工程
大型 monorepo 工程
```

---

## 2. 项目背景

当前源文件是单文件 HTML，包含：

```text
内联 CSS
内联 JavaScript
PMBusMath 计算核心
COMMAND_METADATA 命令字典
L11 / L16 / DIRECT / HALF 四种模式
bit grid
命令选择
复制功能
主题切换
debug boundary tests
移动端样式优化
```

这些不是垃圾代码。  
它们是需要迁移和保护的资产。

---

## 3. 绝对禁止

### 3.1 禁止推倒重写

不要直接删除旧实现并重写一个“看起来更现代”的版本。

必须：

```text
先迁移
再替换
再验证
最后删除旧代码
```

### 3.2 禁止无测试改算法

以下函数或逻辑不得在没有测试时修改：

```text
decodeLinear11
encodeLinear11
findBestLinear11
decodeLinear16
encodeLinear16
decodeDirect
encodeDirect
decodeHalf
encodeHalf
parseVoutMode
calculatePEC
```

### 3.3 禁止擅自引入 App 壳

当前不要引入：

```text
Tauri
Electron
Capacitor
React Native
Flutter
Rust backend
Node backend
```

除非用户明确要求进入 App 化阶段。

### 3.4 禁止引入复杂状态库

当前默认使用：

```text
React useReducer
```

不要擅自引入：

```text
Redux
MobX
XState
Zustand
Jotai
Recoil
```

除非已有明确需求和文档决策。

### 3.5 禁止把数据硬编码进 UI

命令字典、模式配置、profile、单位等必须来自统一数据层。  
禁止在 JSX 中散落硬编码命令逻辑。

### 3.6 禁止继续新增 inline onclick / inline style

新代码禁止：

```html
<button onclick="...">
  <div style="..."></div>
</button>
```

允许极少数动态 style，但必须有明确理由。布局和视觉样式优先用 class / token / CSS。

---

## 4. 推荐技术栈

默认技术栈：

```text
Vite
React
TypeScript
Tailwind CSS
CSS variables
Radix Primitives
Vitest
Playwright
ESLint
Prettier
```

当前阶段优先实现 Web，不优先实现 single HTML。  
但不要主动破坏未来 single HTML 构建的可能性。

---

## 5. 目录约定

推荐初始结构：

```text
src/
├─ main.tsx
├─ App.tsx
├─ app/
│  ├─ reducer.ts
│  ├─ actions.ts
│  ├─ state.ts
│  ├─ view-model.ts
│  └─ persistence.ts
│
├─ legacy/
│  ├─ pmbus-math.ts
│  ├─ command-metadata.ts
│  └─ legacy-adapter.ts
│
├─ components/
│  ├─ layout/
│  ├─ mode/
│  ├─ command/
│  ├─ inputs/
│  ├─ bits/
│  ├─ result/
│  └─ feedback/
│
├─ styles/
│  ├─ tokens.css
│  └─ app.css
│
└─ tests/
```

不要在一个文件中继续堆积所有组件。

---

## 6. 组件设计规则

### 6.1 必须拆分的组件

至少拆分为：

```text
AppHeader
ModeSwitcher
CommandPicker
ModeWorkspace
Linear11Workspace
Linear16Workspace
DirectWorkspace
HalfWorkspace
HexInput
ValueInput
FormulaEditor
DirectCoeffPanel
VoutModeInput
BitGrid
BitCell
NibbleGroup
ResultInspector
CopyToolbar
ErrorDelta
WarningBanner
InfoPanel
DebugDrawer
ThemeToggle
```

### 6.2 组件职责

组件只做展示和交互，不直接写算法。

允许：

```text
接收 props
显示 viewModel
触发 dispatch(action)
维护局部 UI 状态，例如 popover open
```

禁止：

```text
直接调用 document.getElementById
直接修改 DOM
直接写 localStorage，除非在 persistence 层
直接调用 PMBusMath 做核心计算，除非是 adapter 层
```

---

## 7. 状态管理规则

### 7.1 状态入口

必须建立统一状态：

```ts
type AppMode = 'L11' | 'L16' | 'DIRECT' | 'HALF'
```

推荐状态：

```ts
interface AppState {
  mode: AppMode
  raw: number
  commandKey: string | null
  byteOrder: 'le' | 'be'
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
    endian: 'le' | 'be'
  }
  ui: {
    theme: 'light' | 'dark' | 'system'
    focusedField: string | null
    debugOpen: boolean
  }
}
```

### 7.2 Action 命名

Action 使用命名空间：

```text
mode/set
command/set
raw/set-from-hex
bit/toggle
value/set
l11/set-n
l11/set-y
l11/toggle-auto-n
l16/set-vout-mode
direct/set-y
direct/set-coeff
copy/toggle-prefix
copy/toggle-space
copy/set-endian
ui/set-theme
```

不要使用模糊 action：

```text
update
change
setData
handleInput
```

---

## 8. ViewModel 规则

UI 不应该到处重复格式化结果。  
必须建立 `toCalculatorViewModel(state)`。

ViewModel 至少包括：

```ts
interface CalculatorViewModel {
  mode: AppMode
  valueText: string
  rawHex: string
  rawBytesLE: string
  rawBytesBE: string
  formulaText: string
  deltaText?: string
  deltaKind?: 'ok' | 'warn' | 'error'
  warnings: Array<{
    id: string
    level: 'info' | 'warning' | 'error'
    text: string
  }>
  bitGroups: BitGroupViewModel[]
  commandNote?: string
}
```

---

## 9. 样式规则

### 9.1 Token 优先

主题颜色必须来自 CSS variables。

禁止在组件中散落：

```tsx
className="text-blue-600"
style={{ color: '#1e40af' }}
```

除非有明确注释说明。

### 9.2 主题规则

必须使用：

```text
:root[data-theme="light"]
:root[data-theme="dark"]
:root[data-theme="system"] 或 system resolver
```

不要继续新增 `.dark` 变量重复覆盖。

### 9.3 响应式规则

每个主要 UI 变更都必须检查：

```text
1440px
1024px
768px
430px
390px
360px
```

如果没有自动化截图，至少在 PR 描述中写明手动检查结果。

---

## 10. 迁移顺序

必须按以下顺序优先：

```text
1. docs / AGENTS                                ✅ 已完成
2. Vite React TS skeleton                       ✅ 已完成
3. design tokens                                ✅ 已完成
4. AppShell layout                              ✅ 已完成
5. static ModeSwitcher / CommandPicker / ResultInspector  ✅ 已完成
6. migrate PMBusMath as legacy adapter          ✅ 已完成
7. migrate COMMAND_METADATA                     ✅ 已完成
8. L11 full loop                                🔄 进行中（当前）
9. L16 full loop                                ⬜ 待办
10. DIRECT full loop                             ⬜ 待办
11. HALF full loop                               ⬜ 待办
12. copy tools                                   ⬜ 待办
13. debug tests migration                        ⬜ 待办
14. legacy cleanup                               ⬜ 待办
```

不要先做 DIRECT/HALF，而跳过 L11。  
L11 是主路径和首个闭环。  
当前执行位置：第 8 项 L11 full loop。

---

## 11. 每次修改必须更新追踪

如果你改了代码，必须检查是否需要更新：

```text
docs/WEB_REFACTOR_PLAN.md
docs/MIGRATION_LOG.md
AGENTS.md
README.md
```

### 11.1 变更记录格式

```md
| Change ID | Date       | Files       | Type | Affected Modes | Tests | Docs Updated | Status |
| --------- | ---------- | ----------- | ---- | -------------- | ----- | ------------ | ------ |
| WEB-0001  | 2026-04-29 | src/App.tsx | add  | GLOBAL         | build | yes          | Done   |
```

### 11.2 Migration Gap 必须同步

如果迁移了旧功能，更新：

```md
| Legacy Feature | Legacy Location | New Component | Status | Notes |
```

---

## 12. 测试规则

### 12.1 算法测试

PMBusMath 迁移后必须至少有：

```text
linear11 tests
linear16 tests
direct tests
half tests
pec tests
```

### 12.2 UI 测试

至少覆盖：

```text
mode switch
hex input
value input
bit toggle
copy hex
theme toggle
mobile layout smoke
```

### 12.3 禁止

禁止删除旧 `runBoundaryTests`，除非：

```text
对应 Vitest 测试已存在
测试命令已写入 package.json
文档已记录替代关系
```

---

## 13. 复制功能规则

必须保留：

```text
Copy Hex
Copy Value
Copy C Macro
0x prefix toggle
space between bytes toggle
LE/BE toggle
copy feedback
```

复制格式变更必须记录。

---

## 14. 命令字典规则

Command metadata 必须数据化。

每个 command 至少包含：

```ts
{
  key: string;
  label: string;
  cmd: number;
  mode: AppMode;
  type: string;
  spec?: string;
  note?: string;
}
```

禁止让 CommandPicker 内部写死命令列表。

---

## 15. 可访问性规则

必须满足：

```text
输入有 label
按钮有可读名称
结果区域 aria-live
错误不只靠颜色表达
CommandPicker 可键盘操作
ModeSwitcher 使用合适 role
```

---

## 16. 本地存储规则

localStorage 访问必须集中在 persistence 层。

允许保存：

```text
theme
last mode
copy preferences
last value
```

不要在随机组件中直接写 localStorage。

---

## 17. 性能规则

保留现有性能思想：

```text
高频输入合帧
bit grid 不做无意义重建
移动端避免布局抖动
大计算不要放 render 中重复执行
```

React 中使用：

```text
useMemo for viewModel
useCallback only when necessary
memo only for明显热路径组件
```

不要过早优化。

---

## 18. 错误处理规则

输入错误必须：

```text
不崩溃
不清空用户正在输入的半成品
显示明确提示
保留编辑态
blur 时再修正可修正输入
```

特别注意：

```text
1e
-
+
.
NaN
Infinity
-Infinity
hex 非法字符
m=0
VOUT_MODE 非 LINEAR
```

---

## 19. Pull Request 检查清单

每次提交前必须确认：

```md
## Agent Checklist

- [ ] 我已阅读 AGENTS.md
- [ ] 本次变更符合 Web-first 当前主线
- [ ] 没有引入 Tauri/Electron/后端/硬件通信
- [ ] 没有无测试修改 PMBus 算法
- [ ] 没有删除旧功能而不记录 Migration Gap
- [ ] 没有新增 inline onclick
- [ ] 没有新增散落 localStorage 写入
- [ ] 已运行 lint/typecheck/test/build 或说明无法运行原因
- [ ] 已更新相关文档
- [ ] 已检查移动端布局影响
```

---

## 20. 当前优先任务

如果没有更具体任务，Agent 应从这里开始：

```text
1. 完成 M3：L11 full loop（当前主任务）
   - 实现 value/set 的 encode 逻辑（含 auto-N 的 findBestLinear11 行为）
   - Y/N 编辑回写 raw，Hex ↔ Y/N/Value 双向同步
   - 接入 delta / 误差展示
   - 补齐 L11 golden 测试
2. 完成 M4：L16 / VOUT_MODE 闭环
3. 完成 M5：DIRECT 闭环
4. 完成 M6：HALF 闭环
5. 完成 M7：复制偏好（0x / 空格 / LE-BE toggle）
6. 完成 M8：测试回归保护与 debug 测试迁移
7. 旧 HTML 下线或保留（按规划文档决策）
```

已完成的基础项（M0–M2，不再重复执行）：

```text
docs / AGENTS / CLAUDE
Vite React TS skeleton
design tokens
AppShell 静态布局
ModeSwitcher / CommandPicker / ResultInspector 静态组件
PMBusMath 迁移到 legacy adapter
COMMAND_METADATA 迁移到 legacy/command-metadata.ts
```

> 实际实现进度基线以 `docs/WEB_REFACTOR_PLAN.md` 各 Milestone 的「实际状态」小节与 `MIGRATION_LOG.md` 的迁移缺口表为准。

---

## 21. Claude 专用说明

如果你是 Claude Code，请遵守：

```text
先读 AGENTS.md
再读 docs/WEB_REFACTOR_PLAN.md
再读当前源文件
每次只做一个 Milestone 的一部分
不要把重构扩大成全项目重写
完成后输出 changed files、tests、docs updated
```

---

## 22. 最后提醒

当前最重要的是：

```text
Web 设计重构
组件边界
状态清晰
迁移可追踪
算法不破坏
移动端不退化
```

任何与这个目标无关的大动作，都应该延后。
