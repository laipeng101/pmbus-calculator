// Gate: no inline style props in production React sources.
//
// AGENTS.md prohibits new inline `style` attributes in JSX. This script scans
// all production TypeScript/TSX sources under `src/` and fails if any `style=`
// attribute is present. Visual state that previously depended on CSS variables
// must live in tokens.css classes / data attributes instead.
//
// Run as part of `npm run verify` and CI quality.

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const SOURCE_DIR = 'src'

/**
 * @param {string} root
 * @returns {Promise<string[]>}
 */
async function walkFiles(root) {
  const files = []
  const entries = await fs.readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === 'node_modules') continue
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(full)))
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      files.push(full)
    }
  }
  return files
}

/**
 * @param {string} repoRoot
 * @returns {Promise<{ ok: boolean, errors: string[], files: string[] }>}
 */
export async function checkInlineStyle(repoRoot) {
  const sourceDir = path.join(repoRoot, SOURCE_DIR)
  const files = await walkFiles(sourceDir)
  const errors = []

  for (const file of files) {
    const text = await fs.readFile(file, 'utf8')
    // The project currently uses zero inline style props. Any occurrence,
    // including `style={expression}`, is a regression against AGENTS.md.
    if (/\bstyle=/.test(text)) {
      errors.push(`${path.relative(repoRoot, file)} contains an inline style prop`)
    }
  }

  return { ok: errors.length === 0, errors, files }
}

function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  checkInlineStyle(repoRoot)
    .then((result) => {
      if (result.ok) {
        process.stdout.write(
          `check-inline-style: ok (${result.files.length} source files, 0 inline style props)\n`,
        )
        return
      }
      process.stderr.write('check-inline-style failed:\n')
      for (const error of result.errors) process.stderr.write(`  - ${error}\n`)
      process.exitCode = 1
    })
    .catch((error) => {
      process.stderr.write(`check-inline-style error: ${error.stack}\n`)
      process.exitCode = 1
    })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
