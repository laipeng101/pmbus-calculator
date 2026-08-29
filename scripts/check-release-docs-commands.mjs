// Gate: release operator docs command contract (v2.5.13).
//
// PR #74 proved that release-operator documentation can drift from the real
// CLI while every light-tier gate stays green (`scripts/classify-ci-scope.mjs`
// classifies all of docs/ as light-only, so a docs-only PR never runs the
// release tooling). This gate closes that gap with the cheapest meaningful
// check: it extracts the executable `node scripts/verify-downloaded-assets.mjs`
// invocations from the operator documentation and the Pages workflow,
// rebuilds their argv against REAL offline fixtures (a valid zip built with
// the shared python verifier available, SHA256SUMS.txt, REST metadata), and
// executes the production script.
//
// Contract enforced:
//   - docs/RELEASING.md carries the operator draft gate WITH `--metadata`
//     (the PR #74 fix; a positional metadata file is a usage error) and
//     `--mode draft`;
//   - .github/workflows/pages.yml carries the published gate with
//     `--mode published`;
//   - the documented argv runs the real verifier to exit 0;
//   - dropping `--metadata` (positional form) and an invalid `--mode` are
//     rejected by the real parser with exit 2.
//
// No network, no GitHub calls, no trial release. Failure messages name the
// source file, the command and the difference.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const RELEASING_DOC = 'docs/RELEASING.md'
export const PAGES_WORKFLOW = '.github/workflows/pages.yml'
export const VERIFIER_SCRIPT = 'scripts/verify-downloaded-assets.mjs'
export const REQUIRED_FLAGS = ['--metadata', '--dir', '--tag', '--repo', '--mode']

/**
 * @param {string} importMetaUrl
 * @returns {string}
 */
export function repoRootFromScript(importMetaUrl) {
  return path.resolve(path.dirname(fileURLToPath(importMetaUrl)), '..')
}

// Backslash continuations are joined first so a command split across lines in
// a fenced block becomes one logical line.
/**
 * @param {string} text
 * @returns {string[]}
 */
export function extractVerifierCommands(text) {
  const joined = text.replace(/\\\s*\n\s*/g, ' ')
  return joined
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter((line) => line.startsWith(`node ${VERIFIER_SCRIPT}`))
    .map((line) => {
      const redirect = line.indexOf(' > ')
      return redirect === -1 ? line : line.slice(0, redirect)
    })
}

/**
 * @param {string} command
 * @returns {string[]}
 */
export function tokenizeCommand(command) {
  return command.trim().split(/\s+/)
}

// Validate flag presence and mode value; returns human-readable problems.
/**
 * @param {string[]} tokens
 * @returns {string[]}
 */
export function validateTokens(tokens) {
  /** @type {string[]} */
  const problems = []
  for (const flag of REQUIRED_FLAGS) {
    if (!tokens.includes(flag)) problems.push(`missing required flag ${flag}`)
  }
  if (!tokens.includes('--metadata')) {
    problems.push(
      'metadata file must be passed as --metadata <file> (positional form is a usage error)',
    )
  }
  const mode = tokens[tokens.indexOf('--mode') + 1]
  if (mode !== 'draft' && mode !== 'published') {
    problems.push(`--mode must be "draft" or "published" (got ${JSON.stringify(mode ?? null)})`)
  }
  return problems
}

// Rebuild the documented argv against fixture values: every value consumed by
// the gate is replaced regardless of how the doc spelled it (template token,
// quoted shell variable or literal).
/**
 * @param {string[]} tokens
 * @param {{ tag: string, repo: string, metadataPath: string, dir: string }} fixture
 * @returns {string[]}
 */
export function rebuildArgv(tokens, fixture) {
  /** @type {Record<string, string>} */
  const valueByFlag = {
    '--metadata': fixture.metadataPath,
    '--dir': fixture.dir,
    '--tag': fixture.tag,
    '--repo': fixture.repo,
  }
  /** @type {string[]} */
  const argv = []
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    const replacement = valueByFlag[token]
    if (replacement !== undefined) {
      argv.push(token, replacement)
      index++
      continue
    }
    if (token === '--mode') {
      argv.push(token, tokens[index + 1])
      index++
      continue
    }
    argv.push(token)
  }
  return argv
}

