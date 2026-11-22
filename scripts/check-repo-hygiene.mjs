import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const MiB = 1024 * 1024

/**
 * @param {string} repoRoot
 * @param {string[]} args
 * @param {string} [input]
 */
function git(repoRoot, args, input) {
  return execFileSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    input,
  })
}

/** @param {string} repoRoot */
export function inspectIndex(repoRoot) {
  const ignored = git(repoRoot, [
    'ls-files',
    '--cached',
    '--ignored',
    '--exclude-from=.gitignore',
    '-z',
  ])
    .split('\0')
    .filter(Boolean)

  const files = git(repoRoot, ['ls-files', '--stage', '-z'])
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf('\t')
      const [mode, object, stage] = entry.slice(0, separator).split(' ')
      const path = entry.slice(separator + 1)

      if (stage !== '0') throw new Error(`resolve the index conflict at ${JSON.stringify(path)}`)
      // Submodule entries reference commits, so there is no file blob to measure.
      return { path, object: mode === '160000' ? undefined : object }
    })

  const objects = [...new Set(files.flatMap(({ object }) => (object ? [object] : [])))]
  const sizes = new Map()
  if (objects.length) {
    const output = git(
      repoRoot,
      ['cat-file', '--batch-check=%(objectsize)'],
      `${objects.join('\n')}\n`,
    ).split('\n')
    objects.forEach((object, index) => {
      const size = Number.parseInt(output[index], 10)
      if (!/^\d+$/.test(output[index])) throw new Error(`cannot read indexed blob ${object}`)
      sizes.set(object, size)
    })
  }

  let totalSize = 0
  const oversized = []
  for (const { path, object } of files) {
    const size = object === undefined ? 0 : sizes.get(object)
    totalSize += size
    if (size > MiB) oversized.push({ path, size })
  }

  return { paths: files.map(({ path }) => path), ignored, oversized, totalSize }
}

if (import.meta.main) {
  try {
    const { paths, ignored, oversized, totalSize } = inspectIndex(
      fileURLToPath(new URL('..', import.meta.url)),
    )
    for (const path of ignored) {
      console.error(`REJECTED ${JSON.stringify(path)}: tracked path matches .gitignore`)
    }
    for (const { path, size } of oversized) {
      console.error(`REJECTED ${JSON.stringify(path)}: indexed file exceeds 1 MiB (${size} bytes)`)
    }
    const snapshots = paths.filter((path) => path.startsWith('tests/e2e/visual.spec.ts-snapshots/'))
    const legacy = paths.includes('pmbus-calculator.html') ? 1 : 0
    console.log(
      `repo-hygiene: ${paths.length} indexed paths (${snapshots.length} visual snapshots, ${legacy} legacy HTML), ${totalSize} bytes (${(totalSize / MiB).toFixed(2)} MiB)`,
    )
    const failed = ignored.length > 0 || oversized.length > 0
    console.log(failed ? 'repo-hygiene: FAILED' : 'repo-hygiene: OK')
    process.exitCode = failed ? 1 : 0
  } catch (error) {
    console.error(`repo-hygiene: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
