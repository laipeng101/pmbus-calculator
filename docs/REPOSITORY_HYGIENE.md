# REPOSITORY HYGIENE

> 本文件是仓库卫生与制品政策的唯一详细来源。
> 其他文档只保留简短链接：`AGENTS.md`（agent 必读与任务结束门禁）、`CONTRIBUTING.md`（提交前命令）、`docs/UI_CONVENTIONS.md`（视觉基线专属规则）、`.gitignore`（实际模式）、`package.json`（可执行命令）。
> `docs/archive/**` 默认不读、不搜索，不参与普通 agent 上下文。

## 1. Tracked / untracked 文件政策

### 必须跟踪（Git）

- 源码、配置、测试、Markdown 文档、package lock。
- Playwright golden baseline：`tests/e2e/visual.spec.ts-snapshots/*.png`（darwin canonical）。
- 未来经审核采用的同目录 lossless WebP：`tests/e2e/visual.spec.ts-snapshots/*.webp`。
- 规范 provenance：`document/specifications.json`（官方 URL、字节数与 SHA-256 的唯一机器可读来源）和 `document/README.md`（开发者使用说明）。
- `THIRD_PARTY_NOTICES.md`：第三方规范与 MIT 代码的分发边界说明。
- `pmbus-calculator.html`：文档明确承诺的 read-only legacy/offline fallback。
- 真实产品需要的静态资源，且必须有真实运行引用。

### 不跟踪（Git ignored 或 CI Artifact）

- `dist/`、`build/`、`out/`、`coverage/`、`node_modules/`。
- `playwright-report/`、`test-results/`。
- `tests/e2e/output/`、`tests/e2e/output-*/`、`tests/e2e/report/`、`tests/e2e/report-*/`（含 `output-visual/`、`report-visual/` 及未来变体）。
- `*.log`、`*.lcov`、`*.zip`、`*.tgz`、`*.tar`、`*.tar.gz`、`*.map`、`*.jsonl`。
- `.DS_Store`、`Thumbs.db`。
- Playwright 失败截图：`*-actual.png`、`*-diff.png`、`*-failed.png`。
- `docs/archive/release-evidence/**/*.png`：一次性 GitHub Markdown 渲染过程截图；原始证据从历史 tag/commit 追溯，不留在 active tree。
- `.cache/specifications/`：开发者按需下载的规范 PDF 缓存；可安全 clean，不得提交。
- 所有 PDF：当前 policy 不再跟踪任何 PDF；第三方规范 PDF 从官方 URL 下载到 ignored cache。

## 2. 图片分类

| 类别                          | 示例                                         | 处理                                   |
| ----------------------------- | -------------------------------------------- | -------------------------------------- |
| Playwright golden baseline    | `tests/e2e/visual.spec.ts-snapshots/*.png`   | 提交到 Git；不得全局忽略 PNG           |
| Playwright actual/diff/failed | `*-actual.png`、`*-diff.png`、`*-failed.png` | 本地临时目录或 CI Artifact；不提交     |
| GitHub Markdown 临时渲染截图  | `docs/archive/release-evidence/**/*.png`     | 临时 Artifact；不提交，历史 tag 可追溯 |
| 产品正式图片资源              | 源码资源目录并有真实运行引用                 | 提交到 Git                             |
| 规范 PDF                      | `.cache/specifications/*.pdf`                | ignored cache；按需下载，不提交        |

## 3. Visual snapshot 审批规则

1. Playwright golden snapshot 是测试输入，应提交到版本控制。
2. actual、diff、failed screenshot 和 HTML report 是临时输出，不提交。
3. snapshot 必须在与现有基线相同的环境中生成：
   - 当前 canonical 环境为 darwin；
   - 必须记录操作系统、Node、Playwright、Chromium 和 viewport。
4. `--update-snapshots` 不是普通修复命令：
   - 必须先确认变化是预期变化；
   - 必须审查实际截图或 diff；
   - 不得只因为测试失败就批量更新。
5. 没有图像输入能力的 agent：
   - 可以增加几何、overflow、换行、对比度和 computed-style 断言；
   - 可以运行已有基线并报告是否变化；
   - 不得自行接受或更新新的视觉基线；
   - 不得声称完成了主观审美验收。
