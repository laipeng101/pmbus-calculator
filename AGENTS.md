# AGENTS.md

PMBus Calculator 是 Web-first 静态计算器，提供 L11、L16、DIRECT、HALF 与 VOUT_MODE 工具。任务从改动入口、直接调用方和相关测试开始。

## 按任务读取

| 改动                               | 从这里展开                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| PMBus 算法、格式、字节序、命令数据 | [领域规则](docs/DOMAIN_MODEL.md) 的相关章节、`src/legacy/` 与 `src/app/`      |
| 状态、输入、公式、UI               | `src/app/`、`src/components/` 与 [UI 约定](docs/UI_CONVENTIONS.md) 的相关章节 |
| 测试、CI、贡献流程                 | [贡献指南](CONTRIBUTING.md)                                                   |
| 生成物、清理、仓库体积             | [仓库卫生](docs/REPOSITORY_HYGIENE.md)                                        |
| 发布、Pages、Analytics             | [发布](docs/RELEASING.md) 或 [部署](docs/DEPLOYING.md) 的相关步骤             |
| 旧版单文件兼容性                   | [兼容性说明](docs/LEGACY_COMPATIBILITY.md)                                    |

需要决策背景时查相关 [ADR](docs/adr/)。变更历史查 Git、PR 或 GitHub Releases。核对第三方规范时从 [manifest](document/specifications.json) 查找来源，按需下载并读取所需章节，PDF 放入忽略的缓存。规范基线见 [领域规则](docs/DOMAIN_MODEL.md)。

## 代码约束

- `src/app/` 管理状态、计算结果呈现和动作。组件消费 view model，计算、命令数据与格式化集中在已有层。偏好写入经 `src/app/persistence.ts`。
- `state.raw` 是规范的 16 位 Raw Word，字节序只在序列化层处理。命令参考只读，器件系数与编码资料以真实数据手册为准。
- 修改 PMBus 换算、VOUT_MODE 或 PEC 时验证边界、舍入与 golden case。界面交互、样式与公式遵循 UI 约定。
- JSX 使用现有样式和事件处理方式。新增动态 inline style 须有实际理由。

## 验证与交付

- 按改动风险运行目标测试。局部改动先跑相关用例，需要扩大覆盖时按[贡献指南](CONTRIBUTING.md#验证)选择检查。只有所选检查需要浏览器或 Docker 时才准备对应环境。
- 更新受影响的现行契约与操作说明。报告实际验证结果和影响验收的缺口，将 CI 结果绑定到已核对的 revision。
