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
// Contract enforced (v2.5.14):
//   - docs/RELEASING.md carries the operator draft gate WITH `--metadata`
//     (the PR #74 fix; a positional metadata file is a usage error) and
//     `--mode draft`; .github/workflows/pages.yml carries the published gate
//     with `--mode published`. Sources are BOUND to their expected mode: a
//     command documented in the wrong source, or a source left without its
//     expected mode, fails the gate (a global per-mode bucket that let each
//     side satisfy the other was the v2.5.13 false positive).
//   - EVERY extracted command is either executed or explicitly rejected at
//     the argv contract (unknown flag, duplicate flag, missing value,
//     positional token, shell syntax, wrong mode) — none is silently skipped,
//     and only a command that actually ran the real verifier to exit 0 is
//     reported as execution validated.
//   - Execution is bound to the checked root: process.execPath runs the
//     verifier entry resolved from repoRoot (overridable via options) with
//     cwd=repoRoot — a stale relative script path resolved against the
//     parent process cwd was the v2.5.13 binding gap.
//   - dropping `--metadata` (positional form) and an invalid `--mode` are
//     rejected by the real parser with exit 2.
//
// Supported argv syntax is deliberately small: plain whitespace-separated
// argv with backslash continuations and at most one trailing ` > file`
// stdout redirect (bare `>` token, plain filename target, nothing after it —
// v2.5.15 tightened the extractor from "truncate at the first ` > `" to this
// explicit grammar after proving it validated a corrected command instead of
// the documented one, and silently substituted a token with an unbalanced
// quote that no shell could parse). Pipes, command substitution, lists and
// every other redirect form are rejected, not interpreted. No network, no
// GitHub calls, no trial release. Failure messages name the source file, the
// command and the difference.

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
// Flags the real verifier CLI (scripts/verify-downloaded-assets.mjs parseArgs)
// accepts on a documented gate command. --help/-h is a usage aid, not a gate
// invocation, and is deliberately unsupported here.
export const KNOWN_FLAGS = [
  '--metadata',
  '--dir',
  '--tag',
  '--repo',
  '--mode',
  '--zip-name',
  '--sums-name',
]
// These flag values are rebuilt against fixture data regardless of how the
// doc spelled them (template token, quoted shell variable or literal), so
// `${VAR}`-style spellings are legal exactly there.
const FIXTURE_SUBSTITUTED_FLAGS = new Set(['--metadata', '--dir', '--tag', '--repo'])
// Tokens containing any of these need a shell to interpret. The gate executes
// plain argv only — no pipes, lists, redirects or command substitution — and
// rejects them instead. The extractor strips exactly one trailing ` > file`
// redirect (the only redirect shape the documented operator flow uses) and
// leaves every other redirect form in the line so this backstop rejects the
// whole command explicitly.
const SHELL_SYNTAX = /[;|&`<>]|\$\(/

// The one supported redirect: a bare `>` token whose target is the LAST token
// of the logical command line (v2.5.15). The target must be a plain relative
// filename — no quotes, no template variables, no leading dash, nothing a
// shell would reinterpret. `>` in any other position (mid-command, doubled,
// with no target, with tokens after the target, `>>`, `2>`, `<`) stays in the
// returned command so the argv contract rejects it with the full original
// text; the extractor never silently truncates or repairs a command.
const REDIRECT_TARGET = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/

/**
 * @param {string} line - whitespace-normalized logical command line
 * @returns {{ command: string, redirectedTo: string | null }}
 */
export function splitTrailingStdoutRedirect(line) {
  const tokens = line.split(/\s+/)
  const redirectIndex = tokens.indexOf('>')
  if (redirectIndex === -1) return { command: line, redirectedTo: null }
  const target = tokens[redirectIndex + 1]
  const supported =
    redirectIndex === tokens.length - 2 && target !== undefined && REDIRECT_TARGET.test(target)
  if (!supported) return { command: line, redirectedTo: null }
  return { command: tokens.slice(0, redirectIndex).join(' '), redirectedTo: target }
}

// Quotes in a documented token must balance within that token: whitespace
// tokenization cannot reassemble a quoted span, so an odd count means the
// shell could not parse the documented command at all (e.g. a dropped closing
// quote) and the gate must reject it instead of substituting the broken token
// with a fixture value (v2.5.15 false positive).
/**
 * @param {string} token
 * @returns {boolean}
 */
function hasUnbalancedQuotes(token) {
  const doubles = (token.match(/"/g) ?? []).length
  const singles = (token.match(/'/g) ?? []).length
  return doubles % 2 !== 0 || singles % 2 !== 0
}

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
    .map((line) => splitTrailingStdoutRedirect(line).command)
}

/**
 * @param {string} command
 * @returns {string[]}
 */
export function tokenizeCommand(command) {
  return command.trim().split(/\s+/)
}

// Parse the documented argv (tokens after `node <script>`) against the real
// verifier CLI contract. Returns ordered flag/value pairs plus human-readable
// problems for anything the gate does not support — every documented command
// is either parsed cleanly or explicitly rejected, never silently skipped.
/**
 * @param {string[]} tokens
 * @returns {{ pairs: [string, string][], problems: string[] }}
 */
export function parseDocumentedArgs(tokens) {
  /** @type {string[]} */
  const problems = []
  /** @type {[string, string][]} */
  const pairs = []
  if (tokens[0] !== 'node') {
    problems.push(`command must invoke node (got ${JSON.stringify(tokens[0] ?? null)})`)
  }
  if (tokens[1] !== VERIFIER_SCRIPT) {
    problems.push(
      `command must invoke ${VERIFIER_SCRIPT} (got ${JSON.stringify(tokens[1] ?? null)})`,
    )
  }
  /** @type {Set<string>} */
  const seen = new Set()
  const args = tokens.slice(2)
  for (let index = 0; index < args.length; index++) {
    const token = args[index]
    if (hasUnbalancedQuotes(token)) {
      problems.push(
        `unbalanced quotes in ${JSON.stringify(token)} (the shell cannot parse the documented command; documented commands are plain argv with per-token balanced quoting)`,
      )
      continue
    }
    if (SHELL_SYNTAX.test(token)) {
      problems.push(
        `unsupported shell syntax in ${JSON.stringify(token)} (documented commands are plain argv: no pipes, lists, redirects or command substitution)`,
      )
      continue
    }
    if (!token.startsWith('--')) {
      problems.push(
        `unexpected positional token ${JSON.stringify(token)} (the real CLI rejects positionals with exit 2; metadata must be passed as --metadata <file>)`,
      )
      continue
    }
    if (!KNOWN_FLAGS.includes(token)) {
      problems.push(`unknown flag ${token} (the real CLI exits 2 on it)`)
      continue
    }
    if (seen.has(token)) {
      problems.push(`duplicate flag ${token}`)
      continue
    }
    const value = args[index + 1]
    if (value === undefined || value.startsWith('--')) {
      problems.push(`missing value for ${token}`)
      continue
    }
    if (hasUnbalancedQuotes(value)) {
      problems.push(
        `unbalanced quotes in value of ${token}: ${JSON.stringify(value)} (the shell cannot parse the documented command)`,
      )
      index++
      continue
    }
    if (SHELL_SYNTAX.test(value)) {
      problems.push(`unsupported shell syntax in value of ${token}: ${JSON.stringify(value)}`)
      index++
      continue
    }
    if (token === '--mode' && value !== 'draft' && value !== 'published') {
      problems.push(
        `--mode must be a bare "draft" or "published" literal (got ${JSON.stringify(value)})`,
      )
      index++
      continue
    }
    if (!FIXTURE_SUBSTITUTED_FLAGS.has(token) && /[$"}{]/.test(value)) {
      problems.push(
        `${token} is not rebuilt against fixture values, so its value must be a bare literal without quotes or template variables (got ${JSON.stringify(value)})`,
      )
      index++
      continue
    }
    seen.add(token)
    pairs.push([token, value])
    index++
  }
  for (const flag of REQUIRED_FLAGS) {
    if (!seen.has(flag)) problems.push(`missing required flag ${flag}`)
  }
  if (!seen.has('--metadata')) {
    problems.push(
      'metadata file must be passed as --metadata <file> (positional form is a usage error)',
    )
  }
  return { pairs, problems }
}

// Validate flag presence, values and argv shape; returns human-readable problems.
/**
 * @param {string[]} tokens
 * @returns {string[]}
 */
export function validateTokens(tokens) {
  return parseDocumentedArgs(tokens).problems
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
 * @param {{ verifierPath?: string }} [options] - explicit verifier entry path;
 *   defaults to the production script resolved from repoRoot. Tests that feed
 *   fixture documentation MUST pass the real script path explicitly so the
 *   child never depends on this process's cwd.
 * @returns {{ ok: boolean, problems: string[], validated: string[], executed: number }}
 */
export function checkReleaseDocsCommands(repoRoot, options = {}) {
  /** @type {string[]} */
  const problems = []
  /** @type {string[]} */
  const validated = []
  const verifierPath = options.verifierPath ?? path.join(repoRoot, VERIFIER_SCRIPT)

  // Source-mode binding: a documented gate command only counts for the source
  // that owns its mode (v2.5.14; the v2.5.13 global per-mode bucket let each
  // source satisfy the other's contract).
  const sources = [
    { file: RELEASING_DOC, expectedMode: 'draft' },
    { file: PAGES_WORKFLOW, expectedMode: 'published' },
  ]
  /** @type {{ source: (typeof sources)[number], command: string, tokens: string[], mode: string }[]} */
  const parsed = []
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
        problems.push(
          `${source.file}: argv contract violated (${tokenProblems.join('; ')})\n  command: ${command}`,
        )
        continue
      }
      const mode = tokens[tokens.indexOf('--mode') + 1]
      if (mode !== source.expectedMode) {
        problems.push(
          `${source.file}: command runs --mode ${mode} but this source requires --mode ${source.expectedMode}\n  command: ${command}`,
        )
        continue
      }
      parsed.push({ source, command, tokens, mode })
    }
    if (!parsed.some((entry) => entry.source === source)) {
      problems.push(`${source.file}: no --mode ${source.expectedMode} verifier invocation found`)
    }
  }
  if (problems.length > 0) return { ok: false, problems, validated, executed: 0 }

  // Real end-to-end execution on offline fixtures, shared per mode so unrelated
  // commands do not rebuild the zip or relaunch python for every negative.
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

  /** @type {Record<string, { dir: string, metadataPath: string }>} */
  const fixtures = {}
  /** @type {string[]} */
  const fixtureDirs = []
  let fixtureFailed = false
  for (const mode of /** @type {const} */ (['draft', 'published'])) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-docs-contract-'))
    fixtureDirs.push(dir)
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
      fixtures[mode] = { dir, metadataPath }
    } catch (error) {
      fixtureFailed = true
      problems.push(
        `${mode} fixture build failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  if (fixtureFailed) {
    for (const dir of fixtureDirs) fs.rmSync(dir, { recursive: true, force: true })
    return { ok: false, problems, validated, executed: 0 }
  }
  // The entry script must exist at the bound path before any run: node itself
  // exits 1 (not a spawn error) on a missing module, which would otherwise be
  // misreported as a verifier failure instead of a repoRoot binding failure.
  if (!fs.existsSync(verifierPath)) {
    for (const dir of fixtureDirs) fs.rmSync(dir, { recursive: true, force: true })
    problems.push(
      `verifier entry script not found: ${verifierPath} (repoRoot binding or options.verifierPath is wrong)`,
    )
    return { ok: false, problems, validated, executed: 0 }
  }

  try {
    // Execute EVERY parsed documented command against the real verifier. Only
    // an actual exit 0 is recorded as execution validated (v2.5.14; the list
    // used to be filled before any run).
    for (const entry of parsed) {
      const fixture = fixtures[entry.mode]
      const rebuilt = rebuildArgv(entry.tokens, {
        tag: fixtureTag,
        repo: fixtureRepo,
        metadataPath: fixture.metadataPath,
        dir: fixture.dir,
      })
      const argv = [process.execPath, verifierPath, ...rebuilt.slice(2)]
      const result = spawnSync(argv[0], argv.slice(1), {
        encoding: 'utf8',
        timeout: 60_000,
        cwd: repoRoot,
      })
      if (result.error !== undefined && result.error !== null) {
        if (/** @type {{code?: string}} */ (result.error).code === 'ETIMEDOUT') {
          problems.push(
            `${entry.source.file}: command timed out after 60s\n  command: ${entry.command}`,
          )
        } else {
          const code = /** @type {{code?: string}} */ (result.error).code
          problems.push(
            `${entry.source.file}: failed to execute verifier entry script ${verifierPath}${code ? ` (${code})` : ''}\n  command: ${entry.command}`,
          )
        }
      } else if (result.signal !== null) {
        problems.push(
          `${entry.source.file}: verifier killed by signal ${result.signal}\n  command: ${entry.command}`,
        )
      } else if (result.status !== 0) {
        problems.push(
          `${entry.source.file}: fixture run exited ${result.status} (expected 0)\n  command: ${entry.command}\n  stderr: ${(result.stderr || '').trim()}`,
        )
      } else {
        validated.push(`${entry.source.file}: ${entry.command}`)
      }
    }

    // Negative contracts against the REAL CLI parser (PR #74 regression): the
    // documented draft command must fail when --metadata is dropped (positional
    // form) or the mode is misspelled.
    const draftEntry = parsed.find((entry) => entry.mode === 'draft')
    if (draftEntry === undefined) {
      problems.push(`${RELEASING_DOC}: no draft command available for negative contracts`)
    } else {
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
        // The draft fixture dir and its metadata file from the positive runs
        // are reused read-only: the verifier never mutates its inputs.
        const mutated = negative.mutate(tokenizeCommand(draftEntry.command))
        const rebuilt = rebuildArgv(mutated, {
          tag: fixtureTag,
          repo: fixtureRepo,
          metadataPath: fixtures.draft.metadataPath,
          dir: fixtures.draft.dir,
        })
        const argv = [process.execPath, verifierPath, ...rebuilt.slice(2)]
        const result = spawnSync(argv[0], argv.slice(1), {
          encoding: 'utf8',
          timeout: 60_000,
          cwd: repoRoot,
        })
        if (result.status !== 2) {
          problems.push(
            `negative "${negative.name}" exited ${result.status} (expected 2)\n  command: ${draftEntry.command}`,
          )
        }
      }
    }
  } finally {
    for (const dir of fixtureDirs) fs.rmSync(dir, { recursive: true, force: true })
  }

  return { ok: problems.length === 0, problems, validated, executed: parsed.length }
}

function main() {
  const report = checkReleaseDocsCommands(repoRootFromScript(import.meta.url))
  if (!report.ok) {
    for (const problem of report.problems) {
      process.stderr.write(`release-docs-contract: FAIL ${problem}\n`)
    }
    process.exitCode = 1
    return
  }
  for (const entry of report.validated) {
    process.stdout.write(`release-docs-contract: validated ${entry}\n`)
  }
  process.stdout.write(
    `release-docs-contract: OK (${report.executed} documented command(s) executed against the real verifier CLI; sources bound to their modes)\n`,
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
