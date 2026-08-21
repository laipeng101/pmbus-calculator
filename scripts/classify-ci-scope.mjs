// Gate: cost-aware CI scope classification (M18).
//
// Single source of truth for the light-only allowlist: .github/workflows/ci.yml
// must not keep a second copy of these rules — it only consumes the `run_full`
// output written by this script.
//
// Fail-closed contract — the answer is `light` ONLY when every changed path
// matches the allowlist below. Anything else is `full`:
//   empty change set / missing or invalid SHA / all-zero push `before` /
//   git diff failure / unrecognized event / any unknown path / mixed changes.
// The classifier itself, tests, workflow, config, and dependency files are not
// in the allowlist, so touching them always classifies as full.
//
// Changed paths never enter $GITHUB_OUTPUT (constant keys with constant or
// numeric values only); they are printed to the step log. $GITHUB_OUTPUT
// receives exactly: tier, run_full, changed_count, reason.
//
// Diff semantics: PR uses merge-base (`base...head`); push uses
// (`before..sha`). `--no-renames -z` keeps both sides of a rename so moving a
// production file into docs/ still classifies as full.
//
// If a light path ever becomes an input to Vite, Tailwind, tests, a generator,
// or the product runtime, it MUST be moved out of the allowlist in the same PR.

import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// Exact repo-root-relative light-only paths (as git reports them, POSIX style).
const LIGHT_EXACT_PATHS = new Set([
  'AGENTS.md',
  'CHANGELOG.md',
  'CLAUDE.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'README.md',
  'README_zh-CN.md',
  'THIRD_PARTY_NOTICES.md',
  '.gitignore',
  'document/README.md',
  '.github/pull_request_template.md',
])

// Directory prefixes whose entire subtree is light-only.
const LIGHT_DIRECTORY_PREFIXES = ['docs/', '.github/ISSUE_TEMPLATE/']

const SHA_PATTERN = /^[0-9a-f]{40}$/i
const ALL_ZERO_SHA = '0'.repeat(40)
const MAX_LOGGED_PATHS = 200

function fullResult(reason, paths) {
  return {
    tier: 'full',
    runFull: true,
    changedCount: paths.length,
    lightCount: 0,
    fullCount: paths.length,
    reason,
    paths,
  }
}

export function repoRootFromScript(importMetaUrl) {
  return path.resolve(path.dirname(fileURLToPath(importMetaUrl)), '..')
}

export function isValidSha(value) {
  return typeof value === 'string' && SHA_PATTERN.test(value)
}

// A path is light only on an exact allowlist hit or a light directory prefix.
// Control characters can never be trusted to stay on one output line, so any
// path containing them is treated as unknown (full), never light.
export function isLightPath(changedPath) {
  if (typeof changedPath !== 'string' || changedPath.length === 0) return false
  if (/[\u0000-\u001f\u007f]/.test(changedPath)) return false
  if (LIGHT_EXACT_PATHS.has(changedPath)) return true
  return LIGHT_DIRECTORY_PREFIXES.some((prefix) => changedPath.startsWith(prefix))
}

// Pure classification over a changed-path list. Reasons interpolate counts
// (digits) only — never path text — so they stay safe for $GITHUB_OUTPUT.
export function classifyPaths(changedPaths) {
  if (!Array.isArray(changedPaths) || changedPaths.length === 0) {
    return fullResult('empty change set — fail closed to full', [])
  }

  const lightPaths = []
  const fullPaths = []
  for (const changedPath of changedPaths) {
    if (isLightPath(changedPath)) {
      lightPaths.push(changedPath)
    } else {
      fullPaths.push(changedPath)
    }
  }

  if (fullPaths.length > 0) {
    return {
      tier: 'full',
      runFull: true,
      changedCount: changedPaths.length,
      lightCount: lightPaths.length,
      fullCount: fullPaths.length,
      reason: `${fullPaths.length} of ${changedPaths.length} changed path(s) outside the light-only allowlist`,
      paths: changedPaths,
    }
  }

  return {
    tier: 'light',
    runFull: false,
    changedCount: changedPaths.length,
    lightCount: lightPaths.length,
    fullCount: 0,
    reason: `all ${changedPaths.length} changed path(s) match the light-only allowlist`,
    paths: changedPaths,
  }
}

