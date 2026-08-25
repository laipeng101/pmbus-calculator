# MIGRATION MATRIX

> 本文件只保留当前 parity 与仍存在的 migration gaps。
> 里程碑状态见 [`ROADMAP.md`](ROADMAP.md)；领域规则见 [`DOMAIN_MODEL.md`](DOMAIN_MODEL.md)。
> M0–M10.1 的完整历史质量矩阵与 WEB-0000…WEB-0023 变更日志已冻结到
> [`archive/web-refactor-m0-m10.1/MIGRATION_MATRIX_FULL.md`](archive/web-refactor-m0-m10.1/MIGRATION_MATRIX_FULL.md)。

最后更新：2026-08-25（v2.0.0：产品定位、Pages/legacy 定位与命令参考说明对齐）

## 当前 parity

| 旧功能              | 当前状态                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------- |
| PMBusMath 核心      | Done：已迁移到 `src/legacy/pmbus-math.ts`，带 golden case                                 |
| 命令字典数据        | Done：`src/legacy/command-metadata.ts` 是唯一数据源；只读命令参考，无 preset/无选择副作用 |
| L11/L16/DIRECT/HALF | Done：四种模式双向闭环，E2E 覆盖桌面 + 移动 Chromium                                      |
| 复制/主题/偏好      | Done：复制工具、主题与偏好持久化已接入新应用                                              |
| legacy HTML         | 保留仓库内离线兼容用途，只接受必要纠偏；不再作为 Pages 产品入口                           |

## Deferred / Blocked items

以下为 Deferred / Blocked items，不是当前功能缺陷：

- **DIRECT `device-datasheet` profiles**：Blocked——缺少真实数据手册；UI 保持手动系数输入并提示需要器件数据手册。
- **独立 FormulaEditor**：Deferred（optional）——不是缺陷。
- **legacy HTML fallback**：Deferred（明确保留）——`pmbus-calculator.html` 保留仓库内离线兼容用途，只接受必要纠偏，不再作为当前 Pages 产品入口；Pages 根路径为产品入口（返回 200），仅 legacy `/pmbus-calculator.html` 路径为 404。
- **PMBus 新版规范升级**：Deferred（独立工作）——当前不得自动开展。

> 「更全面 viewport 业务矩阵」Deferred 项已于 M21 关闭：四模式 + 命令参考 +
> 全局快捷键的 pairwise 业务矩阵已交付（`tests/e2e/input-interaction.spec.ts`）。

## 变更审计来源

从 M10.2 开始，不再新增 WEB-xxxx 手工变更记录；PR、commit 和 CI 是变更审计来源。
