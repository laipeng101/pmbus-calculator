// M32 WP-C: the verification contract must have a single source of truth.
// `npm run verify` in package.json, the full-tier ci.yml steps, and the
// verify expansions documented in AGENTS.md and CONTRIBUTING.md drifted
// apart (probe P4: both docs were missing check:toolchain,
// test:release-security and check:tailwind-scope even though package.json
// and CI run them).
//
// These structural tests detect MISSING, DUPLICATE and WRONG-ORDER entries --
// not just substring presence:
//   V1. package verify expands to the exact canonical sequence
//   V2/V3. AGENTS.md and CONTRIBUTING.md expansions match it EXACTLY
//   V4. ci.yml full-tier core steps keep the same relative order
//       (hygiene runs unconditionally first in CI; the whitespace gate is a
//       single base..head check -- both are deliberate differences)
//   V5. coverage scope/thresholds come from the SHARED constants module
//       (vite.config.ts and vitest.coverage.config.ts consume one source)
//   V6. the coverage config excludes exactly SECURITY_TEST_FILES -- a tenth
//       suite added to the shared list is excluded automatically
//   V7. the coverage config spreads SECURITY_TEST_FILES instead of copying
//       the file list by hand

// @vitest-environment node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import { SECURITY_TEST_FILES } from '../scripts/release-security-test-contract.mjs'

const REPO_ROOT = path.resolve(process.cwd())
const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'))

/** Canonical 17-step verify sequence (script names, no `npm run` prefix). */
function packageVerifySeq(): string[] {
  const verify: string = String(pkg.scripts.verify)
  return verify
    .split('&&')
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0)
    .map((s: string) => (s.startsWith('npm run ') ? s.slice('npm run '.length) : s))
}

/** AGENTS.md inline list: `` `format:check`、`typecheck`、… `` (backticked). */
function agentsVerifySeq(): string[] {
  const text = fs.readFileSync(path.join(REPO_ROOT, 'AGENTS.md'), 'utf8')
  // The inline list runs from "展开为：" to the sentence-ending 。 after the
  // final item (`npm audit --audit-level=high`); no 。 appears inside the list.
  const m = text.match(/`npm run verify` 展开为：([\s\S]*?)。/)
  expect(m, 'AGENTS.md must document the verify expansion as an inline list').not.toBeNull()
  const items = [...String(m?.[1] ?? '').matchAll(/`([^`]+)`/g)].map((x) => x[1])
  // The marker line itself contains one backticked token (`npm run verify`).
  return items.filter((s) => s !== 'npm run verify')
}

/** CONTRIBUTING.md bash block: `npm run X` / `git diff --check` per line. */
function contributingVerifySeq(): string[] {
  const text = fs.readFileSync(path.join(REPO_ROOT, 'CONTRIBUTING.md'), 'utf8')
  const marker = '`npm run verify` 依次执行：'
  const start = text.indexOf(marker)
  expect(start, 'CONTRIBUTING.md must document the verify expansion').toBeGreaterThanOrEqual(0)
  const codeStart = text.indexOf('```bash', start) + '```bash'.length
  const codeEnd = text.indexOf('```', codeStart)
  const block = text.slice(codeStart, codeEnd)
  const items = block
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => (l.startsWith('npm run ') ? l.slice('npm run '.length) : l))
  return items
}

