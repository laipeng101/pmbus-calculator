# 贡献指南

按 [AGENTS.md](AGENTS.md) 找到相关源码、测试和约定。提交说明使用 Conventional Commits。可在提交前用 `git diff --cached --check` 检查暂存内容的空白问题。PR 说明受影响的行为和实际验证。

从旧版本升级时，之前由 `simple-git-hooks` 写入的 `pre-commit` 可能仍在本地。如果需要停用，先用 `git rev-parse --git-path hooks/pre-commit` 找到文件，确认它仅执行旧的空白检查。

## 环境

使用 [`.node-version`](.node-version) 和 [`package.json`](package.json) 指定的 Node.js 和 npm。首次开发或锁文件变化后运行 `npm ci`。运行 `npm run dev` 启动开发服务器。浏览器测试使用 `npm run build` 生成的产物。

Chromium 无头测试只需 `npx playwright install --only-shell chromium`。需要打开浏览器窗口时安装完整 Chromium，检查兼容性时运行 `npx playwright install firefox webkit`。Linux 缺少系统库时加 `--with-deps`。

## 验证

| 改动             | 本地检查                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| 文档和协作规则   | `npm run verify:light`                                                                                   |
| 算法、状态或测试 | `npm run test:run -- <用例路径>`。涉及多个模块时运行 `npm run verify`                                    |
| 浏览器交互和布局 | 构建后运行 `npm run test:e2e -- <用例路径>` 或 `npm run test:e2e:mobile`                                 |
| 浏览器兼容、截图 | 按下文选择专项检查                                                                                       |
| Web ZIP、Pages   | [检查发行包](docs/RELEASING.md#本地验证发行包) · [检查 Pages 专用内容](docs/DEPLOYING.md#pages-专用内容) |

合入 `main` 前，确保 PR 分支已与 `main` 同步且 [CI 的 `check`](.github/workflows/ci.yml) 通过。纯文档改动检查格式和跟踪文件。只改 Vitest 用例时运行 `npm run verify`，检查静态规则、单元测试和生产构建。产品、浏览器用例、配置等改动和手动运行还会执行 `npm run verify:browser`，检查 Chromium 核心交互和移动端。

完整 Chromium 交互回归可运行 `npm run test:e2e`。涉及浏览器兼容时运行 `npm run test:e2e:cross-engine`。涉及外观时按[截图比对流程](docs/UI_CONVENTIONS.md#截图比对)运行。HTML 报告保存在 `playwright-report/`。桌面、移动端和跨浏览器检查共用 `app/`，会替换上一次报告。依赖变更时可运行 `npm audit --audit-level=high`，需要定位覆盖缺口时用 `npm run test:coverage`。

[发布流程](docs/RELEASING.md) · [文件跟踪与清理](docs/REPOSITORY_HYGIENE.md)
