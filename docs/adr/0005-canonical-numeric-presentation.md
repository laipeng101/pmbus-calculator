# ADR 0005 共用数值格式

同一数值会显示在结果、公式和计算步骤里。各自舍入或拼接特殊值会让一次换算显示出不同的数值。三处共用 [numeric-presentation.ts](../../src/app/numeric-presentation.ts)，LaTeX 只处理特殊值需要的标记。普通数字格式、显式带符号的特殊值和误差读数各自按用途调用同一模块。

显示可能缩短位数。物理值复制需要满足相应格式的精度要求，DIRECT 的精确重输见 [ADR 0007](0007-direct-text-reentry-contract.md)。
