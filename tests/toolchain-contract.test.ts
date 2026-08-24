// M30 WP-E: canonical Node/npm toolchain contract (test-first).
//
// The M29 toolchain is drifting: .nvmrc/.node-version are bare "22", CI
// primary is 22.20.0 / secondary 24.0.0, Pages uses rolling `22`,
// packageManager is npm@10.9.0 and engines.npm is only ">=10" (probe G).
// The canonical release index (nodejs.org/dist/index.json, checked on the
// task date) has v24 LTS latest = 24.19.0 with npm 11.17.0.
//
// M30 canonical:
//   - primary Node 24.19.0 (via .node-version), compatibility Node 22.20.0
//   - npm 11.17.0 exact in packageManager + engines.npm + CI + devEngines
//   - no rolling `22`/`24`/`latest`/`current`/`lts/*`, no check-latest
//   - @types/node stays pinned to 22.20.1 (minimum supported surface)
//   - `npm run doctor` (check:toolchain) validates everything and fails
//     closed on any inconsistency

import { spawnSync } from 'node:child_process'
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

describe('M30 WP-E canonical Node/npm toolchain', () => {
  const pkg = readJson('package.json')
  const engines = pkg.engines as Record<string, string>
  const devEngines = pkg.devEngines as Record<string, unknown> | undefined

  it('E1: .node-version and .nvmrc pin the canonical primary exactly (24.19.0)', () => {
    expect(readRepoFile('.node-version').trim()).toBe('24.19.0')
    expect(readRepoFile('.nvmrc').trim()).toBe('24.19.0')
  })

  it('E2: engines.node promotes the Node 24 floor to 24.19.0 and keeps 22.20.0 compatibility', () => {
    const nodeRange = engines.node
    expect(nodeRange).toContain('>=24.19.0')
    expect(nodeRange).toContain('>=22.20.0')
    expect(nodeRange).toMatch(/<25/)
    expect(nodeRange).toMatch(/<23/)
  })

  it('E3: engines.npm requires >=11.17.0 <12 (no bare ">=10")', () => {
    expect(engines.npm).toBe('>=11.17.0 <12')
  })

  it('E4: packageManager pins npm@11.17.0 exactly', () => {
    expect(pkg.packageManager).toBe('npm@11.17.0')
  })

  it('E5: devEngines declares the packageManager fail-closed contract (Node versions live in engines.node + check:toolchain)', () => {
    expect(devEngines).toBeDefined()
    const de = devEngines as {
      packageManager?: { name?: string; version?: string; onFail?: string }
    }
    // npm's devEngines schema supports runtime only for {cpu,libc,os}; the
    // Node-version contract is enforced by engines.node and check:toolchain.
    expect(de.packageManager?.name).toBe('npm')
    expect(de.packageManager?.version).toBe('11.17.0')
    expect(de.packageManager?.onFail).toBe('error')
    expect(engines.node).toContain('>=22.20.0') // compatibility line
    expect(engines.node).toContain('>=24.19.0') // primary line
  })

  it('E6: CI primary verification reads .node-version (24.19.0), not a hardcoded older version', () => {
    const workflow = readRepoFile('.github/workflows/ci.yml')
    expect(workflow).toMatch(/node-version-file:\s*['"]?\.node-version['"]?/)
    // No bare rolling versions or check-latest anywhere in setup-node input.
    expect(workflow).not.toMatch(/node-version:\s*(22|24)\b/)
    expect(workflow).not.toMatch(/node-version:\s*(latest|current|lts\/\*)\b/)
    expect(workflow).not.toMatch(/check-latest:\s*true/)
  })

  it('E7: CI compatibility step pins exact Node 22.20.0', () => {
    const workflow = readRepoFile('.github/workflows/ci.yml')
    expect(workflow).toMatch(/node-version:\s*'22\.20\.0'/)
  })

  it('E8: CI uses exact npm 11.17.0 for both runtimes (activation step present)', () => {
    const workflow = readRepoFile('.github/workflows/ci.yml')
    expect(workflow).toMatch(/npm@11\.17\.0|npm install -g npm@11\.17\.0|npm i -g npm@11\.17\.0/)
  })

  it('E9: Pages workflow reads .node-version (no rolling 22)', () => {
    const pages = readRepoFile('.github/workflows/pages.yml')
    expect(pages).toMatch(/node-version-file:\s*['"]?\.node-version['"]?/)
    expect(pages).not.toMatch(/node-version:\s*(22|24)\b/)
    expect(pages).not.toMatch(/node-version:\s*(latest|current|lts\/\*)\b/)
    expect(pages).not.toMatch(/check-latest:\s*true/)
  })

  it('E10: @types/node stays pinned to the minimum supported Node 22 surface (22.20.1)', () => {
    const devDependencies = pkg.devDependencies as Record<string, string>
    expect(devDependencies['@types/node']).toBe('22.20.1')
  })

  it('E11: npm run doctor / check:toolchain exists; exit 0 on the canonical runtime, fail-closed otherwise', () => {
    const scripts = pkg.scripts as Record<string, string>
    const hasDoctor = 'doctor' in scripts || 'check:toolchain' in scripts
    expect(hasDoctor).toBe(true)
    const command = scripts.doctor ?? scripts['check:toolchain']
    expect(command).toMatch(/check-toolchain/)
    const res = spawnSync(
      process.execPath,
      [path.join(repoRoot, 'scripts', 'check-toolchain.mjs')],
      {
        encoding: 'utf8',
        timeout: 30_000,
      },
    )
    const isCanonical = process.versions.node === '24.19.0'
    if (isCanonical) {
      expect(res.status).toBe(0)
      expect(String(res.stdout)).toMatch(/node|npm/i)
      expect(String(res.stdout)).toMatch(/OK/)
    } else {
      // Fail-closed on non-canonical runtimes (e.g. the Node 22.20.0
      // compatibility check): the tree is NOT consistent there.
      expect(res.status).not.toBe(0)
      expect(String(res.stderr)).toMatch(/FAIL|fail closed/i)
    }
  })
})
