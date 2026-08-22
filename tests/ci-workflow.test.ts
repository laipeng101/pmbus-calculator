// Regression tests for .github/workflows/ci.yml structure (M19-A/M19-B/M20).
//
// These assertions pin the CI contract that GitHub expressions cannot check
// for themselves: stable step ids for the Playwright steps, per-step report
// upload gating, the shared full-tier condition, the single `check` job, no
// workflow-level path filters, the M18 concurrency semantics, the M19-B
// protected-main trigger model (PR + workflow_dispatch only, minimal token
// permissions, credential-free checkout of the PR merge ref, and recorded
// revision/tree evidence), and the M20 secondary-LTS compatibility check
// (Node 22 primary verification plus a full-tier-gated Node 24 unit run in
// the same job). Parsing is deliberately dependency-free text-structure
// matching over step blocks — good enough to pin these invariants without
// adding a YAML dependency.

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'

// vitest (jsdom environment) does not expose import.meta.url as a file://
// URL, so resolve from the repository root instead.
const workflowPath = path.resolve(process.cwd(), '.github/workflows/ci.yml')
const workflow = fs.readFileSync(workflowPath, 'utf8')

// Step list items start at exactly 6 spaces ("- name:" / "- uses:").
function stepBlocks(source: string): string[] {
  return source.split(/^ {6}- /m).slice(1)
}

function normalize(block: string): string {
  return block.replace(/\s+/g, ' ').trim()
}

function findStepByName(name: string): string {
  const match = stepBlocks(workflow).find(
    (block) =>
      normalize(block).startsWith(`name: ${name} `) || normalize(block) === `name: ${name}`,
  )
  if (!match) throw new Error(`workflow step not found: ${name}`)
  return match
}

function findStepByRun(runCommand: string): string {
  const pattern = new RegExp(
    `^ {8}run: ${runCommand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`,
    'm',
  )
  const match = stepBlocks(workflow).find((block) => pattern.test(block))
  if (!match) throw new Error(`workflow step with run "${runCommand}" not found`)
  return match
}

function findUploadStep(artifactName: string): string {
  const pattern = new RegExp(`^ {10}name: ${artifactName}\\s*$`, 'm')
  const match = stepBlocks(workflow).find(
    (block) => block.includes('actions/upload-artifact') && pattern.test(block),
  )
  if (!match) throw new Error(`upload-artifact step for "${artifactName}" not found`)
  return match
}

function stepId(block: string): string | undefined {
  return block.match(/^ {8}id: ([\w-]+)\s*$/m)?.[1]
}

const FULL_TIER_CONDITION = "steps.scope.outputs.run_full != 'false'"

// Every heavy gate must stay behind the one shared full-tier condition.
const FULL_TIER_RUN_COMMANDS = [
  'npm run specs:check',
  'npm run typecheck',
  'npm run lint',
  'npm run test:coverage',
  'npx playwright install --with-deps chromium',
  'npm run test:e2e',
  'npm run build',
  'npm run check:tailwind-scope',
  'npm run test:e2e:release',
  'npm audit --audit-level=high',
  'npm ci && npm run test:run',
]

describe('ci.yml structure', () => {
  it('keeps a single job with id check', () => {
    const jobsSection = workflow.split(/^jobs:\s*$/m)[1] ?? ''
    const jobIds = [...jobsSection.matchAll(/^ {2}([\w-]+):/gm)].map((match) => match[1])
    expect(jobIds).toEqual(['check'])
  })

  it('never uses workflow-level paths or paths-ignore filters', () => {
    expect(workflow).not.toMatch(/^\s*paths:/m)
    expect(workflow).not.toMatch(/^\s*paths-ignore:/m)
  })

  it('keeps the M18 concurrency semantics: PR-only cancellation, manual runs never cancelled', () => {
    // Per-PR groups keep different PRs independent; a workflow_dispatch run
    // groups by ref (never a PR number) and cancel-in-progress is PR-only.
    expect(workflow).toContain(
      'group: ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}',
    )
    expect(workflow).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}")
  })

  it('keeps the Classify CI scope step as the single run_full source', () => {
    expect(workflow).toMatch(/^ {8}id: scope\s*$/m)
    expect(workflow).toMatch(/^ {8}run: node scripts\/classify-ci-scope\.mjs /m)
  })
})

