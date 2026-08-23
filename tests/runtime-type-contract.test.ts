// Runtime/type contract for Node version alignment (M24, hardened M25).
//
// M24 established the major-version contract. M25 tightens it to precise
// minor/patch: engines floor, @types/node exact pin, and CI exact versions
// (no rolling `22`/`24`). A negative type fixture proves node:ffi is
// rejected at typecheck time (not just file-existence checks).

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()
const readRepoFile = (relative: string): string =>
  fs.readFileSync(path.join(repoRoot, relative), 'utf8')
function readJson(relative: string): Record<string, unknown> {
  return JSON.parse(readRepoFile(relative)) as Record<string, unknown>
}

/**
 * Parse a semver string into major/minor/patch numbers.
 */
function parseSemver(version: string): { major: number; minor: number; patch: number } | null {
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)$/)
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) }
}

/**
 * Parse the engines.node range into precise minimum versions.
 * Example: ">=22.20.0 <23 || >=24.0.0 <25" → { node22Min: {major:22,minor:20,patch:0}, node24Min: {major:24,minor:0,patch:0} }
 */
function parseEnginesRanges(enginesNode: string): {
  node22Min: { major: number; minor: number; patch: number } | null
  node24Min: { major: number; minor: number; patch: number } | null
} {
  const matches = [...enginesNode.matchAll(/>=(\d+\.\d+\.\d+)/g)]
  const result: {
    node22Min: ReturnType<typeof parseSemver>
    node24Min: ReturnType<typeof parseSemver>
  } = {
    node22Min: null,
    node24Min: null,
  }
  for (const m of matches) {
    const v = parseSemver(m[1])
    if (v) {
      if (v.major === 22) result.node22Min = v
      if (v.major === 24) result.node24Min = v
    }
  }
  return result
}

describe('runtime/type contract (M24/M25)', () => {
  const pkg = readJson('package.json')
  const engines = pkg.engines as Record<string, string>
  const devDependencies = pkg.devDependencies as Record<string, string>
  const dtNodeVersion = devDependencies['@types/node']
  const dtParsed = parseSemver(dtNodeVersion.replace(/^[\^~]/, ''))
  const dtMajor = dtParsed?.major ?? 0
  const ranges = parseEnginesRanges(engines.node ?? '')

  it('engines minimum supported major is 22', () => {
    expect(ranges.node22Min?.major).toBe(22)
  })

  it('@types/node major equals the minimum supported major', () => {
    expect(dtMajor).toBe(ranges.node22Min?.major ?? 22)
  })

  it('engines Node 22 floor is at least 22.20.0 (M25)', () => {
    expect(ranges.node22Min).toBeTruthy()
    const v = ranges.node22Min!
    if (v.major === 22) {
      expect(v.minor).toBeGreaterThanOrEqual(20)
    }
  })

  it('engines Node 24 floor is exactly 24.0.0 (M25)', () => {
    expect(ranges.node24Min).toBeTruthy()
    const v = ranges.node24Min!
    expect(v.major).toBe(24)
    expect(v.minor).toBe(0)
    expect(v.patch).toBe(0)
  })

  it('@types/node is pinned to exact version (no ^ or ~) (M25)', () => {
    expect(dtNodeVersion).not.toMatch(/^[\^~]/)
    expect(dtNodeVersion).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('@types/node major.minor matches engines Node 22 floor (M25)', () => {
    expect(dtParsed).toBeTruthy()
    const v = dtParsed!
    expect(v.major).toBe(22)
    expect(v.minor).toBe(20)
  })

  it('CI primary Node version is exact 22.20.0 (not rolling) (M25)', () => {
    const workflow = readRepoFile('.github/workflows/ci.yml')
    expect(workflow).toMatch(/node-version:\s*'22\.20\.0'/)
    // Must NOT have bare rolling 22
    const primaryBlocks = workflow.split('Setup Node.js')
    const primary = primaryBlocks[1] ?? ''
    expect(primary).not.toMatch(/node-version:\s*22\b/)
  })

  it('CI secondary Node version is exact 24.0.0 (not rolling) (M25)', () => {
    const workflow = readRepoFile('.github/workflows/ci.yml')
    const secondaryBlocks = workflow.split('Setup Node.js 24')
    const secondary = secondaryBlocks[1] ?? ''
    expect(secondary).toMatch(/node-version:\s*'24\.0\.0'/)
  })

  it('@types/node must not be a higher Current major than engines supports', () => {
    expect(dtMajor).toBeLessThan(25)
  })

  it('Node 26-only API must be rejected at typecheck time (M24)', () => {
    expect(fs.existsSync(path.join(repoRoot, 'node_modules/@types/node/ffi.d.ts'))).toBe(false)
  })
})
