# MIGRATION MATRIX

> 本文件只保留当前 parity 与仍存在的 migration gaps。
> 里程碑状态见 [`ROADMAP.md`](ROADMAP.md)；领域规则见 [`DOMAIN_MODEL.md`](DOMAIN_MODEL.md)。
> M0–M10.1 的完整历史质量矩阵与 WEB-0000…WEB-0023 变更日志已冻结到
> [`archive/web-refactor-m0-m10.1/MIGRATION_MATRIX_FULL.md`](archive/web-refactor-m0-m10.1/MIGRATION_MATRIX_FULL.md)。

最后更新：2026-09-01（v2.6.4：legacy HTML 已知数值偏差披露）

## 当前 parity

| 旧功能              | 当前状态                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------- |
| PMBusMath 核心      | Done：已迁移到 `src/legacy/pmbus-math.ts`，带 golden case                                 |
| 命令字典数据        | Done：`src/legacy/command-metadata.ts` 是唯一数据源；只读命令参考，无 preset/无选择副作用 |
| L11/L16/DIRECT/HALF | Done：四种模式双向闭环，E2E 覆盖桌面 + 移动 Chromium                                      |
| 复制/主题/偏好      | Done：复制工具、主题与偏好持久化已接入新应用                                              |
| legacy HTML         | 保留仓库内离线兼容用途，只接受必要纠偏；不再作为 Pages 产品入口                           |

## legacy HTML 已知数值偏差（v2.6.4 披露，离线归档内接受）

`pmbus-calculator.html` 是仓库内离线兼容归档（见下），与当前应用存在两处已知数值
行为差异。二者都是历史实现的既成事实，不属于待修复缺陷——除非被定性为「必要纠偏」，
否则按归档政策保持原样；权威数值行为以当前应用（`src/legacy/pmbus-math.ts`）为准：

- **`findBestLinear11` tie 判定**：归档实现以 `1e-15` epsilon 判定误差相等（约
  1161 行），且缺少 v2.5.10 起现代实现的严格最近值（strictly-nearest）与全范围
  饱和合同；自动 N 搜索的 tie/越界结果可能与当前应用不同。
- **`encodeHalf` 舍入方向**：归档实现用 `Math.round` 处理尾数（约 1216 行），.5
  向 +∞ 舍入，不符合 IEEE 754 round-to-nearest-even（如 `1 + 2^-11` 的编码与
  IEEE RNE 不同）；当前 HALF 模式页按 RNE 合同实现。

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
