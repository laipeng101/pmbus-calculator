# ROADMAP

> 本文件是里程碑状态的唯一事实来源。不要在其他文档中重复维护进度表。
> 变更记录与 legacy parity 见 [`MIGRATION_MATRIX.md`](MIGRATION_MATRIX.md)。

最后更新：2026-08-15（M4.5 稳定化阶段）

## 当前优先级

```text
M4.5 稳定化（当前） → M5 DIRECT → M6 HALF → M7 Copy/工程输出 → M8 测试回归 → M9 legacy 下线
```

在 M4.5 验收通过之前，不进入 M5 DIRECT。

## 里程碑状态

| Milestone | 名称                   | 状态   | 备注                                             |
| --------- | ---------------------- | ------ | ------------------------------------------------ |
| M0        | 准备期                 | Done   | 文件实际在仓库根目录与 `docs/`，见迁移矩阵       |
| M1        | Vite + React + TS 骨架 | Done   | build/lint/typecheck 通过                        |
| M2        | 新版 Web 视觉框架      | Done   | Playwright 双端布局验证                          |
| M3        | L11 模式闭环           | Review | 常规闭环可用；需补齐超范围饱和的 golden case     |
| M4        | L16 / VOUT 模式闭环    | Review | 常规闭环可用；需补齐 V 输入 clamp 的 golden case |
| M4.5      | 稳定化门禁             | Active | 见下方验收标准                                   |
| M5        | DIRECT 模式闭环        | Todo   | 门禁通过后才开始                                 |
| M6        | HALF 模式闭环          | Todo   | decode 已有，encode 已修但未接 UI                |
| M7        | 复制与工程输出         | Todo   | 基础复制可用；偏好 UI 已接，持久化已统一         |
| M8        | 测试与回归保护         | Todo   | L11 golden 已有；L16/DIRECT/HALF golden 待补     |
| M9        | 旧 HTML 下线或保留     | Todo   | 建议保留为 legacy                                |

## M4.5 稳定化门禁（当前）

目标：先补齐质量门禁与已完成模式的纠偏，再继续新功能。

- [x] CI 运行 format/typecheck/lint/coverage/Playwright E2E/build，并上传失败报告
- [x] Playwright mobile 项目使用真正的 Chromium（Pixel 7），不再用 iPhone 14/WebKit
- [x] L11 超范围值饱和到 ±极限码，不再错误编码为 `0x0000`
- [x] L16 手动 V 输入 clamp 到 `0..65535`，不再回绕
- [x] 命令选择会加载模式、Value、N/VOUT_MODE、DIRECT 系数并重新编码 raw
- [x] `STATUS_WORD` / `READ_EIN` 不再被强制标为 L11 / DIRECT
- [x] 命令元数据区分 `dataFormat` / `transactionType` / `valueType` / profile 来源
- [x] `encodeHalf` 修正 subnormal→normal 边界与 tie-to-even
- [x] 主题由 `state.ui.theme` 驱动并统一持久化
- [x] Debug 面板不再宣称 CI 测试状态
- [x] 生产构建注入 CSP meta
- [x] Vite/Vitest 安全补丁已升级；`npm audit` 0 漏洞
- [x] Node 运行时契约写入 `engines` / `.node-version` / `.nvmrc`
- [x] pre-commit 不再 `prettier --write . && git add -u`
- [x] 文档体系拆分（AGENTS/CONTRIBUTING/ROADMAP/MIGRATION_MATRIX/DOMAIN_MODEL/ADR/PR模板/Issue模板）

### M4.5 验收标准

- [x] `npm run check` 本地通过（format/typecheck/lint/test/build）
- [x] `npm run test:coverage` 达到阈值
- [x] `npm run test:e2e` 覆盖 Hex/Value/bit/command/copy/theme 真实流程
- [x] `npm audit` 为 0 漏洞
- [ ] 开放 `web-refactor → main` Draft PR 并评审（需仓库权限，代码侧已满足）

## M5 DIRECT 进入条件

- [x] M4.5 门禁全部完成
- [ ] M3/M4 被评审为 Done
- [ ] DIRECT 的 raw 与 signed Y 只有一个事实来源
- [ ] DIRECT profile 绑定器件与来源，不虚构标准系数

## M6 HALF 进入条件

- [ ] M5 完成并评审
- [ ] `encodeHalf` 接入 UI（Value 输入）
- [ ] Half bit grid 分区与图例

## M7 Copy/工程输出进入条件

- [ ] M6 完成
- [ ] 复制偏好 UI 已接（0x/空格/LE-BE）
- [ ] 偏好持久化已有测试