// Merge-base range for PRs (`base...head`), before..sha range for pushes.
export function buildDiffArgs(event, baseSha, headSha) {
  const range = event === 'pull_request' ? `${baseSha}...${headSha}` : `${baseSha}..${headSha}`
  return ['diff', '--name-only', '--no-renames', '-z', range]
}

// Orchestrates one classification: validate inputs, run git without a shell,
// then classify. Every failure path degrades to full instead of throwing, so
// a later `run_full != 'false'` condition in the workflow stays fail-closed.
export function classifyCiScope({
  event,
  baseSha,
  headSha,
  cwd = process.cwd(),
  spawnSyncImpl = spawnSync,
}) {
  if (event !== 'pull_request' && event !== 'push') {
    return fullResult('unrecognized event name — fail closed to full', [])
  }
  if (!isValidSha(baseSha) || !isValidSha(headSha)) {
    return fullResult('missing or invalid base/head SHA — fail closed to full', [])
  }
  if (event === 'push' && baseSha.toLowerCase() === ALL_ZERO_SHA) {
    return fullResult('push event.before is the all-zero SHA — fail closed to full', [])
  }

  const git = spawnSyncImpl('git', buildDiffArgs(event, baseSha, headSha), {
    cwd,
    encoding: 'utf8',
  })
  if (!git || git.error || git.status !== 0) {
    return fullResult('git diff failed — fail closed to full', [])
  }

  const changedPaths = git.stdout.split('\0').filter((entry) => entry.length > 0)
  return classifyPaths(changedPaths)
}

// Constant keys; values are controlled constants or digits. Never includes
// changed paths, so hostile file names (newlines, '=', '%') cannot inject
// extra GitHub outputs.
export function formatGithubOutput(result) {
  return [
    `tier=${result.tier}`,
    `run_full=${result.runFull ? 'true' : 'false'}`,
    `changed_count=${result.changedCount}`,
    `reason=${result.reason}`,
    '',
  ].join('\n')
}

function writeLog(result) {
  process.stdout.write(
    `ci-scope: tier=${result.tier} run_full=${result.runFull} ` +
      `changed_count=${result.changedCount} (${result.reason})\n`,
  )
  const logged = result.paths.slice(0, MAX_LOGGED_PATHS)
  for (const changedPath of logged) {
    process.stdout.write(`ci-scope: changed ${changedPath}\n`)
  }
  if (result.paths.length > logged.length) {
    process.stdout.write(`ci-scope: ...and ${result.paths.length - logged.length} more path(s)\n`)
  }
}

function usage() {
  process.stderr.write(
    'classify-ci-scope.mjs — classify a CI run as light or full (fail closed)\n\n' +
      'Usage:\n' +
      '  node scripts/classify-ci-scope.mjs --event pull_request --base-sha <sha> --head-sha <sha>\n' +
      '  node scripts/classify-ci-scope.mjs --event push --base-sha <before-sha> --head-sha <sha>\n' +
      '\n' +
      'Writes tier/run_full/changed_count/reason to $GITHUB_OUTPUT when set.\n',
  )
}

const ARG_KEYS = ['event', 'base-sha', 'head-sha']

function parseArgs(argv) {
  if (argv.length === 0 || argv.length % 2 !== 0) return null
  const parsed = {}
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index].replace(/^--/, '')
    if (!ARG_KEYS.includes(key)) return null
    parsed[key] = argv[index + 1]
  }
  return parsed
}

function main() {
  const parsed = parseArgs(process.argv.slice(2))
  if (!parsed) {
    usage()
    process.exitCode = 2
    return
  }

  const result = classifyCiScope({
    event: parsed.event,
    baseSha: parsed['base-sha'],
    headSha: parsed['head-sha'],
    cwd: repoRootFromScript(import.meta.url),
  })

  writeLog(result)

  const githubOutput = process.env.GITHUB_OUTPUT
  if (githubOutput) {
    fs.appendFileSync(githubOutput, formatGithubOutput(result), 'utf8')
  }
  // Classification-level problems already degraded to full; keep exit 0 so the
  // job proceeds with the full tier instead of dying without outputs.
  process.exitCode = 0
}

const isDirectRun =
  typeof process.argv[1] === 'string' &&
  process.argv[1].length > 0 &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])

if (isDirectRun) {
  main()
}
