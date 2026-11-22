# PMBus 数值格式计算器

[English](README.md) · 简体中文

在浏览器里换算 PMBus 编码和物理值，查看每个位的含义，或查询标准命令。

[在线使用](https://laipeng101.github.io/pmbus-calculator/) · [下载最新版](https://github.com/laipeng101/pmbus-calculator/releases/latest) · [查看发布历史](https://github.com/laipeng101/pmbus-calculator/releases)

## 使用方法

1. 按器件数据手册选择格式。输入十六进制数查看计算结果，或在支持编码的模式下输入物理值。也可以点击位网格，查看翻转某个位后的结果。
2. 查看结果和计算式。展开「命令参考」可查命令码、事务和格式来源，查看命令不会改变计算。
3. 按需复制 `Raw Word Hex`、`Wire 字节`、`MSB-first 字节`、`物理值`或 `C 代码`。如果要和总线抓包对照，请使用低字节在前的 `Wire 字节`。

| 页面        | 用途                                                                   | 快捷键     |
| ----------- | ---------------------------------------------------------------------- | ---------- |
| LINEAR11    | 在数据字和物理值之间换算，可自动选取表示误差最小的指数 N，或手动指定 N | `Ctrl + 1` |
| LINEAR16    | 使用 `VOUT_MODE` 的指数换算绝对电压、解读相对比值或换算有符号电压偏移  | `Ctrl + 2` |
| DIRECT      | 使用器件数据手册中的 m、b、R 系数换算                                  | `Ctrl + 3` |
| IEEE 半精度 | 换算 IEEE 754 binary16，包括无穷大和 NaN                               | `Ctrl + 4` |
| VOUT_MODE   | 编辑配置字节，查看绝对或相对模式、数据格式和参数位                     | `Ctrl + 5` |

解读 LINEAR16 相对比值时，提供 `VOUT_COMMAND` 标称电压即可计算实际电压。编辑输入框时，模式切换快捷键暂不生效。换算公式、允许的格式组合及各模式的限制见[领域规则](docs/DOMAIN_MODEL.md)。

## 自托管和离线使用

从[最新版](https://github.com/laipeng101/pmbus-calculator/releases/latest)下载 Web ZIP 和 `SHA256SUMS.txt`，解压后用静态 HTTP 服务器提供其中的文件。需要直接打开 HTML 时，可下载[旧版单文件](pmbus-calculator.html)，并查阅[已知数值差异](docs/LEGACY_COMPATIBILITY.md)。

## 隐私

计算在浏览器内完成。在线版使用 Cloudflare Web Analytics 统计访问量，自托管的发布包不含访问统计。计算器输入与结果不会作为统计事件发送。[部署与隐私详情](docs/DEPLOYING.md)

## 开发与许可

[贡献指南](CONTRIBUTING.md) · [架构决策](docs/adr/) · [MIT 许可证](LICENSE) · [第三方规范文档声明](THIRD_PARTY_NOTICES.md)
