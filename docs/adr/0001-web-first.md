# ADR 0001: Web-first 重构顺序

- 状态：Accepted
- 日期：2026-04-29
- 决策者：项目维护者

## 背景

`pmbus-calculator.html` 是单文件 HTML 工具，包含内联 CSS/JS、PMBusMath、命令字典、四种模式与调试测试。直接迁移到 App 壳或后端会放大风险。

## 决策

采用 **Web-first → 逐模式闭环 → 再下线 legacy** 的路线：

1. 先建立 Vite + React + TS 工程与设计 token。
2. 机械迁移 PMBusMath 与命令字典，保留旧行为。
3. 按 L11 → L16 → DIRECT → HALF 逐模式做双向闭环。
4. 每个里程碑有 golden case 与 E2E。
5. 全部闭环并通过质量门禁后，才决定旧 HTML 下线/保留。

## 后果

- 优点：风险小、可追踪、旧工具始终可用。
- 代价：短期新旧并存；文档需要严格拆分，避免进度漂移。
- 约束：DIRECT 闭环前必须先通过 M4.5 稳定化门禁。
