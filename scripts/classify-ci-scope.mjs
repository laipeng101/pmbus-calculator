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

/** @param {string[]} paths */
export function isDocumentationOnly(paths) {
  return (
    paths.length > 0 &&
    paths.every(
      (file) =>
        docs.has(file) ||
        /^docs\/[^\u0000-\u001f\u007f]+\.md$/.test(file) ||
        /^\.github\/ISSUE_TEMPLATE\/[^/\u0000-\u001f\u007f]+\.(?:md|ya?ml)$/.test(file),
    )
  )
}

if (import.meta.main) {
  // Check the merge commit against its target parent, including both sides of renames.
  const changed = execFileSync('git', [
    'diff',
    '--name-only',
    '--no-renames',
    '-z',
    'HEAD^1',
    'HEAD',
    '--',
  ])
  const docsOnly = isDocumentationOnly(changed.toString().split('\0').filter(Boolean))
  console.log(`Documentation only: ${docsOnly}`)
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `docs_only=${docsOnly}\n`)
  }
}
