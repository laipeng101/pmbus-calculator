# ROADMAP

> 本文件是里程碑状态的唯一事实来源。不要在其他文档中重复维护进度表。
> 变更记录与 legacy parity 见 [`MIGRATION_MATRIX.md`](MIGRATION_MATRIX.md)。

最后更新：2026-08-15（M0–M10.1 已合入 main）

## 当前优先级

```text
M0–M9 feature baseline implemented；M10 hardening 与 M10.1 correctness 已合入 main。
```

M4.5 / M4.5.1 已验收通过；M5 DIRECT 通过 PR #3、M6 HALF 通过 PR #4、M7 Copy 通过 PR #5、M8 回归通过 PR #6、M9 legacy 决策通过 PR #7、文档基线通过 PR #8 合入 `main`。

## M10.1 correctness（Done）

已完成项：

- [x] CommandPicker 焦点回归：外部点击不抢焦点；Escape/Enter/option 关闭恢复 trigger 焦点。
- [x] ARIA editable combobox：`role="combobox"`、`aria-autocomplete`、`aria-expanded`、`aria-controls`、`aria-activedescendant` 位于聚焦 input，listbox 有稳定 id。
- [x] READ_EIN 规范冲突：使用 `dataBytesConflict` 同时呈现 §18.13（6）与 Appendix I Table 31（5），不再提供单一权威 dataBytes。
- [x] L16 十进制 V 输入：完整字符串解析，拒绝 `12abc`/`1e2`/`1.5`/仅符号；有效值继续 clamp 0..65535。
- [x] whitespace gate 真生效：本地 `git diff --check` + `git diff --cached --check`；CI 检查完整 PR diff（base..head）与 push commit。
- [x] 官方规范版本声明：当前基线 PMBus 1.3；Rev 1.3.1 冲突仍在；1.5 不评估、不声明兼容，列入独立 backlog。

## M10 hardening（Done）

已完成项：

- [x] 文档/流程与 CI 门禁一致（分支基线、`npm run verify`、audit、`git diff --check`）
- [x] PMBus 命令元数据：以 Part II Appendix I Table 31 校准 read/write transactions 与数据宽度
- [x] 严格十六进制输入：拒绝 partial parse、超长与 `0x` 空前缀，不静默截断
- [x] DIRECT 校验错误隔离：只在 DIRECT 模式显示，有效 preset 清除旧错误
- [x] 持久化测试补齐（load/persist、非法 JSON/枚举/旧数据/异常/SSR）
- [x] 响应式 viewport loop 轻量检查（1440/1024/768/430/390/360）
- [x] CommandPicker listbox/option 语义与 `aria-activedescendant` 补强（P2）
- [x] 全量验证通过并合并 M10 PR

## 里程碑状态

| Milestone | 名称                                  | 状态 | 备注                                                                                                                    |
| --------- | ------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------- |
| M0        | 准备期                                | Done | 文件实际在仓库根目录与 `docs/`，见迁移矩阵                                                                              |
| M1        | Vite + React + TS 骨架                | Done | build/lint/typecheck 通过                                                                                               |
| M2        | 新版 Web 视觉框架                     | Done | Playwright 双端布局验证                                                                                                 |
| M3        | L11 模式闭环                          | Done | 双向闭环 + 超范围饱和 golden case                                                                                       |
| M4        | L16 / VOUT 模式闭环                   | Done | 双向闭环 + V 输入 clamp golden case                                                                                     |
| M4.5      | 稳定化门禁                            | Done | 质量门禁、L11/L16 纠偏、命令/预设分离、文档体系全部验收                                                                 |
| M5        | DIRECT 模式闭环                       | Done | PR #3 已合入：`state.raw` 唯一事实来源；Y/Value/m/b/R 完整 UI                                                           |
| M6        | HALF 模式闭环                         | Done | PR #4 已合入：Value 输入闭环；Sign/Exponent/Mantissa 分区显示                                                           |
| M7        | 复制与工程输出                        | Done | PR #5 已合入：raw word 与 LE/BE bytes 分离；C 宏命令名                                                                  |
| M8        | 测试与回归保护                        | Done | PR #6 已合入：golden 全覆盖与 CommandPicker 键盘/ARIA                                                                   |
| M9        | 旧 HTML 下线或保留                    | Done | PR #7 已合入：`pmbus-calculator.html` 标记为 read-only legacy fallback                                                  |
| M10       | 标准、输入与门禁加固                  | Done | PR 已合入：校准 PMBus 元数据、严格 Hex 输入、DIRECT 错误隔离、持久化/响应式测试、CI 门禁统一                            |
| M10.1     | 焦点/规范冲突/十进制输入/真实 CI gate | Done | PR 已合入：CommandPicker focus + editable combobox、READ_EIN 冲突模型、L16 十进制严格解析、完整 PR diff whitespace gate |

## M4.5 稳定化门禁（已完成）

目标：先补齐质量门禁与已完成模式的纠偏，再继续新功能。

