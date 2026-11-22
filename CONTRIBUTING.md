# 贡献指南

按 [AGENTS.md](AGENTS.md) 找到相关源码、测试和约定。提交说明使用 Conventional Commits。PR 说明受影响的行为和实际验证。

## 环境

使用 [`.node-version`](.node-version) 和 [`package.json`](package.json) 指定的 Node.js 和 npm。首次开发或锁文件变化后运行 `npm ci`。运行 `npm run dev` 启动开发服务器。浏览器测试使用 `npm run build` 生成的产物。

按需运行 `npx playwright install chromium` 或 `npx playwright install firefox webkit`。Linux 缺少系统库时加 `--with-deps`。

## 验证

| 改动             | 本地检查                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| 文档和协作规则   | `npm run verify:light`                                                                                   |
| 算法、状态或测试 | `npm run test:run -- <用例路径>`。涉及多个模块时运行 `npm run verify`                                    |
| 浏览器交互和布局 | 构建后运行 `npm run test:e2e -- <用例路径>` 或 `npm run test:e2e:mobile`                                 |
| 浏览器兼容、截图 | 按下文选择专项检查                                                                                       |
| Web ZIP、Pages   | [检查发行包](docs/RELEASING.md#本地验证发行包) · [检查 Pages 专用内容](docs/DEPLOYING.md#pages-专用内容) |

合入 `main` 前，确保 PR 分支已与 `main` 同步且 [CI 的 `check`](.github/workflows/ci.yml) 通过。纯文档改动检查格式和跟踪文件。其余改动运行 `npm run verify` 和 `npm run verify:browser`，覆盖静态检查、Vitest、生产构建、Chromium 核心交互和移动端。手动运行 CI 时也执行这两条命令。

完整 Chromium 交互回归可运行 `npm run test:e2e`。涉及浏览器兼容时运行 `npm run test:e2e:cross-engine`。涉及外观时按[截图比对流程](docs/UI_CONVENTIONS.md#11-视觉基线治理)运行。依赖变更时可运行 `npm audit --audit-level=high`，需要定位覆盖缺口时用 `npm run test:coverage`。

[发布流程](docs/RELEASING.md) · [文件跟踪与清理](docs/REPOSITORY_HYGIENE.md)
