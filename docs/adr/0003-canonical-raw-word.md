# ADR 0003: Canonical Raw Word 与字节序列化分层

- 状态：Accepted
- 日期：2026-09-04
- 决策者：项目维护者

## 背景（Context）

v2.6.5 为修复 L16 主 Hex 的字节序歧义，把「主 Hex 输入/显示」定义为所选字节序
的 2 字节 byte stream（BE `1234` 与 LE `3412` 同指 word `0x1234`），由
`AppState.byteOrder` + `byte-order/set`（L16 下拉）控制。该方案消除了此前
BE 输入稳定反向解码的缺陷，但引入了更深的模型问题：同一个界面上「raw」存在
两个定义——主 Hex 字段可能显示 `8FC3` 而位网格、`rawWordHex` 与 C 宏是
`C38F`；`copy.endian` + `copy/set-endian`（「Hex 复制顺序」偏好）又让复制
文本在 `1234`/`3412` 之间切换。字节序从 serialization 细节上升成了 raw
identity 的一部分，且持久化在 `pmbus-calculator:byteOrder` 键中。

## 决策（Decision）

v3.0.0 起建立两个明确分离的层：

1. **Canonical Raw Word**：`state.raw` 是唯一的无符号 16-bit 数值位型真值。
   主 Raw Word Hex 输入/显示、位网格、公式操作数、decode/encode、Raw Word
   复制与 C 宏都指向它；`parse(formatRawWordHex(raw)) === raw` 对合法的
   全部 16-bit raw 成立，不受 mode、byte order、copy 偏好影响。
2. **Serialization 层**：byte order 只存在于字节序列表示——SMBus / PMBus
   Wire Bytes（低字节在前；SMBus 3.0 §6.5.4/§6.5.5，PMBus Part I
   §5.6.3.2.4 DS=0 默认）与 MSB-first 字节（高字节在前，仅对照表示）。
   复制模型是显式 representation actions（Raw Word / Wire 字节 /
   MSB-first 字节 / 物理值 / C 代码），不是全局 endian 开关。

相应删除：`AppState.byteOrder`、`byte-order/set`、`copy.endian`、
`copy/set-endian`、L16 字节序下拉；持久化不再读取
`pmbus-calculator:byteOrder` 与 copy JSON 的 `endian` 字段（显式逐字段
挑选，旧存储遗留值无害）。

## 为什么 v2 行为是歧义的（Why v2 behavior was ambiguous）

- 同名 "Hex" 承载两种含义：L16 主字段是 byte stream，其余面板与全部其他
  模式是 numeric word——用户无法从界面分辨当前看到的是哪一种。
- 「字节序」作为全局偏好同时影响输入解释与显示顺序，使「输入 `3412`」的
  结果取决于一个与 PMBus 数学无关的 UI 偏好。
- LE/BE 被并列呈现为两种可选字节序，掩盖了「SMBus/PMBus word 线上只有一种
  顺序（低字节在前）」的规范事实。

## Breaking 影响（Breaking impact）

- L16 下输入 `3412` 不再产生 raw `0x1234`（v2 LE 字节流解释被否定）。
- 「Hex 复制顺序」偏好与 L16 字节序下拉不再存在。
- 旧 localStorage 偏好（`byteOrder`、`copy.endian`）被忽略。
- 稳定公共契约（raw word、字节序、复制格式、持久化偏好）变更 → 按 SemVer
  使用 MAJOR（v3.0.0）。

## 被否决的替代方案（Alternatives rejected）

- **保留 v2 双语义 + compatibility toggle**：维持两个 "raw" 定义，歧义只是
  被隐藏，未来每个消费 raw 的功能都要回答「哪种 raw」。
- **只在 UI 层换文案、保留 `byteOrder` 状态**：dead state 与永不改变结果的
  action 继续存在，模型错误被文案掩盖。
- **把 wire-byte 解析做成新的导入功能**：产品没有 wire import 需求，为
  「对称」新增 UI 是无需求功能；序列化表示当前只需要显示与复制。
- **不迁移、直接废弃持久化读取但不加回归测试**：旧偏好污染新状态的风险
  （stale `endian` 字段经对象 spread 注入 state）必须由测试锁定。
