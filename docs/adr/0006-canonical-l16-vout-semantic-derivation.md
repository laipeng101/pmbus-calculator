# ADR 0006 共用 LINEAR16 解释

同一 VOUT_MODE 字节可能参与绝对值、相对比值或有符号偏移的计算。公式、结果、步骤、复制和量化曾各自推断分支，容易对配置是否有效或标称电压是否存在得出不同判断。

[deriveL16Semantics](../../src/app/l16-derivation.ts) 从状态派生共享字节的分析、命令数据格式和原始值解释。呈现层按该结果输出文案和公式。字段输入事务和位网格各自处理输入与位编辑。独立 VOUT_MODE 页使用[格式要求](../../src/app/vout-mode-requirements.ts)解释字节配置。[LINEAR16 规则](../DOMAIN_MODEL.md#22-linear16) · [VOUT_MODE 规则](../DOMAIN_MODEL.md#3-vout_mode)
