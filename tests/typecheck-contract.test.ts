// Regression tests for the real TypeScript verification gate (M23).
//
// Before M23, `npm run typecheck` ran `tsc --noEmit` against the solution-style
// root tsconfig (`files: []` + references), which checks zero files and always
// exits 0. The gate now runs `tsc -b` over the referenced app, node, and tests
// projects. These assertions pin that contract structurally so the gate cannot
// silently regress into an empty program again:
// - the root tsconfig references exactly the app/node/tests projects,
// - `package.json` typecheck uses build mode (`tsc -b`), never bare
//   `tsc --noEmit` on the empty root config,
// - the pre-commit hook and full CI still invoke `npm run typecheck`,
// - `tsconfig.tests.json` actually covers unit tests, E2E specs, and every
//   Playwright config entry point under strict mode.

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

describe('typecheck contract (M23)', () => {
  it('keeps the root tsconfig as an empty solution config', () => {
    const root = readJson('tsconfig.json')
    expect(root.files).toEqual([])
  })

  it('references exactly the app, node, scripts, and tests projects (M24)', () => {
    const root = readJson('tsconfig.json')
    const references = root.references as Array<{ path: string }> | undefined
    const paths = (references ?? []).map((ref) => ref.path)
    expect(paths).toEqual([
      './tsconfig.app.json',
      './tsconfig.node.json',
      './tsconfig.scripts.json',
      './tsconfig.tests.json',
    ])
  })

  it('runs typecheck in build mode over the referenced projects', () => {
    const pkg = readJson('package.json')
    const scripts = pkg.scripts as Record<string, string>
    expect(scripts.typecheck).toMatch(/^tsc -b\b/)
    // The old gate ran bare `tsc --noEmit` on the empty root config: zero
    // checked files, always exit 0. It must not come back.
    expect(scripts.typecheck).not.toBe('tsc --noEmit')
    expect(scripts.typecheck).not.toContain('--noEmit')
  })

  it('keeps the pre-commit hook on the real typecheck gate', () => {
    const pkg = readJson('package.json')
    const hooks = pkg['simple-git-hooks'] as Record<string, string>
    expect(hooks['pre-commit']).toContain('npm run typecheck')
  })

  it('keeps full CI on the real typecheck gate', () => {
    const workflow = readRepoFile('.github/workflows/ci.yml')
    expect(workflow).toMatch(/^ {8}run: npm run typecheck\s*$/m)
  })

  it('keeps tsconfig.tests.json strict with Node and Vitest globals', () => {
    const tests = readJson('tsconfig.tests.json') as {
      compilerOptions?: Record<string, unknown>
    }
    const options = tests.compilerOptions ?? {}
    expect(options.strict).toBe(true)
    expect(options.noUnusedLocals).toBe(true)
    expect(options.noUnusedParameters).toBe(true)
    expect(options.allowJs).toBe(true)
    expect(options.types).toEqual(['node', 'vitest/globals'])
    expect(options.noEmit).toBe(true)
    // Build info stays inside the ignored node_modules temp location so tsc
    // never drops unignored JS/d.ts/buildinfo into the repository.
    expect(String(options.tsBuildInfoFile)).toMatch(/^\.\/node_modules\/\.tmp\//)
  })

  it('covers unit tests, E2E specs, and every Playwright config entry', () => {
    const tests = readJson('tsconfig.tests.json') as { include?: string[] }
    const include = tests.include ?? []
    expect(include).toContain('tests')
    for (const config of [
      'playwright.config.ts',
      'playwright.release.config.ts',
      'playwright.visual.config.ts',
      'playwright.deployment.config.ts',
      'playwright.cross-engine.config.ts',
    ]) {
      expect(include).toContain(config)
      expect(fs.existsSync(path.join(repoRoot, config))).toBe(true)
    }
  })

  it('declares @types/node as a direct devDependency', () => {
    const pkg = readJson('package.json')
    const devDependencies = pkg.devDependencies as Record<string, string>
    // Node typings must not depend on transitive luck.
    expect(devDependencies['@types/node']).toMatch(/^\^?\d+\.\d+\.\d+/)
  })

  it('locks @types/node major to the engines minimum supported Node major (M24)', () => {
    const pkg = readJson('package.json')
    const devDependencies = pkg.devDependencies as Record<string, string>
    const engines = pkg.engines as Record<string, string>
    const dtNodeVersion = devDependencies['@types/node']
    const dtMajor = Number(dtNodeVersion.replace(/^[\^~]/, '').split('.')[0])
    // Extract the minimum supported major from engines, e.g. ">=22 <23 || >=24 <25" → 22
    const engineMinMatch = engines.node?.match(/>=(\d+)/)
    expect(engineMinMatch).toBeTruthy()
    const engineMinMajor = Number(engineMinMatch![1])
    expect(dtMajor).toBe(engineMinMajor)
    // @types/node must not drift to a higher Current version than the minimum
    // supported runtime. Node 26 is not in engines.
    expect(dtMajor).toBeLessThan(26)
  })

  it('includes scripts checkJs project with strict + checkJs enabled (M24)', () => {
    const scripts = readJson('tsconfig.scripts.json') as {
      compilerOptions?: Record<string, unknown>
      include?: string[]
    }
    const options = scripts.compilerOptions ?? {}
    expect(options.strict).toBe(true)
    expect(options.checkJs).toBe(true)
    expect(options.allowJs).toBe(true)
    expect(options.noEmit).toBe(true)
    expect(options.types).toEqual(['node'])
    expect(String(options.tsBuildInfoFile)).toMatch(/^\.\/node_modules\/\.tmp\//)
    const include = scripts.include ?? []
    expect(include).toContain('scripts/**/*.mjs')
  })
})
