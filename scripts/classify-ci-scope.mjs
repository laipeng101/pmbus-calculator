import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'

const docs = new Set([
  'AGENTS.md',
  'CLAUDE.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'README.md',
  'README_zh-CN.md',
  'THIRD_PARTY_NOTICES.md',
  'document/README.md',
  '.github/pull_request_template.md',
])

const pagesOverlayInputs = new Set([
  '.github/workflows/ci.yml',
  '.github/workflows/release.yml',
  '.node-version',
  'index.html',
  'package-lock.json',
  'package.json',
  'playwright.deployment.config.ts',
  'playwright.pages-overlay.config.ts',
  'playwright.shared.ts',
  'scripts/apply-pages-overlay.mjs',
  'scripts/classify-ci-scope.mjs',
  'scripts/pages-network-policy.mjs',
  'scripts/pages-overlay-contract.mjs',
  'scripts/pages-overlay.css',
  'scripts/prepare-pages-overlay-test.mjs',
  'scripts/prepare-release-assets.mjs',
  'scripts/release-artifact-contract.mjs',
  'scripts/release-zip.py',
  'scripts/verify-pages-asset-references.mjs',
  'scripts/verify-pages-overlay.mjs',
  'src/App.tsx',
  'src/components/feedback/ThemeToggle.tsx',
  'src/components/layout/AppHeader.tsx',
  'src/main.tsx',
  'src/styles/tokens.css',
  'tests/e2e/deployment.spec.ts',
  'tests/e2e/helpers/browser-resources.ts',
  'tests/e2e/helpers/pages-contract.ts',
  'tests/e2e/pages-overlay.spec.ts',
  'vite.config.ts',
])

/** @param {string} file */
function isDocumentation(file) {
  return (
    docs.has(file) ||
    /^docs\/[^\u0000-\u001f\u007f]+\.md$/.test(file) ||
    /^\.github\/ISSUE_TEMPLATE\/[^/\u0000-\u001f\u007f]+\.(?:md|ya?ml)$/.test(file)
  )
}

/** @param {string[]} paths */
export function classifyChanges(paths) {
  if (paths.length === 0 || paths.some((file) => pagesOverlayInputs.has(file))) return 'pages'
  const code = paths.filter((file) => !isDocumentation(file))
  if (code.length === 0) return 'docs'
  if (
    code.every((file) =>
      /^(?:src\/|tests\/(?!e2e\/))[^\u0000-\u001f\u007f]+\.test\.tsx?$/.test(file),
    )
  ) {
    return 'unit'
  }
  return 'browser'
}

if (import.meta.main) {
  let scope = 'pages'
  if (process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch') {
    // Include both sides of renames in the PR merge commit's diff from the target parent.
    const changed = execFileSync('git', [
      'diff',
      '--name-only',
      '--no-renames',
      '-z',
      'HEAD^1',
      'HEAD',
      '--',
    ])
    scope = classifyChanges(changed.toString().split('\0').filter(Boolean))
  }
  console.log(`CI scope: ${scope}`)
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `scope=${scope}\n`)
  }
}