6. UI 任务如必须更新基线，应使用具备图像输入能力的复核模型，或明确停在等待视觉审批的状态。
7. 截图变化必须在 PR 中单独列出：
   - 新增多少、修改多少、删除多少；
   - 总字节变化；
   - 每张变化的原因。
8. 不使用 snapshot 替代数值、行为、无障碍或几何断言。
9. 不为了减小仓库而使用有损压缩。

`reduced-motion` 已改为普通 computed-style/行为断言，不使用独立 snapshot；其余基线不得被该变更更新。

## 4. Artifact 政策

| 内容                          | 存储位置                               |
| ----------------------------- | -------------------------------------- |
| Playwright golden baseline    | Git 仓库                               |
| actual/diff/failed screenshot | 本地临时目录或 CI Artifact             |
| Playwright HTML report        | CI Artifact，仅失败时                  |
| coverage HTML/LCOV            | CI Artifact 或日志，不进 Git           |
| Release ZIP/SHA256            | GitHub Release                         |
| GitHub Markdown 临时渲染截图  | 临时 Artifact；不进 active source tree |
| DSH 会话、compact、调试日志   | 不进 Git                               |
| 产品正式图片资源              | 源码资源目录，并有真实运行引用         |

CI Artifact 使用短期 retention（当前 Playwright report 为 7 天），不作为永久源码历史。

## 5. clean 与 hygiene 命令

```bash
npm run clean                  # 安全删除允许重建的生成目录，支持 -- --dry-run
npm run check:repo-hygiene     # 基于 git ls-files 的跟踪文件门禁
npm run verify                 # 完整本地门禁（已包含 specs:check 与 check:repo-hygiene）
```

`scripts/clean-generated.mjs` 只删除硬编码允许重建的目录：

`dist`、`build`、`out`、`coverage`、`playwright-report`、`test-results`、
`tests/e2e/output`、`tests/e2e/report`、`tests/e2e/output-release`、`tests/e2e/report-release`、
`tests/e2e/output-deployment`、`tests/e2e/report-deployment`、`tests/e2e/output-visual`、`tests/e2e/report-visual`、
`.cache/specifications`。

安全边界：

- 目标从仓库根目录解析为绝对路径；
- 校验目标位于仓库根目录内；
- 拒绝 `/`、用户目录、仓库根目录本身、空路径和符号链接逃逸；
- 不存在目录幂等跳过；
- 不删除 `node_modules`、snapshot 目录、`document/`（含 `document/specifications.json` 与 `document/README.md`）、`docs/archive/` 中剩余历史资料、源码、配置、Release notes、`THIRD_PARTY_NOTICES.md`；
- 不使用 shell 通配符和未经解析的环境变量执行递归删除；
- 支持 `--dry-run`。

`scripts/check-repo-hygiene.mjs` 基于 `git ls-files` 检查实际已跟踪路径，至少拒绝：

- `dist/`、`build/`、`out/`、`coverage/`、`node_modules/`；
- `playwright-report/`、`test-results/`；
- `tests/e2e/output/`、`tests/e2e/output-*/`、`tests/e2e/report/`、`tests/e2e/report-*/`；
- `.DS_Store`、`Thumbs.db`；
- `*.log`、`*.lcov`、`*.zip`、`*.tgz`、`*.tar`、`*.tar.gz`、source map（`*.map`）；
- DSH session JSONL（`*.jsonl`）；
- `*-actual.png`、`*-diff.png`、`*-failed.png`；
- `docs/archive/release-evidence/**/*.png`；
- 所有 tracked PDF（含 `document/*.pdf`）。

明确允许：

- `tests/e2e/visual.spec.ts-snapshots/*.png` 及未来经审核采用的同目录 lossless WebP；
- `pmbus-calculator.html`；
- `document/specifications.json`、`document/README.md`、`THIRD_PARTY_NOTICES.md`；
- 正常源码与 Markdown。

大文件检查：

- 任何新增跟踪文件超过 1 MiB 时失败；
- 未来确实需要例外时，必须通过清楚的路径 allowlist 和文档说明加入，不允许静默绕过。