describe('ci.yml trigger and permission model (M19-B)', () => {
  it('auto-triggers only on pull requests targeting main', () => {
    expect(workflow).toMatch(/^on:\n {2}pull_request:\n {4}branches: \[main\]\n/m)
  })

  it('supports manual workflow_dispatch', () => {
    expect(workflow).toMatch(/^ {2}workflow_dispatch:\s*$/m)
  })

  it('no longer triggers on main pushes', () => {
    expect(workflow).not.toMatch(/^ {2}push:/m)
  })

  it('has no merge_group trigger', () => {
    expect(workflow).not.toMatch(/^ {2}merge_group:/m)
  })

  it('grants the workflow token only contents: read', () => {
    expect(workflow).toMatch(/^permissions:\n {2}contents: read\n/m)
  })
})

describe('ci.yml checkout and revision evidence (M19-B)', () => {
  function checkoutStep(): string {
    const match = stepBlocks(workflow).find((block) => block.includes('actions/checkout'))
    if (!match) throw new Error('actions/checkout step not found')
    return match
  }

  it('checks out full history without persisting credentials', () => {
    const checkout = checkoutStep()
    expect(checkout).toContain('fetch-depth: 0')
    expect(checkout).toContain('persist-credentials: false')
  })

  it('does not override the checkout ref, keeping the PR merge-ref semantics', () => {
    expect(checkoutStep()).not.toMatch(/^\s*ref:/m)
  })

  it('records the checked commit and tree under the stable id revision', () => {
    const normalized = normalize(findStepByName('Record checked revision'))
    expect(stepId(findStepByName('Record checked revision'))).toBe('revision')
    expect(normalized).toContain('checked_sha="$(git rev-parse HEAD)"')
    expect(normalized).toContain('checked_tree="$(git rev-parse \'HEAD^{tree}\')"')
  })

  it('validates 40-hex SHAs before writing outputs and fails hard otherwise', () => {
    const normalized = normalize(findStepByName('Record checked revision'))
    expect(normalized).toContain('set -euo pipefail')
    expect(normalized).toContain('^[0-9a-f]{40}$')
    expect(normalized).toContain('exit 1')
    // Outputs are written only after the SHA validation guard.
    expect(normalized.indexOf('^[0-9a-f]{40}$')).toBeLessThan(
      normalized.indexOf('>> "$GITHUB_OUTPUT"'),
    )
  })

  it('writes only the two controlled outputs and also logs a step summary', () => {
    const normalized = normalize(findStepByName('Record checked revision'))
    expect(normalized).toContain('checked_sha=$checked_sha')
    expect(normalized).toContain('checked_tree=$checked_tree')
    expect(normalized).toContain('>> "$GITHUB_STEP_SUMMARY"')
    expect(normalized.match(/>> "\$GITHUB_OUTPUT"/g)).toHaveLength(1)
  })
})

describe('ci.yml whitespace gates (M19-B)', () => {
  it('keeps the full PR base-to-head whitespace gate', () => {
    const normalized = normalize(findStepByName('Check full PR diff for whitespace errors'))
    expect(normalized).toContain('git diff --check "$BASE_SHA" "$HEAD_SHA"')
    expect(normalized).toContain('github.event.pull_request.base.sha')
    expect(normalized).toContain('github.event.pull_request.head.sha')
  })

  it('no longer contains the unreachable push whitespace step', () => {
    const stepPresent = stepBlocks(workflow).some((block) =>
      normalize(block).startsWith('name: Check full pushed range'),
    )
    expect(stepPresent).toBe(false)
    expect(workflow).not.toContain('BEFORE_SHA')
  })
})

