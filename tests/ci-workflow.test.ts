// Regression tests for .github/workflows/ci.yml structure (M19-A).
//
// These assertions pin the CI contract that GitHub expressions cannot check
// for themselves: stable step ids for the Playwright steps, per-step report
// upload gating, the shared full-tier condition, the single `check` job, no
// workflow-level path filters, and the M18 concurrency semantics. Parsing is
// deliberately dependency-free text-structure matching over step blocks —
// good enough to pin these invariants without adding a YAML dependency.

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

  it('keeps the M18 concurrency semantics: per-PR groups, main never cancels', () => {
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

describe('ci.yml full-tier gating', () => {
  it.each(FULL_TIER_RUN_COMMANDS)(
    'gates "%s" behind the shared full-tier condition',
    (runCommand) => {
      const block = findStepByRun(runCommand)
      expect(normalize(block)).toContain(`if: ${FULL_TIER_CONDITION}`)
    },
  )
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
