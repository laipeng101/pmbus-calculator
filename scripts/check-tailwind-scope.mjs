// Gate: Tailwind production source-scope isolation (M17).
//
// Verifies the REAL build output under dist/ (never just config strings):
// - negative: the canary utility parsed from tests/tailwind-source-canary.ts
//   (a file outside the production scan scope) must not be generated, and the
//   known leaked rules `.lowercase{}` / `.table{}` must not appear. Those
//   selectors previously leaked from English prose in non-production files.
// - positive: utilities proven to be authored in production sources
//   (`flex`, `uppercase`, `min-w-0`, `italic`) must exist, so a broken
//   `source(none)` / `@source` config cannot silently strip every utility.
//
// Only CSS that embeds the `--color-canvas` theme marker (the compiled
// src/styles/tokens.css) is judged; katex.min.css is out of scope.
//
// Run after `npm run build` — see the `verify` script and .github/workflows/ci.yml.

import { realpathSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const CANARY_EXPORT_NAME = 'TAILWIND_SOURCE_CANARY_UTILITY'
const TAILWIND_CSS_MARKER = '--color-canvas'

// Selectors authored in production sources; update consciously if product
// code stops using one of them.
const REQUIRED_PRODUCT_UTILITIES = ['flex', 'uppercase', 'min-w-0', 'italic']

// Rules that previously leaked from non-production prose. If product code ever
// needs one of these classes for real, remove it here and say why in the PR.
const FORBIDDEN_LEAKED_SELECTORS = ['lowercase', 'table']

/**
 * @param {string} importMetaUrl
 * @returns {string}
 */
export function repoRootFromScript(importMetaUrl) {
  return path.resolve(path.dirname(fileURLToPath(importMetaUrl)), '..')
}

/**
 * @param {string} canarySource
 * @returns {string}
 */
export function parseCanaryUtility(canarySource) {
  const pattern = new RegExp(`export\\s+const\\s+${CANARY_EXPORT_NAME}\\s*=\\s*['"]([^'"]+)['"]`)
  const match = canarySource.match(pattern)
  if (!match) {
    throw new Error(
      `could not parse the \`${CANARY_EXPORT_NAME}\` string export from canary source`,
    )
  }
  return match[1]
}

// The generated rule embeds the arbitrary value (e.g. `.w-\[77\.125rem\]{…}`)
// so the search needle is the bracket payload when present, else the literal.
/**
 * @param {string} canaryUtility
 * @returns {string}
 */
export function canarySearchNeedle(canaryUtility) {
  const match = canaryUtility.match(/\[(.+)\]/)
  return match ? match[1] : canaryUtility
}

/**
 * @param {string} selector
 * @returns {RegExp}
 */
function escapedRuleRegex(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\.${escaped}\\{`)
}

/**
 * @param {string} root
 * @returns {Promise<string[]>}
 */
async function walkFiles(root) {
  const files = []
  const entries = await fs.readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(full)))
    } else if (entry.isFile()) {
      files.push(full)
    }
  }
  return files
}

/**
 * @param {{ distDir: string, canaryPath: string, productionSrcDir: string }} params
 * @returns {Promise<{ ok: boolean, errors: string[], canaryUtility: string, tailwindCss: string[] }>}
 */
export async function checkTailwindScope({ distDir, canaryPath, productionSrcDir }) {
  const errors = []
  let canaryUtility = ''

  try {
    canaryUtility = parseCanaryUtility(await fs.readFile(canaryPath, 'utf8'))
  } catch (/** @type {*} */ error) {
    errors.push(`cannot read canary utility from ${canaryPath}: ${error.message}`)
  }

  const needle = canaryUtility ? canarySearchNeedle(canaryUtility) : ''
  if (canaryUtility) {
    // The canary must be unique: any appearance inside production sources (or
    // the custom tokens.css) would generate the rule regardless of scope.
    const productionFiles = (await walkFiles(productionSrcDir)).filter(
      (file) => !file.endsWith('.test.ts'),
    )
    for (const file of productionFiles) {
      const text = await fs.readFile(file, 'utf8')
      if (text.includes(canaryUtility) || (needle && text.includes(needle))) {
        errors.push(
          `canary "${canaryUtility}" collides with production source ` +
            `${path.relative(productionSrcDir, file)}; pick a unique value in tests/tailwind-source-canary.ts`,
        )
      }
    }
  }

  /** @type {string[]} */
  let cssFiles = []
  try {
    cssFiles = (await walkFiles(distDir)).filter((file) => file.endsWith('.css'))
  } catch {
    errors.push(`dist directory not found: ${distDir} — run npm run build first`)
  }

  const tailwindCss = []
  const cssContents = new Map()
  for (const file of cssFiles) {
    const text = await fs.readFile(file, 'utf8')
    cssContents.set(file, text)
    if (text.includes(TAILWIND_CSS_MARKER)) {
      tailwindCss.push(file)
    }
  }

  if (tailwindCss.length === 0 && !errors.some((message) => message.startsWith('dist'))) {
    errors.push(
      `no compiled Tailwind CSS found under ${distDir} ` +
        `(no asset contains the "${TAILWIND_CSS_MARKER}" marker); ` +
        'the build may be missing or the theme was stripped',
    )
  }

  if (tailwindCss.length > 0) {
    const combined = tailwindCss.map((file) => cssContents.get(file)).join('\n')
    const fileNames = tailwindCss.map((file) => path.relative(distDir, file)).join(', ')

    if (needle && combined.includes(needle)) {
      errors.push(
        `canary "${canaryUtility}" leaked into compiled CSS (${fileNames}); ` +
          'Tailwind is scanning non-production files — check @source in src/styles/tokens.css',
      )
    }

    for (const selector of FORBIDDEN_LEAKED_SELECTORS) {
      if (escapedRuleRegex(selector).test(combined)) {
        errors.push(
          `leaked rule ".${selector}{…}" present in compiled CSS (${fileNames}); ` +
            'this selector is known to leak from non-production prose — ' +
            'if product code now needs it for real, update FORBIDDEN_LEAKED_SELECTORS consciously',
        )
      }
    }

    for (const utility of REQUIRED_PRODUCT_UTILITIES) {
      if (!escapedRuleRegex(utility).test(combined)) {
        errors.push(
          `required product utility ".${utility}{…}" missing from compiled CSS (${fileNames}); ` +
            'the @source scope may be too narrow — check src/styles/tokens.css',
        )
      }
    }
  }

  return { ok: errors.length === 0, errors, canaryUtility, tailwindCss }
}

function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(
      'check-tailwind-scope.mjs — gate Tailwind production source isolation\n\nUsage:\n  node scripts/check-tailwind-scope.mjs\n',
    )
    process.exit(0)
  }
  if (args.length > 0) {
    process.stderr.write(`unknown option(s): ${args.join(' ')}\n`)
    process.exit(2)
  }

  const repoRoot = repoRootFromScript(import.meta.url)
  checkTailwindScope({
    distDir: path.join(repoRoot, 'dist'),
    canaryPath: path.join(repoRoot, 'tests', 'tailwind-source-canary.ts'),
    productionSrcDir: path.join(repoRoot, 'src'),
  }).then((result) => {
    if (result.canaryUtility) {
      process.stdout.write(`tailwind-scope: canary utility ${result.canaryUtility}\n`)
    }
    if (result.tailwindCss.length > 0) {
      process.stdout.write(
        `tailwind-scope: judging compiled CSS: ${result.tailwindCss
          .map((file) => path.relative(repoRoot, file))
          .join(', ')}\n`,
      )
    }
    for (const message of result.errors) {
      process.stderr.write(`tailwind-scope: ${message}\n`)
    }
    if (result.ok) {
      process.stdout.write('tailwind-scope: OK\n')
    } else {
      process.stderr.write(`tailwind-scope: FAILED with ${result.errors.length} error(s)\n`)
    }
    process.exitCode = result.ok ? 0 : 1
  })
}

const isDirectRun =
  typeof process.argv[1] === 'string' &&
  process.argv[1].length > 0 &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])

if (isDirectRun) {
  main()
}