describe('ci.yml full-tier gating', () => {
  it.each(FULL_TIER_RUN_COMMANDS)(
    'gates "%s" behind the shared full-tier condition',
    (runCommand) => {
      const block = findStepByRun(runCommand)
      expect(normalize(block)).toContain(`if: ${FULL_TIER_CONDITION}`)
    },
  )
})

describe('ci.yml secondary LTS compatibility (M20)', () => {
  function setupNodeSteps(): string[] {
    return stepBlocks(workflow).filter((block) => block.includes('actions/setup-node'))
  }

  function findSetupStepByVersion(version: number): string {
    const match = setupNodeSteps().find((block) => block.includes(`node-version: ${version}`))
    if (!match) throw new Error(`setup-node step for Node ${version} not found`)
    return match
  }

  it('keeps primary verification on Node 22', () => {
    expect(normalize(findSetupStepByVersion(22))).not.toContain(`if: ${FULL_TIER_CONDITION}`)
  })

  it('adds a Node 24 compatibility setup behind the shared full-tier condition', () => {
    const normalized = normalize(findSetupStepByVersion(24))
    expect(normalized).toContain(`if: ${FULL_TIER_CONDITION}`)
  })

  it('pins both setup-node steps to the same reviewed SHA', () => {
    const shas = setupNodeSteps().map(
      (block) => block.match(/actions\/setup-node@([0-9a-f]{40})/)?.[1],
    )
    expect(shas).toHaveLength(2)
    expect(new Set(shas).size).toBe(1)
  })

  it('runs the unit suite under Node 24 in the same single check job', () => {
    // The combined command is unique: the primary "Install dependencies"
    // step runs a bare `npm ci` and must stay available on the light tier.
    const normalized = normalize(findStepByRun('npm ci && npm run test:run'))
    expect(normalized).toContain(`if: ${FULL_TIER_CONDITION}`)
    expect(normalize(findStepByName('Unit tests on secondary LTS (Node 24)'))).toBe(normalized)
  })
})

describe('ci.yml Playwright report upload gating (M19-A)', () => {
  it('gives the Playwright E2E step the stable id e2e', () => {
    expect(stepId(findStepByName('Run Playwright E2E'))).toBe('e2e')
    expect(stepId(findStepByRun('npm run test:e2e'))).toBe('e2e')
  })

  it('gives the release smoke step the stable id release_smoke', () => {
    expect(stepId(findStepByName('Run production release smoke'))).toBe('release_smoke')
    expect(stepId(findStepByRun('npm run test:e2e:release'))).toBe('release_smoke')
  })

  it('uploads the main report only when the E2E step itself ran and failed', () => {
    const normalized = normalize(findUploadStep('playwright-report'))
    expect(normalized).toContain('failure() &&')
    expect(normalized).toContain(`${FULL_TIER_CONDITION} &&`)
    expect(normalized).toContain("steps.e2e.outcome == 'failure'")
    expect(normalized).not.toContain('release_smoke')
    // Artifact name and report directory stay stable.
    expect(normalized).toContain('name: playwright-report ')
    expect(normalized).toContain('path: tests/e2e/report ')
  })

  it('uploads the release report only when the release smoke step itself ran and failed', () => {
    const normalized = normalize(findUploadStep('playwright-report-release'))
    expect(normalized).toContain('failure() &&')
    expect(normalized).toContain(`${FULL_TIER_CONDITION} &&`)
    expect(normalized).toContain("steps.release_smoke.outcome == 'failure'")
    expect(normalized).not.toContain('steps.e2e.outcome')
    // Artifact name and report directory stay stable.
    expect(normalized).toContain('name: playwright-report-release ')
    expect(normalized).toContain('path: tests/e2e/report-release ')
  })
})