/**
 * @param {string} zipPath
 * @param {string} indexHtml
 * @returns {void}
 */
export function buildFixtureZip(zipPath, indexHtml) {
  const py = [
    'import sys, zipfile',
    'zip_path, index = sys.argv[1], sys.argv[2]',
    'entries = sys.argv[3:]',
    'with zipfile.ZipFile(zip_path, "w") as zf:',
    '    zf.writestr("index.html", index)',
    '    for name in entries:',
    '        zf.writestr(name, b"payload")',
  ].join('\n')
  const result = spawnSync(
    'python3',
    ['-c', py, zipPath, indexHtml, 'assets/app.js', 'assets/app.css'],
    { encoding: 'utf8' },
  )
  if (result.status !== 0) {
    throw new Error(`python3 zip fixture build failed: ${result.stderr}`)
  }
}

// REST-shaped metadata matching what the operator flow (gh api releases) and
// the Pages workflow (releases/tags/<tag>) consume; draft mode uses GitHub's
// `untagged-<hex>` placeholder browser_download_url exactly like the real API.
/**
 * @param {string} repo
 * @param {string} tag
 * @param {string} dir
 * @param {string} zipName
 * @param {string} sumsName
 * @param {boolean} draft
 * @returns {Record<string, unknown>}
 */
export function buildMetadata(repo, tag, dir, zipName, sumsName, draft) {
  const urlFor = (/** @type {string} */ name) =>
    `https://github.com/${repo}/releases/download/${
      draft ? 'untagged-' + 'f'.repeat(12) : tag
    }/${name}`
  const asset = (/** @type {string} */ name) => ({
    name,
    size: fs.statSync(path.join(dir, name)).size,
    state: 'uploaded',
    browser_download_url: urlFor(name),
  })
  return { tag_name: tag, draft, prerelease: false, assets: [asset(zipName), asset(sumsName)] }
}

/**
 * @param {string} repoRoot
 * @returns {{ ok: boolean, problems: string[], validated: string[] }}
 */
