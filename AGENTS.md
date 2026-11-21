# 项目工作约定

PMBus Calculator 是 Web-first 的静态数值工具。应用提供 L11、L16、DIRECT、HALF 换算及独立 VOUT_MODE 解析，不执行总线通信或命令。`pmbus-calculator.html` 是只读离线归档，保留原路径和公开记录的兼容差异。

## 按任务查阅

| 涉及范围                           | 权威资料                                                                                        |
| ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| 格式、舍入、Raw Word、字节序、命令 | [DOMAIN_MODEL](docs/DOMAIN_MODEL.md)                                                            |
| 界面、交互、公式与视觉             | [UI_CONVENTIONS](docs/UI_CONVENTIONS.md)                                                        |
| 本地工具链、验证分级、PR 与合并    | [CONTRIBUTING](CONTRIBUTING.md)                                                                 |
| 跟踪文件、临时产物、清理、视觉基线 | [REPOSITORY_HYGIENE](docs/REPOSITORY_HYGIENE.md)                                                |
| 发行、Pages、Analytics             | [RELEASING](docs/RELEASING.md)、[DEPLOYING](docs/DEPLOYING.md)                                  |
| 里程碑、旧版兼容、架构决策         | [ROADMAP](docs/ROADMAP.md)、[MIGRATION_MATRIX](docs/MIGRATION_MATRIX.md)、相关 [ADR](docs/adr/) |

按需核对相关章节。`docs/archive/**` 只用于有明确目的的历史调查，普通搜索排除该目录。

## 实现边界

- 换算基线为 PMBus 1.3 / 1.3.1 与 SMBus 3.0 的适用章节。以 [`document/specifications.json`](document/specifications.json) 核对版本和来源，按需运行 `npm run specs:fetch -- --id <id>`。规范 PDF 留在 ignored `.cache/specifications/`。需要器件数据时，界面说明所缺资料，避免从标准命令名推断器件系数或 profile。
- `src/app/` 维护状态、reducer 与视图模型。`state.raw` 是数值模式的 16-bit Raw Word，字节序只在 Wire Bytes 序列化层处理。组件消费 `toCalculatorViewModel` 并派发语义 action，算法和展示派生放在相应数据层。偏好读写统一经过 `src/app/persistence.ts`。
- `src/legacy/pmbus-math.ts` 提供仍在使用的数值算法。`src/legacy/command-metadata.ts` 为命令参考提供只读元数据；查看命令不能改变换算状态。命令、格式与单位定义由数据层提供。
- 组件遵循项目 CSS 与帮助浮层约定。新增 inline `style` 仅限有具体动态需求的例外；原生 `title` 不承载控件说明。UI 不使用运行时文案宣称 CI 结果。

## 验收

- 只读任务按委托范围取证。实施时复用可用依赖，开发中运行受影响的检查，交付门禁和 fresh 初始化见 [CONTRIBUTING](CONTRIBUTING.md)。不要求清空工作树或重复安装。
- 修改数值语义时用已有或新增的 golden case 锁定变化的行为与边界。Vitest 覆盖领域与状态逻辑，Playwright 验证真实输入、布局、焦点和复制等跨层路径。核心流程仍需保留 Firefox 与 WebKit 的独立 smoke。
- 涉及视觉变化时按 [UI_CONVENTIONS](docs/UI_CONVENTIONS.md#10-视觉系统与验收) 验证相关视口。Darwin 快照更新及证据要求以 [REPOSITORY_HYGIENE](docs/REPOSITORY_HYGIENE.md#3-visual-snapshot-审批规则) 为准。
- 本地与 PR 验证使用精确 Analytics stub，真实验收由 GitHub-hosted Pages 部署步骤执行。发行产物与隐私边界按 [DEPLOYING](docs/DEPLOYING.md) 验证。
