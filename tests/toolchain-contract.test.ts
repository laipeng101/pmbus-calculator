import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { expect, it } from 'vitest'

it('accepts the pinned toolchain and rejects a different Node version', () => {
  const canonicalNode = readFileSync('.node-version', 'utf8').trim()
  const script = path.resolve('scripts/check-toolchain.mjs')
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 30_000 })
  expect(result.error).toBeUndefined()

  if (process.versions.node === canonicalNode) {
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('toolchain: OK')
  } else {
    expect(result.status, result.stdout).toBe(1)
    expect(result.stderr).toContain(`got ${process.versions.node}`)
  }
})
