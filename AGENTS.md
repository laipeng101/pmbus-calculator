# AGENTS.md

PMBus Calculator 是在浏览器中运行的静态计算器。从要改的入口、直接调用方和相关测试开始。

## 按任务读取

| 改动                               | 相关源码和文档                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------ |
| PMBus 算法、格式、字节序、命令数据 | [领域规则](docs/DOMAIN_MODEL.md) 的相关章节、`src/legacy/` 与 `src/app/`       |
| 状态、输入、公式、界面             | `src/app/`、`src/components/` 与 [界面约定](docs/UI_CONVENTIONS.md) 的相关章节 |
| 测试、CI、贡献流程                 | [贡献指南](CONTRIBUTING.md)                                                    |
| 生成物、清理、仓库体积             | [文件跟踪与清理](docs/REPOSITORY_HYGIENE.md)                                   |
| 版本发布                           | [发布流程](docs/RELEASING.md)                                                  |
| Pages 部署、访问统计               | [部署指南](docs/DEPLOYING.md)                                                  |
| 旧版单文件兼容性                   | [兼容性说明](docs/LEGACY_COMPATIBILITY.md)                                     |

需要了解设计取舍时，查相关[架构决策](docs/adr/)。变更历史查 Git、PR 或 GitHub Releases。核对外部规范时，按[规范获取说明](document/README.md)下载需要的文件，读取相关章节。

## 代码约束

- `src/app/` 负责状态、动作和视图数据，`src/components/` 负责渲染和交互。需要计算、格式化或查询命令时，使用对应模块。偏好设置统一由 `src/app/persistence.ts` 读写。
- `state.raw` 保存 16 位原始数据字。字节序在生成字节序列时处理。命令参考只读，器件系数和格式以器件数据手册为准。
- 修改 PMBus 换算、VOUT_MODE 或 PEC 时，验证相关边界、舍入和已知输入输出。编写 JSX 时沿用项目的样式和事件处理方式，避免 `style` 属性。

## 验证与交付

先运行相关测试，再按[贡献指南](CONTRIBUTING.md#验证)选择其余检查。更新受改动影响的规则或操作说明。报告实际检查结果和待验证事项，引用 CI 结果时核对对应的 Git 提交。