describe('M32 WP-C verification contract (single source of truth)', () => {
  it('V1: package verify expands to the exact canonical 17-step sequence', () => {
    expect(packageVerifySeq()).toEqual([
      'format:check',
      'typecheck',
      'lint',
      'check:markdown-math',
      'specs:check',
      'check:release-contract',
      'check:toolchain',
      'test:coverage',
      'test:release-security',
      'test:e2e',
      'build',
      'check:tailwind-scope',
      'test:e2e:release',
      'check:repo-hygiene',
      'git diff --check',
      'git diff --cached --check',
      'npm audit --audit-level=high',
    ])
    // No duplicates in the package chain itself.
    expect(new Set(packageVerifySeq()).size).toBe(packageVerifySeq().length)
  })

  it('V2: AGENTS.md verify expansion matches package.json EXACTLY (missing/duplicate/order)', () => {
    const doc = agentsVerifySeq()
    const pkgSeq = packageVerifySeq()
    expect(doc).toEqual(pkgSeq)
  })

  it('V3: CONTRIBUTING.md verify expansion matches package.json EXACTLY (missing/duplicate/order)', () => {
    const doc = contributingVerifySeq()
    const pkgSeq = packageVerifySeq()
    expect(doc).toEqual(pkgSeq)
  })

  it('V4: ci.yml full-tier core steps keep package verify relative order', () => {
    const workflow = fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8')
    const steps = workflow
      .split(/^ {6}- /m)
      .slice(1)
      .map((b) => {
        const run = b.match(/^ {8}run: (.+)$/m)?.[1]?.trim()
        return run ?? ''
      })
      .filter((r) => r.length > 0)

    // Steps that must appear in CI in the SAME relative order as verify.
    // check:repo-hygiene is exempt from the order (CI runs it unconditionally
    // FIRST as an early gate; verify runs it near the end) but must exist.
    // The whitespace gate is a single base..head check in CI, exempt.
    const ordered = packageVerifySeq().filter(
      (s) => s !== 'check:repo-hygiene' && !s.startsWith('git diff'),
    )
    const idx = ordered.map((s) => steps.findIndex((r) => r.includes(s)))
    for (let i = 0; i < ordered.length; i++) {
      expect(idx[i], `CI must run ${ordered[i]}`).toBeGreaterThanOrEqual(0)
      if (i > 0) {
        expect(idx[i], `CI order drift at ${ordered[i]} (after ${ordered[i - 1]})`).toBeGreaterThan(
          idx[i - 1],
        )
      }
    }
    // Hygiene exists in CI and is unconditional (not behind the full-tier gate).
    const hygieneStep = workflow
      .split(/^ {6}- /m)
      .find((b) => /name: Repository hygiene gate/.test(b))
    expect(hygieneStep).toBeDefined()
    expect(hygieneStep).not.toContain(FULL_TIER_CONDITION)
  })

  it('V5: coverage scope and thresholds come from the SHARED constants module (no manual copy)', async () => {
    const shared = await import('../scripts/vitest-shared-config.mjs')
    const coverageCfg = (await import('../vitest.coverage.config.ts')).default
    const baseCfg = (await import('../vite.config.ts')).default
    expect(coverageCfg.test?.coverage?.include).toEqual(shared.COVERAGE_SCOPE_INCLUDE)
    expect(coverageCfg.test?.coverage?.thresholds).toEqual(shared.COVERAGE_THRESHOLDS)
    expect(baseCfg.test?.coverage?.include).toEqual(shared.COVERAGE_SCOPE_INCLUDE)
    expect(baseCfg.test?.coverage?.thresholds).toEqual(shared.COVERAGE_THRESHOLDS)
    expect(baseCfg.test?.exclude).toEqual(shared.BASE_TEST_EXCLUDE)
    // Both configs actually import the shared module (not just happen to match).
    for (const f of ['vite.config.ts', 'vitest.coverage.config.ts']) {
      const src = fs.readFileSync(path.join(REPO_ROOT, f), 'utf8')
      expect(src, `${f} must import the shared constants`).toMatch(/vitest-shared-config\.mjs/)
      expect(src, `${f} must not re-declare the thresholds object`).not.toMatch(
        /thresholds:\s*\{\s*lines:\s*80/,
      )
    }
  })

  it('V6: the coverage config excludes exactly SECURITY_TEST_FILES -- a tenth suite is excluded automatically', async () => {
    const coverageCfg = (await import('../vitest.coverage.config.ts')).default
    const exclude: unknown[] = coverageCfg.test?.exclude ?? []
    const secInExclude = exclude.filter(
      (f): f is string => typeof f === 'string' && SECURITY_TEST_FILES.includes(f),
    )
    expect([...secInExclude].sort()).toEqual([...SECURITY_TEST_FILES].sort())
    // The tenth suite (this milestone's own file) is already excluded via the
    // shared list -- no coverage re-execution for it.
    expect(exclude).toContain('tests/m32-child-group-lifecycle.test.ts')
    expect(SECURITY_TEST_FILES).toContain('tests/m32-child-group-lifecycle.test.ts')
  })

  it('V7: the coverage config spreads SECURITY_TEST_FILES instead of copying the list', async () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'vitest.coverage.config.ts'), 'utf8')
    expect(src).toContain('...SECURITY_TEST_FILES')
    // No literal security file names may be hardcoded into the config.
    for (const f of SECURITY_TEST_FILES) {
      expect(src, `config must not hardcode ${f}`).not.toContain(`'${f}'`)
      expect(src, `config must not hardcode ${f}`).not.toContain(`"${f}"`)
    }
  })
})

const FULL_TIER_CONDITION = "steps.scope.outputs.run_full != 'false'"
