# RELEASING

本项目首次稳定发行统一为 **v1.0.0**。后续所有发行遵循本文件。

## 版本号规则

- 使用 Semantic Versioning 2.0.0（https://semver.org/spec/v2.0.0.html）。
- `package.json` 中的 package version 不带 `v`（例如 `1.0.0`）。
- Git tag 带 `v`（例如 `v1.0.0`）。
- PATCH：向后兼容的 bug、安全、文档或构建修复。
- MINOR：向后兼容的新功能。
- MAJOR：计算语义、持久化数据、现有用户流程等不兼容变化。
- prerelease 使用 `1.1.0-rc.1` 格式。

## 发布纪律

- 已发布的 tag 和 GitHub Release 永不修改、移动或覆盖。
- `package.json` 版本必须和最新稳定 tag 一致。
- 发布必须来自完整 CI 全绿的 main SHA。
- GitHub Release 是当前正式发行渠道，不发布 npm 包（`private: true`，不得执行 `npm publish`）。

## 发布流程

1. 在最新 `origin/main` 上完成版本号、CHANGELOG、release notes 与文档更新。
2. 运行完整验证：`npm ci`、`npm run test:e2e:install`、`npm run verify`、`npm run build`、`npm run test:e2e:release`。
3. 创建 PR 并等待最新 head CI 全绿。
4. 普通 merge commit 合入 main，等待 main push CI 全绿。
5. 在 main CI 全绿的精确 SHA 上创建 annotated tag（版本变量记为 `vX.Y.Z`）：`git tag -a vX.Y.Z <sha> -m "PMBus Calculator vX.Y.Z"`。
6. 推送 tag，从 tag 的干净工作区执行 `npm ci && npm run verify && npm run build`。
7. 创建 GitHub Release（非 draft、非 prerelease），上传源码构建产物与 `SHA256SUMS.txt`。

## 稳定公共契约

稳定公共契约定义为：

- L11 / L16 / DIRECT / HALF 的计算和舍入语义。
- raw word、字节序和复制格式。
- 命令元数据行为。
- 已持久化的用户偏好。
- README 中声明的用户流程。

任何不向后兼容地改变以上稳定公共契约的变更必须提升 MAJOR 版本；
向后兼容的新能力使用 MINOR，兼容性修复使用 PATCH。
