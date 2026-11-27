# 贡献指南

按 [AGENTS.md](AGENTS.md) 找到相关源码、测试和约定。提交说明使用 Conventional Commits。可在提交前用 `git diff --cached --check` 检查暂存内容的空白问题。PR 说明受影响的行为和实际验证。

从旧版本升级时，之前由 `simple-git-hooks` 写入的 `pre-commit` 可能仍在本地。如果需要停用，先用 `git rev-parse --git-path hooks/pre-commit` 找到文件，确认它仅执行旧的空白检查。

## 环境

使用 [`.node-version`](.node-version) 和 [`package.json`](package.json) 指定的 Node.js 和 npm。首次开发或锁文件变化后运行 `npm ci`。用 `npm run dev` 启动开发服务器。

Chromium 无头测试只需 `npx playwright install --only-shell chromium`。需要打开浏览器窗口时安装完整 Chromium，检查兼容性时运行 `npx playwright install firefox webkit`。Linux 缺少系统库时加 `--with-deps`。

## 验证

| 改动                 | 本地检查                                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------------------------- |
| 文档和协作规则       | `npm run verify:light`                                                                                   |
| 算法、状态或单元测试 | `npm run test:run -- <用例路径>`。涉及多个模块时运行 `npm run verify`                                    |
| 浏览器交互和布局     | `npm run build` 后运行 `npm run test:e2e -- <用例路径>` 或 `npm run test:e2e:mobile`                     |
| 浏览器兼容性         | `npm run build` 后运行 `npm run test:e2e:cross-engine`                                                   |
| 界面外观             | 按[截图比对流程](docs/UI_CONVENTIONS.md#截图比对)运行，脚本启动开发服务器                                |
| 旧版单文件           | `npm run build` 后运行 `npm run test:e2e -- legacy-offline.spec.ts`，检查离线打开、边界自检和命令说明    |
| Web ZIP、Pages       | [检查发行包](docs/RELEASING.md#本地验证发行包) · [检查 Pages 专用内容](docs/DEPLOYING.md#pages-专用内容) |

手动检查离线版时，在文件地址末尾加 `?debug`，然后点击「运行边界测试」。

合入 `main` 前，确保分支与 `main` 同步且 CI 的 `check` 通过。CI 根据改动范围逐步增加检查。

- 纯文档改动检查格式和跟踪文件。只改 Vitest 用例时运行 `npm run verify`，包含静态检查、单元测试和生产构建。
- 产品、浏览器用例和配置改动还会运行 `npm run verify:browser`，执行桌面和移动 Chromium 中标记 `@browser-smoke` 的用例。用 `npm run verify:browser -- --list` 查看选择结果。
- 发布打包、依赖、生产 CSP、应用页头样式或 Pages 检查相关改动会再运行 `npm run test:pages-overlay`。手动运行 CI 会执行全部上述检查。

[CI 工作流](.github/workflows/ci.yml) · [变更范围规则](scripts/classify-ci-scope.mjs)

完整 Chromium 回归包含 `npm run test:e2e` 和 `npm run test:e2e:mobile`。应用测试使用带部署前缀的生产预览，`page.goto('./')` 打开前缀下的首页。桌面、移动端和跨浏览器的 HTML 报告共用 `playwright-report/app/`，会替换上一次报告。

在 Vitest 检查协议向量、舍入和输入解析的边界。在浏览器检查真实键盘、触屏、剪贴板、偏好恢复、布局和代表性的换算流程。迁移独有断言后运行对应测试。定位覆盖缺口可用 `npm run test:coverage`，检查依赖漏洞可用 `npm audit --audit-level=high`。

[发布流程](docs/RELEASING.md) · [文件跟踪与清理](docs/REPOSITORY_HYGIENE.md)
