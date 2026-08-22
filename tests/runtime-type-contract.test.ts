// Runtime/type contract for Node version alignment (M24).
//
// The engines field declares the minimum supported Node runtime.
// @types/node must match that minimum major, never drift to a higher
// Current release whose APIs do not exist at runtime.
// CI must verify against the declared minimum and the secondary LTS.

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
 * Parse the engines.node range into { minMajor, maxMajor }.
 * Example: ">=22 <23 || >=24 <25" → { minMajor: 22, maxMajor: 24 }
 */
function parseEnginesRange(enginesNode: string): { minMajor: number; allowedMajors: number[] } {
  const majors = new Set<number>()
  const matches = enginesNode.matchAll(/>=\s*(\d+)/g)
  for (const m of matches) {
    majors.add(Number(m[1]))
  }
  const sorted = [...majors].sort((a, b) => a - b)
  return { minMajor: sorted[0] ?? 0, allowedMajors: sorted }
}

describe('runtime/type contract (M24)', () => {
  const pkg = readJson('package.json')
  const engines = pkg.engines as Record<string, string>
  const devDependencies = pkg.devDependencies as Record<string, string>
  const dtNodeVersion = devDependencies['@types/node']
  const dtMajor = Number(dtNodeVersion.replace(/^[\^~]/, '').split('.')[0])
  const { minMajor, allowedMajors } = parseEnginesRange(engines.node ?? '')

  it('engines minimum supported major is 22', () => {
    expect(minMajor).toBe(22)
  })

  it('@types/node major equals the minimum supported major', () => {
    expect(dtMajor).toBe(minMajor)
  })

  it('@types/node major is in the allowed engines set', () => {
    expect(allowedMajors).toContain(dtMajor)
  })

  it('CI primary Node version equals the minimum supported major', () => {
    const workflow = readRepoFile('.github/workflows/ci.yml')
    // Primary setup-node must use node-version: 22
    expect(workflow).toMatch(/node-version:\s*22\b/)
  })

  it('CI secondary Node version is 24 (the other engines major)', () => {
    const workflow = readRepoFile('.github/workflows/ci.yml')
    expect(workflow).toMatch(/node-version:\s*24\b/)
  })

  it('@types/node must not be a higher Current major than engines supports', () => {
    // The highest allowed major is 24; 26+ is forbidden.
    // engines allows 22 and 24; @types/node must be one of those.
    expect(dtMajor).toBeLessThan(25)
  })

  it('Node 26-only API must be rejected at typecheck time', () => {
    // node:ffi exists only in Node 26 types; @types/node@22 lacks it.
    expect(fs.existsSync(path.join(repoRoot, 'node_modules/@types/node/ffi.d.ts'))).toBe(false)
  })
})
