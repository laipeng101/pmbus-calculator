# 贡献指南

按 [AGENTS.md](AGENTS.md) 找到与改动有关的源码、测试和约定。提交说明使用 Conventional Commits。PR 说明改动原因、受影响的行为和实际验证。

## 环境

使用 [`.node-version`](.node-version) 和 [`package.json`](package.json) 指定的 Node.js 和 npm 版本。首次开发或锁文件变化后运行 `npm ci`。主工作副本上的提交钩子只检查暂存区的空白字符。需要单独更新钩子时运行 `npm run postinstall`。

运行 `npm run dev` 启动开发服务器。预览生产产物时先运行 `npm run build`，再运行 `npm run preview`。

按测试需要安装浏览器。桌面、移动端、发布包和 Pages 测试使用 Chromium，跨浏览器核心流程测试使用 Firefox 和 WebKit。

```bash
npx playwright install chromium
npx playwright install firefox webkit
```

Linux 缺少系统库时，在安装命令加 `--with-deps`。截图比对使用 [界面约定](docs/UI_CONVENTIONS.md#11-视觉基线治理)中的镜像，需要 Linux x64 和 Docker。

## 验证

按改动选择本地检查。维护脚本组合时直接修改 [`package.json`](package.json)。

| 改动                 | 本地验证                                                                                                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档和协作规则       | `npm run verify:light`                                                                                                                                                                             |
| 算法、状态或单元测试 | `npm run test:run -- <用例路径>`。涉及模块间的接口时可运行 `npm run verify:quality`                                                                                                                |
| 交互和布局           | 先运行 `npm run build`，再运行相关 `npm run test:e2e -- <用例路径>` 或移动端用例。核心流程补跑 `npm run test:e2e:cross-engine`，涉及外观时看[截图比对流程](docs/UI_CONVENTIONS.md#11-视觉基线治理) |
| CI、构建、依赖及分发 | 运行受影响的检查。需要完整验证时运行 `npm run verify`，需要同时比对截图时运行 `npm run verify:ui`                                                                                                  |

算法回归优先补在已有 Vitest 测试中。端到端测试使用生产构建，Firefox 和 WebKit 运行同一组核心流程用例。

### PR CI

目标为 `main` 的 PR 自动测试 GitHub 生成的合并提交。[`scripts/classify-ci-scope.mjs`](scripts/classify-ci-scope.mjs) 根据这个合并提交与其第一父提交之间的文件差异选择检查。第一父提交是本次合并使用的目标分支版本。一次 PR 涉及多类改动时，取最高档。

| 档位      | 在前一档基础上运行的检查                                  |
| --------- | --------------------------------------------------------- |
| `light`   | `npm run verify:light`                                    |
| `checks`  | `npm run verify:quality`                                  |
| `product` | `npm run verify:browser` 和截图比对                       |
| `full`    | Node.js 22 兼容性测试和依赖审计。手动运行 CI 时使用这一档 |

合并前需要通过 `check`，并让 PR 与目标分支保持同步。CI 记录实际验证的提交和 Git tree。[CI 工作流](.github/workflows/ci.yml) · [发布流程](docs/RELEASING.md) · [Pages 部署](docs/DEPLOYING.md)

生成文件的存放位置和清理方法见[文件跟踪与清理](docs/REPOSITORY_HYGIENE.md)。
