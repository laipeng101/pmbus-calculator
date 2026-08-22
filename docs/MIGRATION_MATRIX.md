# MIGRATION MATRIX

> 本文件只保留当前 parity 与仍存在的 migration gaps。
> 里程碑状态见 [`ROADMAP.md`](ROADMAP.md)；领域规则见 [`DOMAIN_MODEL.md`](DOMAIN_MODEL.md)。
> M0–M10.1 的完整历史质量矩阵与 WEB-0000…WEB-0023 变更日志已冻结到
> [`archive/web-refactor-m0-m10.1/MIGRATION_MATRIX_FULL.md`](archive/web-refactor-m0-m10.1/MIGRATION_MATRIX_FULL.md)。

最后更新：2026-08-22（M21：viewport 业务矩阵 gap 关闭）

## 当前 parity

| 旧功能              | 当前状态                                                  |
| ------------------- | --------------------------------------------------------- |
| PMBusMath 核心      | Done：已迁移到 `src/legacy/pmbus-math.ts`，带 golden case |
| 命令字典数据        | Done：`src/legacy/command-metadata.ts` 是唯一数据源       |
| L11/L16/DIRECT/HALF | Done：四种模式双向闭环，E2E 覆盖桌面 + 移动 Chromium      |
| 复制/主题/偏好      | Done：复制工具、主题与偏好持久化已接入新应用              |
| legacy HTML         | 明确保留为 read-only fallback：`pmbus-calculator.html`    |

## Deferred / Blocked items

以下为 Deferred / Blocked items，不是当前功能缺陷：

- **DIRECT `device-datasheet` profiles**：Blocked——缺少真实数据手册；UI 保持手动系数输入并提示需要器件数据手册。
- **独立 FormulaEditor**：Deferred（optional）——不是缺陷。
- **legacy HTML fallback**：Deferred（明确保留）——`pmbus-calculator.html` 作为 read-only fallback 保留，不删除、不移动、不重写。
- **PMBus 新版规范升级**：Deferred（独立工作）——当前不得自动开展。

> 「更全面 viewport 业务矩阵」Deferred 项已于 M21 关闭：四模式 + CommandPicker +
> 全局快捷键的 pairwise 业务矩阵已交付（`tests/e2e/input-interaction.spec.ts`）。

## 变更审计来源

从 M10.2 开始，不再新增 WEB-xxxx 手工变更记录；PR、commit 和 CI 是变更审计来源。
