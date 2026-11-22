# 发布

PMBus Calculator 通过 GitHub Release 发布静态 Web ZIP。每次发布都对应一个经过验证的 `main` 提交和带注释的 Git tag。已公开的 Release、资产和 tag 保持不可变。在同一 Bash 会话中从仓库根目录执行下列命令，先确认 `origin` 指向 `laipeng101/pmbus-calculator`。

## 版本号

使用 [SemVer](https://semver.org/spec/v2.0.0.html) 稳定版本，从 `1.0.0` 起。版本号写入 `package.json`，tag 加 `v` 前缀。按对用户的影响选择版本号。

| 版本  | 适用变更                                                                                |
| ----- | --------------------------------------------------------------------------------------- |
| PATCH | 向后兼容的修复，包括安全、文档和构建修复                                                |
| MINOR | 向后兼容的新功能                                                                        |
| MAJOR | 计算和舍入、Raw Word 与字节序、复制格式、命令参考、已保存偏好或公开使用流程的不兼容变化 |

在拟发布的 PR 中执行 `npm version X.Y.Z --no-git-tag-version` 更新版本，并运行 `npm run check:release-contract` 核对锁文件。

## 核对合入后的 CI

按[贡献指南](../CONTRIBUTING.md)完成本地验证和 PR。版本变更触发 `full` 档。最新 PR 提交的 `check` 通过后，以 merge commit 合入 `main`。

```bash
git fetch origin main
release_sha=$(git rev-parse origin/main)
git rev-parse "$release_sha^{tree}"
```

比较 `main` 提交的 tree 与成功运行的 CI 在 `Record checked revision` 步骤记录的 `checked_tree`。确认该次 CI 的 `check` 成功且日志显示 `tier=full`，tree 相同即可复用结果。

缺少上述证据时，从 `main` 手动触发 `full` 档。将以下 `RUN_ID` 换成本次触发的运行 ID。

```bash
gh workflow run ci.yml --ref main
gh run list --workflow ci.yml --event workflow_dispatch --branch main --commit "$release_sha"
gh run view RUN_ID --json conclusion,headSha,jobs,url
gh run view RUN_ID --log
```

同一次运行的 `headSha` 必须等于 `release_sha`，`checked_tree` 必须等于上方 Git 输出，且 `full` 档的 `check` 成功。若 `main` 已前进，重新选定发布提交并核对其版本、CI 与预检证据。

## 构建和生成资产

将下方 `release-worktree` 替换为工作目录。检出已验证的提交，从锁文件安装依赖，重新构建并对产物运行 Release smoke。Chromium 已按当前锁定版本安装时可复用。

```bash
git worktree add --detach release-worktree "$release_sha"
cd release-worktree
npm ci
npm run build
npx playwright install chromium
npm run test:e2e:release
npm run release:prepare-assets
```

生成器将 `dist/` 打包为 `release-output/pmbus-calculator-vX.Y.Z-web.zip`，并同时生成 `SHA256SUMS.txt`，检查 ZIP 内容与校验和。打包使用 Python 3 和 zlib。使用与 [Pages 工作流](../.github/workflows/pages.yml) 一致的环境，以便部署时重建相同的 ZIP 字节。每个工作目录一次只运行一个生成进程。失败或中断后，可在该临时工作目录运行 `npm run clean` 后重新构建和打包。

## 发布前检查

首次配置时，在仓库 **Settings → Environments** 添加 `release-preflight` 环境，仅允许 `main`。在该环境保存 `PMBUS_RELEASE_GITHUB_TOKEN`。使用只授权本仓库的 fine-grained PAT，授予 **Administration: Read-only** 和 **Environments: Read-only**。

从 `main` 运行 [Release preflight](../.github/workflows/release-preflight.yml)，核对其 `headSha` 与 `release_sha` 一致、`Verify release prerequisites` 作业成功。预检确认仓库已启用不可变 Release，以及 Pages 环境已配置 Analytics。预检失败时修正设置并重跑。

```bash
gh workflow run release-preflight.yml --ref main
gh run list --workflow release-preflight.yml --event workflow_dispatch --branch main --commit "$release_sha"
gh run view RUN_ID --json conclusion,headSha,jobs,url
```

在发布用的工作目录从 `package.json` 读取版本，核对当前 GitHub 身份具有仓库管理员权限，且远端 tag 查询成功、没有匹配项。以下命令均针对正式仓库。

```bash
repo=laipeng101/pmbus-calculator
tag="v$(node -p 'require("./package.json").version')"
zip_name="pmbus-calculator-${tag}-web.zip"
gh api "repos/$repo" --jq '{full_name, admin: .permissions.admin}'
git ls-remote --tags origin "refs/tags/$tag"
```

## 创建草稿并回验

只有 CI、构建、测试和平台预检全部通过后，才能给 `release_sha` 加 tag。核对解引用后的提交再推送。

```bash
(
  set -euo pipefail
  git tag -a "$tag" "$release_sha" -m "PMBus Calculator $tag"
  [[ "$(git rev-parse "$tag^{commit}")" == "$release_sha" ]]
  git push origin "refs/tags/$tag"
  gh release create "$tag" --repo "$repo" --verify-tag --draft \
    --title "PMBus Calculator $tag" --generate-notes
)
```

在 GitHub 草稿中确认生成的内容，补充用户可以感知的变化与迁移说明。默认使用 GitHub 选择的比较起点，也可用 `--notes-start-tag` 指定上一个稳定 tag。

```bash
gh release upload "$tag" --repo "$repo" \
  "release-output/$zip_name" release-output/SHA256SUMS.txt
```

从 Releases 列表取得草稿元数据，并下载这份草稿挂载的两个资产。校验资产名、大小、SHA-256 与 ZIP 内容，再与本次构建生成的文件逐字节比较。任一命令失败时，保留草稿并排查。中断后继续时，先核对远端 tag 仍指向本次提交、Release 仍是草稿，再从未完成的步骤继续。公开前重新回验两项资产。

```bash
(
  set -euo pipefail
  draft_dir=$(mktemp -d)
  gh api --paginate "repos/$repo/releases" |
    jq -es --arg tag "$tag" 'add | .[] | select(.tag_name == $tag and .draft == true)' \
    > "$draft_dir/release.json"
  gh release download "$tag" --repo "$repo" --dir "$draft_dir"
  node scripts/verify-downloaded-assets.mjs --metadata "$draft_dir/release.json" \
    --dir "$draft_dir" --tag "$tag" --repo "$repo" --mode draft
  cmp "$draft_dir/$zip_name" "release-output/$zip_name"
  cmp "$draft_dir/SHA256SUMS.txt" release-output/SHA256SUMS.txt
)
```

## 公开和部署

草稿回验全部通过后公开。Release API 必须返回匹配的 `tag_name`、`immutable: true`、`draft: false` 及 `prerelease: false`。

```bash
gh release edit "$tag" --repo "$repo" --draft=false
```

```bash
(
  set -euo pipefail
  gh api "repos/$repo/releases/tags/$tag" |
    jq -e --arg tag "$tag" '
      select(.tag_name == $tag and .immutable == true and .draft == false and .prerelease == false)
      | {tag_name, immutable, draft, prerelease}
    '
)
```

API 复核通过后，用 GitHub CLI 核对 Release 签名及本地资产。

```bash
gh release verify "$tag" --repo "$repo"
gh release verify-asset "$tag" "release-output/$zip_name" --repo "$repo"
gh release verify-asset "$tag" release-output/SHA256SUMS.txt --repo "$repo"
```

若 CLI 缺少签名校验命令，改用公开链接下载两项资产并与本次构建比对。

```bash
(
  set -euo pipefail
  public_dir=$(mktemp -d)
  for asset in "$zip_name" SHA256SUMS.txt; do
    curl -fsSL "https://github.com/$repo/releases/download/$tag/$asset" -o "$public_dir/$asset"
    cmp "$public_dir/$asset" "release-output/$asset"
  done
)
```

公开结果异常时保留现场，停止报告发布成功。

Release 公开后会自动触发 [Pages 部署](DEPLOYING.md)。记录本次发布的 tag、提交、CI、预检和 Pages 运行链接，等整个 Pages 作业通过后再报告上线完成。
