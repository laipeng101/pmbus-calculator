# ROADMAP

> 本文件是里程碑状态的唯一事实来源。不要在其他文档中重复维护进度表。
> 变更记录与 legacy parity 见 [`MIGRATION_MATRIX.md`](MIGRATION_MATRIX.md)。

最后更新：2026-08-15（M4.5.1 完成，进入 M5 DIRECT）

## 当前优先级

```text
M5 DIRECT（当前） → M6 HALF → M7 Copy/工程输出 → M8 测试回归 → M9 legacy 决策
```

M4.5 / M4.5.1 已验收通过；PR #2 已建立并合入 `main`。

## 里程碑状态

| Milestone | 名称                   | 状态   | 备注                                                       |
| --------- | ---------------------- | ------ | ---------------------------------------------------------- |
| M0        | 准备期                 | Done   | 文件实际在仓库根目录与 `docs/`，见迁移矩阵                 |
| M1        | Vite + React + TS 骨架 | Done   | build/lint/typecheck 通过                                  |
| M2        | 新版 Web 视觉框架      | Done   | Playwright 双端布局验证                                    |
| M3        | L11 模式闭环           | Done   | 双向闭环 + 超范围饱和 golden case                          |
| M4        | L16 / VOUT 模式闭环    | Done   | 双向闭环 + V 输入 clamp golden case                        |
| M4.5      | 稳定化门禁             | Done   | 质量门禁、L11/L16 纠偏、命令/预设分离、文档体系全部验收    |
| M5        | DIRECT 模式闭环        | Review | PR 待合入：`state.raw` 唯一事实来源；Y/Value/m/b/R 完整 UI |
| M6        | HALF 模式闭环          | Todo   | decode 已有，encode 已修，待接 UI 与 bit 分区              |
| M7        | 复制与工程输出         | Todo   | 基础复制可用；raw word 与 LE/BE bytes 需明确定义           |
| M8        | 测试与回归保护         | Todo   | L11 golden 已有；L16/DIRECT/HALF golden 待补               |
| M9        | 旧 HTML 下线或保留     | Todo   | 新应用全回归前保留 legacy 为 read-only fallback            |

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

- [ ] M5 完成并合入
- [ ] `encodeHalf` 接入 UI（Value 输入）
- [ ] Half bit grid 分区与图例

## M7 Copy/工程输出进入条件

- [ ] M6 完成并合入
- [ ] 明确 raw word 与 on-wire LE/BE bytes 的边界
- [ ] 偏好持久化已有测试
