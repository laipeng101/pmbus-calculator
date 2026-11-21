# 贡献指南

开发时按 [AGENTS.md](AGENTS.md) 定位相关源码、测试和约定。提交说明使用 Conventional Commits，PR 说明改动动机、受影响的行为及实际验证。

## 环境

使用 [`.node-version`](.node-version) 和 [`package.json`](package.json) 指定的 Node 和 npm。依赖缺失或锁文件变更时运行 `npm ci`。该命令会在主工作副本更新 pre-commit hook，提交前仅检查暂存区的 whitespace。

运行 `npm run dev` 启动开发服务器。预览生产产物时先运行 `npm run build`，再运行 `npm run preview`。

浏览器按需安装。桌面、移动端、Release 和 Pages-overlay 测试使用 Chromium。跨引擎 smoke 使用 Firefox 和 WebKit。

```bash
npx playwright install chromium
npx playwright install firefox webkit
```

Linux 缺少系统库时可在对应安装命令上加 `--with-deps`。视觉测试使用 [UI 约定](docs/UI_CONVENTIONS.md#11-视觉基线治理)中的固定镜像，依赖 Linux x64 上的 Docker。

## 验证

按影响面选择本地检查。命令及其组合以 [`package.json`](package.json) 为准。

| 改动                     | 本地验证                                                                                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档、协作规则           | `npm run verify:light`                                                                                                                                     |
| 领域算法、状态或单测     | `npm run test:run -- <用例路径>`。跨模块或 TypeScript 契约变更可运行 `npm run verify:quality`                                                              |
| 核心流程、交互、布局     | 先构建 `npm run build`，运行相关 `npm run test:e2e -- <用例路径>` 或移动端用例。涉及核心流程时运行 `npm run test:e2e:cross-engine`，视觉变化按 UI 约定检查 |
| CI、构建、依赖或分发链路 | 运行受影响的检查。需要完整本地门禁时用 `npm run verify`，连同固定环境截图比对时用 `npm run verify:ui`                                                      |

算法回归优先在已有 Vitest 用例覆盖。端到端测试使用生产构建，桌面和移动端套件按各自的用户契约覆盖，Firefox 和 WebKit 共用小型核心 smoke。

### PR CI

目标为 `main` 的 PR 自动检查 GitHub 的合并结果。[`scripts/classify-ci-scope.mjs`](scripts/classify-ci-scope.mjs) 对 PR 变更路径判定一次，混合改动取最高档。每档包含前一档的检查。

| 档位      | 检查                                                                       |
| --------- | -------------------------------------------------------------------------- |
| `light`   | 格式、Markdown 数学、发布操作命令、仓库卫生和 PR whitespace                |
| `checks`  | TypeScript、lint、运行时约束、规范与发行合同、单测及覆盖率                 |
| `product` | 生产构建、桌面/移动端/跨引擎 E2E、Release 与 Pages-overlay smoke、视觉回归 |
| `full`    | Node 22 兼容与依赖审计。配置、依赖、发布工具、未知路径及手动 CI 走该档     |

主分支由 `protect-main` 要求 PR、通过 `check` 且与目标分支同步。CI 记录已检查的 commit 和 tree，按[发布流程](docs/RELEASING.md)核对发布证据。发布与 Pages 使用各自工作流。

生成输出的位置和按需清理命令见[仓库卫生](docs/REPOSITORY_HYGIENE.md)。
