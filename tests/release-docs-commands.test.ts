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
  VERIFIER_SCRIPT,
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

  it('rejects a flag the real verifier CLI does not accept', () => {
    const problems = validateTokens(
      tokenizeCommand(
        'node scripts/verify-downloaded-assets.mjs --metadata m.json --dir . --tag v1.2.3 --repo owner/repo --mode draft --unsupported',
      ),
    )
    expect(problems.some((problem) => problem.includes('unknown flag --unsupported'))).toBe(true)
  })

  it('rejects a duplicate flag instead of relying on CLI last-wins', () => {
    const problems = validateTokens(
      tokenizeCommand(
        'node scripts/verify-downloaded-assets.mjs --metadata m.json --dir . --tag v1.2.3 --tag v9.9.9 --repo owner/repo --mode draft',
      ),
    )
    expect(problems.some((problem) => problem.includes('duplicate flag --tag'))).toBe(true)
  })

  it('rejects a required flag left without a value', () => {
    const trailing = validateTokens(
      tokenizeCommand(
        'node scripts/verify-downloaded-assets.mjs --metadata m.json --dir . --tag --repo owner/repo --mode draft',
      ),
    )
    expect(trailing.some((problem) => problem.includes('missing value for --tag'))).toBe(true)
    const flaggedValue = validateTokens(
      tokenizeCommand(
        'node scripts/verify-downloaded-assets.mjs --metadata m.json --dir . --tag --repo owner/repo --mode draft --metadata m2.json',
      ),
    )
    expect(flaggedValue.some((problem) => problem.includes('missing value for --tag'))).toBe(true)
  })

  it('rejects shell syntax instead of interpreting it', () => {
    const substitution = validateTokens(
      tokenizeCommand(
        'node scripts/verify-downloaded-assets.mjs --metadata m.json --dir . --tag $(git describe) --repo owner/repo --mode draft',
      ),
    )
    expect(substitution.some((problem) => problem.includes('unsupported shell syntax'))).toBe(true)
    const chained = validateTokens(
      tokenizeCommand(
        'node scripts/verify-downloaded-assets.mjs --metadata m.json --dir . --tag v1.2.3 --repo owner/repo --mode draft; echo pwned',
      ),
    )
    expect(
      chained.some((problem) => problem.includes('shell syntax') || problem.includes('positional')),
    ).toBe(true)
  })

  it('explicitly rejects a quoted path containing spaces rather than reassembling it', () => {
    const problems = validateTokens(
      tokenizeCommand(
        'node scripts/verify-downloaded-assets.mjs --metadata m.json --dir "/tmp/my dir" --tag v1.2.3 --repo owner/repo --mode draft',
      ),
    )
    expect(problems).not.toEqual([])
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
    // The supported command count is part of the contract: exactly one draft
    // gate command in RELEASING.md and one published gate command in the
    // Pages workflow, each really executed (v2.5.14).
    expect(report.executed).toBe(2)
    expect(report.validated).toHaveLength(2)
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

describe('checkReleaseDocsCommands — per-source mode binding and per-command execution (v2.5.14)', () => {
  const realVerifierPath = path.join(repoRoot, VERIFIER_SCRIPT)
  const draftCommand =
    'node scripts/verify-downloaded-assets.mjs --metadata draft-release.json --dir /tmp/assets --tag vX.Y.Z --repo laipeng101/pmbus-calculator --mode draft'
  const pagesCommand =
    'node scripts/verify-downloaded-assets.mjs --metadata release-metadata.json --dir . --tag "${RELEASE_TAG}" --repo "${GITHUB_REPOSITORY}" --mode published'
  const fence = (command: string) => '```bash\n' + command + '\n```'

  function makeFixtureRepo(releasing: string, pages: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-docs-binding-'))
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true })
    fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true })
    fs.writeFileSync(path.join(dir, RELEASING_DOC), releasing)
    fs.writeFileSync(path.join(dir, PAGES_WORKFLOW), pages)
    return dir
  }

  it('passes with correct fixture docs when the production verifier is passed explicitly', () => {
    const dir = makeFixtureRepo(fence(draftCommand), fence(pagesCommand))
    try {
      const report = checkReleaseDocsCommands(dir, { verifierPath: realVerifierPath })
      expect(report.problems).toEqual([])
      expect(report.ok).toBe(true)
      expect(report.executed).toBe(2)
      expect(report.validated).toHaveLength(2)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)

  it('fails closed on a mode swap across sources (v2.5.13 false positive, offline repro)', () => {
    // The sources come from the repoRoot argument while process.cwd() still
    // points at the real repo with its VALID docs — if the checker resolved
    // sources from the parent cwd this would wrongly pass.
    const dir = makeFixtureRepo(
      fence(draftCommand.replace('--mode draft', '--mode published')),
      fence(pagesCommand.replace('--mode published', '--mode draft')),
    )
    try {
      const report = checkReleaseDocsCommands(dir, { verifierPath: realVerifierPath })
      expect(report.ok).toBe(false)
      expect(report.validated).toEqual([])
      expect(
        report.problems.some(
          (problem) => problem.includes(RELEASING_DOC) && problem.includes('requires --mode draft'),
        ),
      ).toBe(true)
      expect(
        report.problems.some(
          (problem) =>
            problem.includes(PAGES_WORKFLOW) && problem.includes('requires --mode published'),
        ),
      ).toBe(true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)

  it('fails closed when only one source carries the wrong mode', () => {
    const dir = makeFixtureRepo(
      fence(draftCommand.replace('--mode draft', '--mode published')),
      fence(pagesCommand),
    )
    try {
      const report = checkReleaseDocsCommands(dir, { verifierPath: realVerifierPath })
      expect(report.ok).toBe(false)
      expect(
        report.problems.some(
          (problem) => problem.includes(RELEASING_DOC) && problem.includes('requires --mode draft'),
        ),
      ).toBe(true)
      expect(report.problems.some((problem) => problem.startsWith(PAGES_WORKFLOW))).toBe(false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)

  it('rejects a second documented command with an unknown flag instead of running only the first', () => {
    const dir = makeFixtureRepo(
      `${fence(draftCommand)}\n${fence(`${draftCommand} --unsupported`)}`,
      fence(pagesCommand),
    )
    try {
      const report = checkReleaseDocsCommands(dir, { verifierPath: realVerifierPath })
      expect(report.ok).toBe(false)
      // Nothing is execution-validated: the parse-phase rejection happens
      // before any run, and no command is silently skipped.
      expect(report.validated).toEqual([])
      expect(
        report.problems.some(
          (problem) =>
            problem.includes(RELEASING_DOC) &&
            problem.includes('unknown flag --unsupported') &&
            problem.includes('--unsupported'),
        ),
      ).toBe(true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('binds the default verifier path to the checked root, not the parent process cwd', () => {
    const dir = makeFixtureRepo(fence(draftCommand), fence(pagesCommand))
    try {
      // No options.verifierPath: the default resolves into the fixture root
      // where no script exists. The parent cwd DOES have the real script, so
      // a cwd-relative resolution would silently run the production verifier
      // (the v2.5.13 binding gap) and pass.
      const report = checkReleaseDocsCommands(dir)
      expect(report.ok).toBe(false)
      expect(report.validated).toEqual([])
      expect(report.problems.some((problem) => problem.includes('entry script not found'))).toBe(
        true,
      )
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails closed on a documented command beyond the supported argv format', () => {
    const dir = makeFixtureRepo(
      fence(`${draftCommand} --tag v1.2.3 | tee stolen.json`),
      fence(pagesCommand),
    )
    try {
      const report = checkReleaseDocsCommands(dir, { verifierPath: realVerifierPath })
      expect(report.ok).toBe(false)
      expect(report.validated).toEqual([])
      expect(
        report.problems.some(
          (problem) =>
            problem.includes(RELEASING_DOC) &&
            (problem.includes('shell syntax') || problem.includes('positional')),
        ),
      ).toBe(true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails closed when a source has no verifier invocation at all', () => {
    const dir = makeFixtureRepo('```bash\nnpm run verify\n```', fence(pagesCommand))
    try {
      const report = checkReleaseDocsCommands(dir, { verifierPath: realVerifierPath })
      expect(report.ok).toBe(false)
      expect(
        report.problems.some(
          (problem) => problem.includes(RELEASING_DOC) && problem.includes('no "node'),
        ),
      ).toBe(true)
      expect(report.validated).toEqual([])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
