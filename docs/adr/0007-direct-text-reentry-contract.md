# ADR 0007: DIRECT 显示文本回录合同单一事实源（text re-entry contract）

- 状态：Accepted
- 日期：2026-09-06
- 决策者：项目维护者

## 背景（Context）

ADR 0005 收敛了数值文本 policy，v2.5.11 为 DIRECT 引入 `directFidelity`
精度折叠合同。但 v2.5.11 的保真谓词是**binary64 管线回程**
（`analyzeDirectRoundTrip`：`PMBusMath.encodeDirect(PMBusMath.decodeDirect(y)) === y`），
它回答的不是用户面对的问题。用户实际回输的是**显示文本**——binary64 解码值经
ADR 0005 canonical policy（12 位有效数字）格式化后的字符串——而 reducer 对提交
文本走**精确 typed 编码**（`parseDecimalExactRational` →
`encodeDirectExactFromRational`，v2.5.11）。两层各折叠一次：

- **显示格式化折叠**（v2.5.11 守卫全盲）：m=1、b=1、R=12、Y=-1 的精确值
  -1.000000000001 可由 binary64 承载且 binary64 管线回程安全，但显示文本
  "-1" 经 typed 编码为 Y=0——全 65536 个 Y 中 29491 个的「物理值」复制
  回录会静默改变 raw，且无任何告警；整个 (1,1,12) 族 0 触发旧守卫。
  (7,3,12) 等族更宽：旧守卫 0 触发、56172/65536 复制不安全。(1,1,17) 族也有
  4427 个旧守卫安静但复制不安全的状态。
- **binary64 表示折叠**（v2.5.11 已覆盖）：m=1、b=1、R=17、Y=-1 的精确值
  需要 18 位有效数字，binary64 值本身回编即改变 payload。

另有呈现诚实性缺口：循环有理数（如 m=3、b=1、R=16 的 -1/3）的安全回录文本
是**经验证近似**，旧文案一律称「精确文本」；m=0 时物理值为 `—`，
复制按钮仍启用并复制占位符。

## 决策（Decision）

把保真谓词统一为**显示文本 → 真实 typed 编码回程**，全部消费方共享同一分析：

```text
reducer（value/set 的 typed 合同，不变）
  classifyFloatText → parseDecimalExactRational → encodeDirectExactFromRational
      ▲ 同一函数共享，不重实现
direct-exact.analyzeDirectTextReentry(y, m, b, r)   ← 纯函数，单一事实源
  displayText     = formatPlainNumber(decodeDirect(y))   （与结果卡/输入框同一字符串）
  displayReencodedY / displayRoundTripSafe                （真实回录后果）
  b64ReencodedY / b64RoundTripSafe                        （v2.5.11 诊断，保留）
      → view-model（fidelity VM、警告、量化注记、复制 override/disable、
        value text）与 calculation-steps（精确值行）
```

- 触发面变化：`directFidelity` 在且仅在**显示文本**回编 ≠ 当前 Y 时出现；
  安静状态由全 Y 性质测试证明「安静 ⇒ 复制显示文本安全」。旧 binary64 回程
  降级为 `lossKind` 诊断：`binary64-representation`（v2.5.11 折叠）vs
  `display-formatting`（仅显示格式化损失）——文案必须区分二者，不得一律
  称「超出 binary64 精度」。
- `generateSafeDirectReentryText` 返回 `{ text, kind }`：`exact`（终止小数的
  精确展开）与 `approximate`（循环有理数的经验证有限近似）在警告、复制说明、
  控件 tooltip 中如实区分；近似文本不得冒充精确值。
- m=0 时物理值复制禁用并给出可访问原因（`resolveDirectPhysicalValueCopy`），
  不再复制 `—` 占位符。
- ADR 0005 的通用显示 policy 不变：显示文本仍是 canonical 12 位有效数字格式；
  本 ADR 改变的是**围绕该文本的安全合同与呈现**，不是显示位数。复制 payload
  与显示文本可以不同（override），差值由 kind 标注的说明与警告诚实呈现。

## 后果（Consequences）

- (1,1,12)、(7,3,12) 等 display-formatting 族从无告警/不安全复制变为
  提交前告警 + 验证复制；(3,1,17) 个别 b64-unsafe 但 display-safe 的状态
  从告警变为安静（复制显示文本已可证回录）。
- 受保护算法零变更；typed 提交路径、4096 资源门禁、provenance、untouched
  blur、拒绝事务边界合同不变。
- 新增消费面时必须消费 `analyzeDirectTextReentry` / `directFidelity`，
  不得用 binary64 guard 或浮点比较重建安全结论。
- 测试合同：全 65536-Y「最终复制文本 → 真实 typed 编码 → raw 不变」性质
  （(1,1,12) 全族 + 既有 sweep corpora）、损失分层 golden、安静⇒安全性质、
  真实键盘/剪贴板回录 E2E（两个失败族 + 安静对照 + m=0 禁用）。