export function checkReleaseDocsCommands(repoRoot) {
  /** @type {string[]} */
  const problems = []
  /** @type {string[]} */
  const validated = []

  const sources = [
    { file: RELEASING_DOC, expectedMode: 'draft' },
    { file: PAGES_WORKFLOW, expectedMode: 'published' },
  ]

  /** @type {Record<string, string[]>} */
  const commandsByMode = { draft: [], published: [] }
  for (const source of sources) {
    const filePath = path.join(repoRoot, source.file)
    if (!fs.existsSync(filePath)) {
      problems.push(`${source.file}: file not found`)
      continue
    }
    const commands = extractVerifierCommands(fs.readFileSync(filePath, 'utf8'))
    if (commands.length === 0) {
      problems.push(`${source.file}: no "node ${VERIFIER_SCRIPT}" invocation found`)
      continue
    }
    for (const command of commands) {
      const tokens = tokenizeCommand(command)
      const tokenProblems = validateTokens(tokens)
      if (tokenProblems.length > 0) {
        problems.push(`${source.file}: ${tokenProblems.join('; ')}\n  command: ${command}`)
        continue
      }
      const mode = tokens[tokens.indexOf('--mode') + 1]
      commandsByMode[mode].push(command)
      validated.push(`${source.file}: ${command}`)
    }
  }

  if (commandsByMode.draft.length === 0) {
    problems.push(`${RELEASING_DOC}: no --mode draft verifier invocation found`)
  }
  if (commandsByMode.published.length === 0) {
    problems.push(`${PAGES_WORKFLOW}: no --mode published verifier invocation found`)
  }
  if (problems.length > 0) return { ok: false, problems, validated }

  // Real end-to-end execution on offline fixtures.
  const fixtureTag = 'v9.9.9'
  const fixtureRepo = 'owner/repo'
  const zipName = `pmbus-calculator-${fixtureTag}-web.zip`
  const sumsName = 'SHA256SUMS.txt'
  const indexHtml = [
    '<!doctype html>',
    '<html><head>',
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; script-src 'self'; style-src 'self'\">",
    '<link rel="stylesheet" href="assets/app.css">',
    '</head><body>',
    '<script type="module" src="assets/app.js"></script>',
    '</body></html>',
  ].join('\n')

  for (const mode of /** @type {const} */ (['draft', 'published'])) {
    const command = commandsByMode[mode][0]
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-docs-contract-'))
    try {
      buildFixtureZip(path.join(dir, zipName), indexHtml)
      fs.writeFileSync(
        path.join(dir, sumsName),
        `${createHash('sha256')
          .update(fs.readFileSync(path.join(dir, zipName)))
          .digest('hex')}  ${zipName}\n`,
      )
      const metadata = buildMetadata(
        fixtureRepo,
        fixtureTag,
        dir,
        zipName,
        sumsName,
        mode === 'draft',
      )
      const metadataPath = path.join(dir, 'release-metadata.json')
      fs.writeFileSync(metadataPath, JSON.stringify(metadata))
      const argv = rebuildArgv(tokenizeCommand(command), {
        tag: fixtureTag,
        repo: fixtureRepo,
        metadataPath,
        dir,
      })
      const result = spawnSync('node', argv.slice(1), { encoding: 'utf8', timeout: 60_000 })
      if (result.status !== 0) {
        problems.push(
          `${mode} fixture run exited ${result.status} (expected 0)\n  command: ${command}\n  stderr: ${(result.stderr || '').trim()}`,
        )
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }

  // Negative contracts against the REAL CLI parser (PR #74 regression): the
  // documented draft command must fail when --metadata is dropped (positional
  // form) or the mode is misspelled.
  const draftCommand = commandsByMode.draft[0]
  /** @type {{ name: string, mutate: (tokens: string[]) => string[] }[]} */
  const negatives = [
    {
      name: 'positional metadata (no --metadata)',
      mutate: (tokens) => tokens.filter((t) => t !== '--metadata'),
    },
    {
      name: 'invalid --mode',
      mutate: (tokens) => tokens.map((t) => (t === 'draft' ? 'bogus' : t)),
    },
  ]
  for (const negative of negatives) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-docs-contract-'))
    try {
      buildFixtureZip(path.join(dir, zipName), indexHtml)
      fs.writeFileSync(
        path.join(dir, sumsName),
        `${createHash('sha256')
          .update(fs.readFileSync(path.join(dir, zipName)))
          .digest('hex')}  ${zipName}\n`,
      )
      const metadata = buildMetadata(fixtureRepo, fixtureTag, dir, zipName, sumsName, true)
      const metadataPath = path.join(dir, 'release-metadata.json')
      fs.writeFileSync(metadataPath, JSON.stringify(metadata))
      const mutated = negative.mutate(tokenizeCommand(draftCommand))
      const argv = rebuildArgv(mutated, {
        tag: fixtureTag,
        repo: fixtureRepo,
        metadataPath,
        dir,
      })
      const result = spawnSync('node', argv.slice(1), { encoding: 'utf8', timeout: 60_000 })
      if (result.status !== 2) {
        problems.push(
          `negative "${negative.name}" exited ${result.status} (expected 2)\n  command: ${draftCommand}`,
        )
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }

  return { ok: problems.length === 0, problems, validated }
}

function main() {
  const report = checkReleaseDocsCommands(repoRootFromScript(import.meta.url))
  for (const entry of report.validated) {
    process.stdout.write(`release-docs-contract: validated ${entry}\n`)
  }
  if (!report.ok) {
    for (const problem of report.problems) {
      process.stderr.write(`release-docs-contract: FAIL ${problem}\n`)
    }
    process.exitCode = 1
    return
  }
  process.stdout.write(
    'release-docs-contract: OK (operator docs and Pages workflow match the real verifier CLI)\n',
  )
}

const isDirectRun =
  typeof process.argv[1] === 'string' &&
  process.argv[1].length > 0 &&
  realpathSafe(process.argv[1]) === realpathSafe(fileURLToPath(import.meta.url))

/**
 * @param {string} value
 * @returns {string}
 */
function realpathSafe(value) {
  try {
    return fs.realpathSync(value)
  } catch {
    return value
  }
}

if (isDirectRun) {
  main()
}
