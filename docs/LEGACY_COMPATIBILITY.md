# 旧版单文件兼容性

[`pmbus-calculator.html`](../pmbus-calculator.html) 供仓库内离线使用，只接受必要纠偏。其 GitHub Pages 路径返回 404，官方站点根路径提供当前 Web App。部署规则见 [DEPLOYING](DEPLOYING.md)。

当前 Web App 的数值行为以 [领域模型](DOMAIN_MODEL.md) 和 [数值实现](../src/legacy/pmbus-math.ts) 为准。离线单文件有以下已知差异。

- **LINEAR11 自动选择指数** — 旧版 `findBestLinear11` 以 `1e-15` 容差判断误差并列，且缺少当前实现的全范围饱和规则。接近并列或超出范围时，编码结果可能不同。
- **HALF 尾数舍入** — 旧版 `encodeHalf` 使用 `Math.round`，尾数遇到中点会向上取整。当前实现使用 IEEE 754 round-to-nearest-even。例如，`1 + 2^-11` 在旧版编码为 `0x3C01`，当前编码为 `0x3C00`。
- **ULINEAR16 编码** — 旧版未被调用的 `encodeLinear16` 忽略指数 `N`，只将输入限制在 `0..65535`。当前实现按照 PMBus Part II §8.4.1，对 `X / 2^N` 取整后再限制范围。
