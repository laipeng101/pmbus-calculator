// M31 WP-A: local `npm run verify` must include the zero-skip
// release-security runner, and `test:coverage` must run on a DEDICATED
// vitest config that excludes exactly the shared SECURITY_TEST_FILES --
// otherwise every security test executes TWICE in a full verification
// (probe P2: coverage ran all 813 tests including the nine security files'
// 188 tests, then the CI zero-skip step ran the same 188 again).
//
// These are structural contract tests (test-first, red against M30 main):
//   A1. verify chain includes the zero-skip runner
//   A2. the coverage config excludes exactly SECURITY_TEST_FILES
//   A3. coverage include/thresholds stay identical to vite.config.ts
//   A4. test:coverage script points at the dedicated coverage config
//   A5. within verify, release-security runs AFTER test:coverage
//
// Node environment: importing the real vite.config.ts / coverage config under
// jsdom trips esbuild's TextEncoder invariant; these are pure config-shape
// assertions and need no DOM.

// @vitest-environment node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import { SECURITY_TEST_FILES } from '../scripts/release-security-test-contract.mjs'

const REPO_ROOT = path.resolve(process.cwd())
const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'))

describe('M31 WP-A local/CI gate alignment and verification de-duplication', () => {
  it('A1: npm run verify includes the zero-skip release-security runner', () => {
    expect(pkg.scripts.verify).toContain('npm run test:release-security')
  })

  it('A2: the coverage config excludes exactly SECURITY_TEST_FILES (no copied file list)', async () => {
    const cfg = (await import('../vitest.coverage.config.ts')).default
    const exclude: unknown[] = cfg.test?.exclude ?? []
    const secInExclude = exclude.filter(
      (f): f is string => typeof f === 'string' && SECURITY_TEST_FILES.includes(f),
    )
    expect([...secInExclude].sort()).toEqual([...SECURITY_TEST_FILES].sort())
  })

  it('A3: coverage include scope and thresholds are unchanged from vite.config.ts', async () => {
    const coverageCfg = (await import('../vitest.coverage.config.ts')).default
    const baseCfg = (await import('../vite.config.ts')).default
    expect(coverageCfg.test?.coverage?.include).toEqual(baseCfg.test?.coverage?.include)
    expect(coverageCfg.test?.coverage?.thresholds).toEqual(baseCfg.test?.coverage?.thresholds)
    expect(coverageCfg.test?.environment).toBe(baseCfg.test?.environment)
  })

  it('A4: test:coverage script runs the dedicated coverage config', () => {
    expect(pkg.scripts['test:coverage']).toContain('vitest.coverage.config')
  })

  it('A5: within verify, release-security is ordered after test:coverage', () => {
    const verify = pkg.scripts.verify
    const coverageIdx = verify.indexOf('npm run test:coverage')
    const securityIdx = verify.indexOf('npm run test:release-security')
    expect(coverageIdx).toBeGreaterThan(-1)
    expect(securityIdx).toBeGreaterThan(coverageIdx)
  })
})
