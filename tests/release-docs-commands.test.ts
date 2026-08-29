import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import {
  checkReleaseDocsCommands,
  extractVerifierCommands,
  PAGES_WORKFLOW,
  RELEASING_DOC,
  rebuildArgv,
  tokenizeCommand,
  validateTokens,
} from '../scripts/check-release-docs-commands.mjs'

// vitest (jsdom) does not expose import.meta.url as a file:// URL.
const repoRoot = path.resolve(process.cwd())

describe('extractVerifierCommands', () => {
  it('joins backslash-continued lines and strips redirects', () => {
    const doc = [
      '```bash',
      'gh api example \\',
      "  --jq '.[]' > draft-release.json",
      'node scripts/verify-downloaded-assets.mjs --metadata draft-release.json \\',
      '  --dir /tmp/assets \\',
      '  --tag vX.Y.Z --repo owner/repo --mode draft > draft-verified.json',
      '```',
    ].join('\n')
    const commands = extractVerifierCommands(doc)
    expect(commands).toHaveLength(1)
    expect(commands[0]).toBe(
      'node scripts/verify-downloaded-assets.mjs --metadata draft-release.json --dir /tmp/assets --tag vX.Y.Z --repo owner/repo --mode draft',
    )
  })

  it('returns nothing when the verifier is not invoked', () => {
    expect(extractVerifierCommands('```bash\nnpm run verify\n```')).toEqual([])
  })
})

describe('validateTokens', () => {
  it('accepts the documented draft invocation shape', () => {
    const problems = validateTokens(
      tokenizeCommand(
        'node scripts/verify-downloaded-assets.mjs --metadata m.json --dir . --tag v1.2.3 --repo owner/repo --mode draft',
      ),
    )
    expect(problems).toEqual([])
  })

  it('rejects the PR #74 positional-metadata regression', () => {
    const problems = validateTokens(
      tokenizeCommand(
        'node scripts/verify-downloaded-assets.mjs draft-release.json --dir . --tag v1.2.3 --repo owner/repo --mode draft',
      ),
    )
    expect(problems.some((problem) => problem.includes('--metadata'))).toBe(true)
  })

  it('rejects an unknown mode and missing flags', () => {
    const problems = validateTokens(
      tokenizeCommand('node scripts/verify-downloaded-assets.mjs --metadata m.json'),
    )
    expect(problems.length).toBeGreaterThan(1)
    expect(problems.some((problem) => problem.includes('--mode'))).toBe(true)
    expect(problems.some((problem) => problem.includes('--tag'))).toBe(true)
  })
})

describe('rebuildArgv', () => {
  it('substitutes template tags, quoted shell variables and doc paths with fixture values', () => {
    const argv = rebuildArgv(
      tokenizeCommand(
        'node scripts/verify-downloaded-assets.mjs --metadata release-metadata.json --dir . --tag "${RELEASE_TAG}" --repo "${GITHUB_REPOSITORY}" --mode published',
      ),
      { tag: 'v9.9.9', repo: 'owner/repo', metadataPath: '/tmp/f/meta.json', dir: '/tmp/f' },
    )
    expect(argv).toEqual([
      'node',
      'scripts/verify-downloaded-assets.mjs',
      '--metadata',
      '/tmp/f/meta.json',
      '--dir',
      '/tmp/f',
      '--tag',
      'v9.9.9',
      '--repo',
      'owner/repo',
      '--mode',
      'published',
    ])
  })

  it('replaces a literal doc repo slug with the fixture repo', () => {
    const argv = rebuildArgv(
      tokenizeCommand(
        'node scripts/verify-downloaded-assets.mjs --metadata m.json --dir d --tag vX.Y.Z --repo laipeng101/pmbus-calculator --mode draft',
      ),
      { tag: 'v9.9.9', repo: 'owner/repo', metadataPath: '/tmp/f/m.json', dir: '/tmp/f' },
    )
    expect(argv).toContain('v9.9.9')
    expect(argv).toContain('owner/repo')
    expect(argv).not.toContain('laipeng101/pmbus-calculator')
  })
})

describe('checkReleaseDocsCommands (real repo, real verifier, real fixtures)', () => {
  it('validates the operator draft gate and the Pages published gate end-to-end', () => {
    const report = checkReleaseDocsCommands(repoRoot)
    expect(report.problems).toEqual([])
    expect(report.ok).toBe(true)
    expect(report.validated.some((entry) => entry.startsWith(`${RELEASING_DOC}:`))).toBe(true)
    expect(report.validated.some((entry) => entry.startsWith(`${PAGES_WORKFLOW}:`))).toBe(true)
  }, 30_000)

  it('fails closed when the operator doc loses the verifier invocation', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-docs-missing-'))
    try {
      const report = checkReleaseDocsCommands(dir)
      expect(report.ok).toBe(false)
      expect(report.problems.some((problem) => problem.includes(RELEASING_DOC))).toBe(true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