输出语义：

- `policy allowlisted` 是政策例外总数，当前分为两类：`snapshots`（visual baseline PNG/WebP）、`legacy fallbacks`（`pmbus-calculator.html`）。
- tracked tree size 是当前 Git index/HEAD 中每个 tracked path 对应 blob size 的求和，按路径 entry 计数，不是 Git pack size，也不是 GitHub API 返回的 repository size。
- 脚本结果必须与 `git ls-tree -r -l HEAD` 的 tree size 语义一致；同一 blob 被多个路径共享时，每个路径都计入。

## 6. Agent 生命周期清理

### 任务开始

每次 agent 任务先报告：

- 当前 SHA、分支和工作区状态；
- 本次允许修改范围；
- 预计生成的临时目录；
- 本地验证计划；
- 是否涉及 snapshot 更新；
- 是否具备图像读取能力。

### 执行中

每个阶段结束时更新一次：

- 已完成事项；
- 实际改动文件；
- 已运行测试及结果；
- 当前阻塞；
- 下一阶段。

不要每执行一个 shell 命令就写长报告，也不要静默运行很长时间。
进度信息保留在 DSH 会话/plan 中，不创建并提交临时 TODO、agent transcript、compact summary、screenshot review 日志或命令输出全文。

### compact 前后

1. compact 前保存简洁检查点：当前分支和 HEAD、已修改文件、已完成阶段、未完成阶段、最近一次有效测试、尚未解决的风险。
2. compact 后重新执行：`git status --short --branch`、`git diff --stat`、当前 plan 核对。
3. 不因为 compact 重跑已证明且其依赖未变化的长测试。
4. 最终完整门禁仍必须在最后一次代码/配置修改之后运行。

### 任务结束

依次执行：

1. `npm run clean`
2. `npm run check:repo-hygiene`
3. `git status --short`
4. `git diff --check`
5. `git diff --cached --check`
6. `git ls-files` 禁止项扫描
7. 确认没有意外 untracked report/output
8. 确认 snapshot 数量和大小变化符合 PR 说明

禁止使用 `git clean -fdx`、面向仓库根目录的递归删除、未展开变量的 `rm -rf`、删除未知用户文件、重写 main 历史。

## 7. 例外审批方式

- 任何新的二进制跟踪或 >1 MiB 文件，必须在 `docs/REPOSITORY_HYGIENE.md` 或对应 PR 描述中说明：用途、运行时引用、是否可用 GitHub Release/CI Artifact 替代、保留理由。
- 必须同步更新 `scripts/check-repo-hygiene.mjs` 的 allowlist，并保持 `git check-ignore -v` 与 `npm run check:repo-hygiene` 双通过。
- 第三方规范 PDF 不进入当前 Git tree；provenance、官方链接和哈希进入 `document/specifications.json`，PDF 由开发者按需下载到 ignored `.cache/specifications/`。历史 tag/commit 不重写。

## 8. PR 统计与流程证据

1. PR 统计必须来自 final committed HEAD，不允许把 working tree、中间 commit 或 PR base 的统计写成最终结果。
2. 每次新增修复提交后都要重新生成统计；旧统计立即失效。
3. branch 全量 whitespace 检查使用 `git diff --check origin/main...HEAD`。
4. 最终树大小必须使用当前 HEAD，并通过 `npm run check:repo-hygiene` 与 `git ls-tree -r -l HEAD` 交叉验证。
5. PR CI 必须核对其 `head_sha` 等于最终 PR head。
6. merge 后必须比较 PR CI `Record checked revision` 步骤记录的 `checked_tree` 与最终
   merge SHA 的 `HEAD^{tree}`，两者必须完全相同（M19-B：main 不再有 push CI，tree
   一致即验证完成；不一致属于真实阻塞，用 `workflow_dispatch` 执行 full CI 并定位）。
7. 文件数、树大小、snapshot 数量、tracked PDF 数量（当前应为 0）和 legacy HTML 是否存在，均以 `git ls-tree -r -l HEAD` 为准；manifest 记录数以 `document/specifications.json` 为准。