- [x] CI 运行 format/typecheck/lint/coverage/Playwright E2E/build，并上传失败报告
- [x] Playwright mobile 项目使用真正的 Chromium（Pixel 7），不再用 iPhone 14/WebKit
- [x] L11 超范围值饱和到 ±极限码，不再错误编码为 `0x0000`
- [x] L16 手动 V 输入 clamp 到 `0..65535`，不再回绕
- [x] 命令选择只显示命令信息，不再自动应用参数
- [x] `command/apply-preset` 显式应用 project-demo 预设，演示值不伪装成规范默认值
- [x] `STATUS_WORD` / `READ_EIN` 不再被强制标为 L11 / DIRECT
- [x] 命令元数据拆分标准定义与预设，新增 `encodingRule`（见 ADR 0002）
- [x] `FAN_COMMAND` 更正为 `FAN_COMMAND_1`（0x3B）
- [x] `encodeHalf` 修正 subnormal→normal 边界与 tie-to-even
- [x] 主题由 `state.ui.theme` 驱动并统一持久化
- [x] Debug 面板不再宣称 CI 测试状态
- [x] 生产构建注入 CSP meta
- [x] Vite/Vitest 安全补丁已升级；`npm audit` 0 漏洞
- [x] Node 运行时契约写入 `engines` / `.node-version` / `.nvmrc`
- [x] pre-commit 不再 `prettier --write . && git add -u`
- [x] 文档体系拆分（AGENTS/CONTRIBUTING/ROADMAP/MIGRATION_MATRIX/DOMAIN_MODEL/ADR/PR模板/Issue模板）
- [x] PR #2 已建立并合入 `main`

## M5 DIRECT 进入条件

- [x] M4.5 门禁全部完成
- [x] M3/M4 已确认为 Done
- [x] DIRECT 的 raw 与 signed Y 只有一个事实来源（`state.raw`）
- [x] DIRECT profile 绑定器件与来源，不虚构标准系数

## M5 DIRECT 完成标准

- [x] `state.direct` 只保存 m/b/R；Y 由 `toSigned(raw, 16)` 派生
- [x] Hex 输入、bit toggle、Y 输入、Value 输入双向同步
- [x] Y clamp -32768..32767；m/b signed 16-bit integer；R signed 8-bit integer；m≠0
- [x] 系数非法时显示明确错误，不静默接受浮点数或超范围值
- [x] 保留 legacy DIRECT `Math.round` 舍入并写入 DOMAIN_MODEL，含 golden case
- [x] 桌面 + 移动 Chromium E2E 覆盖 DIRECT 闭环

## M6 HALF 进入条件

- [x] M5 完成并合入
- [x] `encodeHalf` 接入 UI（Value 输入）
- [x] Half bit grid 分区与图例

## M6 HALF 完成标准

- [x] Value → binary16 → Value 闭环
- [x] +0 / -0 / NaN / +Infinity / -Infinity 作为一等值支持并保留
- [x] bit grid 分区显示 Sign[15] / Exponent[14:10] / Mantissa[9:0]
- [x] dedicated golden cases：`0x0000/0x8000/0x0001/0x03FF/0x0400/0x3C00/0x7BFF/0x7C00/0xFC00/NaN` 与 tie-to-even 边界
- [x] 桌面 + 移动 Chromium E2E 覆盖 Hex/Value/bit 三方向

## M7 Copy/工程输出进入条件

- [x] M6 完成并合入
- [x] 明确 raw word 与 on-wire LE/BE bytes 的边界
- [x] 偏好持久化已有测试

## M7 Copy/工程输出完成标准

- [x] C 宏默认输出未交换 16-bit raw word；LE/BE bytes 提供独立复制按钮
- [x] 有命令时 C 宏使用安全清洗后的命令名；无命令使用 `RAW_VALUE`
- [x] prefix / space / LE-BE / 命令名 / clipboard fallback / 偏好 reload 均有测试
- [x] 桌面 + 移动 Chromium E2E 覆盖复制流程

## M8 回归进入条件

- [x] M7 完成并合入
- [x] L11/DIRECT/HALF golden 已有
- [x] E2E 桌面 + Pixel 7 Chromium 覆盖四种模式闭环

## M8 回归完成标准

- [x] L11/L16/DIRECT/HALF/PEC 均有 dedicated golden-case 测试集合
- [x] CommandPicker 键盘导航、Enter 选择、Escape 关闭、焦点恢复、ARIA 均有 E2E 覆盖
- [x] 组件分层覆盖策略写入 AGENTS.md（components 由 Playwright E2E 覆盖，不纳入 v8 coverage 阈值）
- [x] E2E 保持桌面 + Pixel 7 Chromium，覆盖 L11/L16/DIRECT/HALF 四种模式闭环
- [x] UI 文案不包含硬编码测试数量

## M9 legacy 决策

- [x] 新应用 L11/L16/DIRECT/HALF 四模式闭环回归完成（M3–M6）
- [x] 命令选择、复制、响应式、主题回归完成（M4.5/M7/M8）
- [x] `pmbus-calculator.html` 保留在根目录，作为 read-only legacy fallback，不删除、不移动、不重写
- [x] 旧 URL 兼容：文件路径不变，继续可直接打开
- [x] README 明确新版与 legacy 的入口及状态
