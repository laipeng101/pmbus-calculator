# ADR 0002: 标准命令定义与设备/演示预设分离

- 状态：Accepted
- 日期：2026-08-15
- 决策者：项目维护者

## 背景

PMBus 规范只固定了命令码、事务类型与语义；很多命令的数据格式由器件资料决定，或由 `VOUT_MODE` 决定。早期命令字典把 `READ_VIN` 等命令直接标成 LINEAR11、把 `VOUT_COMMAND` 标成 LINEAR16，并给 12V/48V/20A/5000RPM 等值标注 “PMBus Part II typical example”。这些值来自演示，不是规范要求，自动应用会误导用户把演示值当成标准默认值。

## 决策

把命令字典拆成两层：

1. **标准命令定义**：命令码、事务类型、值类型、单位、规范章节、编码规则。编码规则只表达四种情况：
   - `follows_vout_mode` — 格式跟随 `VOUT_MODE`；
   - `device_defined` — 格式由器件资料决定，必须查阅器件数据手册；
   - `status` — 状态位字，不是物理量编码；
   - `block` — 块读/块写报文，不是单个 16-bit 字。
2. **可选预设**：mode/format、value、N 或 VOUT_MODE、DIRECT m/b/R。每个预设必须带 `sourceKind`、`source`、`appliesTo`、`direction`。当前只允许 `sourceKind: project-demo`。

行为规则：

- `command/set` 只记录选择并展示命令信息，不切换模式、不加载参数、不重编码 raw。
- 只有用户显式触发 `command/apply-preset` 时，才允许应用预设（切换模式、加载参数、重编码 raw）。
- UI 必须明确标注“应用 project-demo 预设”，并说明演示值不是标准或通用默认值。

## 后果

- 优点：不再把演示值伪装成规范；`device_defined` 命令明确提示“需要器件数据手册”；为未来接入真实器件数据手册预设（`sourceKind: device-datasheet`）保留了位置。
- 代价：命令选择不再“一键填好”，用户需要额外点击一次“应用预设”。
- 约束：没有真实器件数据手册时，禁止内置虚构的 `device-datasheet` 预设。
