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
  if (paths.length === 0) return 'browser'
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
  const scope = classifyChanges(changed.toString().split('\0').filter(Boolean))
  console.log(`CI scope: ${scope}`)
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `scope=${scope}\n`)
  }
}
