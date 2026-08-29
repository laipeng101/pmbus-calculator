// Regression tests for .github/workflows/ci.yml structure.
//
// These assertions pin the CI contract that GitHub expressions cannot check
// for themselves: the parallel job layout (quality / e2e / compatibility /
// check), the shared full-tier condition, the light-only classifier, stable
// step ids for the Playwright steps, per-step report upload gating, the
// protected-main trigger model (PR + workflow_dispatch only, minimal token
// permissions, credential-free checkout of the PR merge ref), the recorded
// revision/tree evidence in the aggregator, the fail-closed aggregator gate
// (always() + strict success on every needs result), and the compatibility
// Node 22.20.0 typecheck+unit job. Parsing is deliberately dependency-free
// text-structure matching over step blocks — good enough to pin these
// invariants without adding a YAML dependency.

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
  'npm run check:release-contract',
  'npm run typecheck',
  'npm run lint',
  'npm run test:coverage',
  'npx playwright install --with-deps chromium',
  'npm run test:e2e',
  'npm run build',
  'npm run check:tailwind-scope',
  'npm run test:e2e:release',
  'npm audit --audit-level=high',
  'npm ci && npm run typecheck && npm run test:run',
]

describe('ci.yml structure', () => {
  it('keeps the four parallel jobs with the aggregator named check', () => {
    const jobsSection = workflow.split(/^jobs:\s*$/m)[1] ?? ''
    const jobIds = [...jobsSection.matchAll(/^ {2}([\w-]+):/gm)].map((match) => match[1])
    expect(jobIds).toEqual(['quality', 'e2e', 'compatibility', 'check'])
  })

  it('the check aggregator depends on all three parallel jobs', () => {
    const checkSection = workflow.split(/^ {2}check:/m)[1] ?? ''
    expect(checkSection).toMatch(/^ {4}needs: \[quality, e2e, compatibility\]\s*$/m)
  })

  it('never uses workflow-level paths or paths-ignore filters', () => {
    expect(workflow).not.toMatch(/^\s*paths:/m)
    expect(workflow).not.toMatch(/^\s*paths-ignore:/m)
  })

  it('keeps the PR-only cancellation and manual runs never cancelled', () => {
    expect(workflow).toContain(
      'group: ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}',
    )
    expect(workflow).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}")
  })

  it('keeps the Classify CI scope step as the single run_full source in every gated job', () => {
    const scopeSteps = stepBlocks(workflow).filter((block) => stepId(block) === 'scope')
    expect(scopeSteps.length).toBe(3) // quality, e2e, compatibility
    for (const block of scopeSteps) {
      expect(block).toMatch(/^ {8}run: node scripts\/classify-ci-scope\.mjs /m)
    }
  })

  it('no longer contains the release-security runner step', () => {
    expect(workflow).not.toMatch(/test:release-security/)
    expect(workflow).not.toMatch(/security-diagnostics/)
  })
})

describe('ci.yml fail-closed aggregator gate', () => {
  function checkSection(): string {
    return workflow.split(/^ {2}check:/m)[1] ?? ''
  }

  function gateStep(): string {
    return findStepByName('Require successful parallel verification results')
  }

  it('runs the check aggregator even when an upstream job fails', () => {
    // Without job-level always(), GitHub skips the whole job when a needs
    // dependency fails and treats the skipped required check as green.
    expect(checkSection()).toMatch(/^ {4}if: \$\{\{ always\(\) \}\}\s*$/m)
  })

  it('keeps the aggregator dependent on all three verification jobs', () => {
    expect(checkSection()).toMatch(/^ {4}needs: \[quality, e2e, compatibility\]\s*$/m)
  })

  it('reads the result of every dependency into the gate environment', () => {
    const normalized = normalize(gateStep())
    expect(normalized).toContain('QUALITY_RESULT: ${{ needs.quality.result }}')
    expect(normalized).toContain('E2E_RESULT: ${{ needs.e2e.result }}')
    expect(normalized).toContain('COMPATIBILITY_RESULT: ${{ needs.compatibility.result }}')
  })

  it('requires every result to equal success exactly', () => {
    const normalized = normalize(gateStep())
    expect(normalized).toContain('for result in')
    expect(normalized).toContain('"$QUALITY_RESULT"')
    expect(normalized).toContain('"$E2E_RESULT"')
    expect(normalized).toContain('"$COMPATIBILITY_RESULT"')
    expect(normalized).toContain('if [[ "$result" != "success" ]]; then')
  })

  it('fails hard with a non-zero exit when any result is not success', () => {
    const normalized = normalize(gateStep())
    expect(normalized).toContain('set -euo pipefail')
    expect(normalized).toContain('A required verification job did not succeed.')
    expect(normalized).toContain('exit 1')
    expect(normalized).not.toContain('continue-on-error')
  })

  it('does not regress to a print-only summary step', () => {
    expect(() => findStepByName('Summarize parallel verification results')).toThrow()
  })
})

describe('ci.yml trigger and permission model', () => {
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

describe('ci.yml checkout and revision evidence', () => {
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

describe('ci.yml whitespace gates', () => {
  it('keeps the full PR base-to-head whitespace gate in the aggregator job', () => {
    const normalized = normalize(findStepByName('Check full PR diff for whitespace errors'))
    expect(normalized).toContain('git diff --check "$BASE_SHA" "$HEAD_SHA"')
    expect(normalized).toContain('github.event.pull_request.base.sha')
    expect(normalized).toContain('github.event.pull_request.head.sha')
    // The gate lives inside the `check` job section, not a parallel job.
    const checkSection = workflow.split(/^ {2}check:/m)[1] ?? ''
    expect(checkSection).toContain('Check full PR diff for whitespace errors')
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

describe('ci.yml canonical/compatibility runtimes', () => {
  function setupNodeSteps(): string[] {
    return stepBlocks(workflow).filter((block) => block.includes('actions/setup-node'))
  }

  function findSetupStepByNodeVersion(version: string): string {
    const match = setupNodeSteps().find((block) => block.includes(`node-version: '${version}`))
    if (!match) throw new Error(`setup-node step for Node ${version} not found`)
    return match
  }

  it('keeps primary verification on .node-version (canonical Node 24.19.0, no full-tier gate)', () => {
    const primary = setupNodeSteps().find((block) => block.includes('node-version-file'))
    expect(primary).toBeDefined()
    expect(normalize(primary!)).not.toContain(`if: ${FULL_TIER_CONDITION}`)
    expect(primary).toMatch(/node-version-file:\s*['"]?\.node-version['"]?/)
  })

  it('adds the exact 22.20.0 compatibility setup (job-level, no second npm cache)', () => {
    const block = findSetupStepByNodeVersion('22.20.0')
    expect(block).toContain('package-manager-cache: false')
    expect(block).not.toMatch(/^\s*cache: 'npm'\s*$/m)
    expect(block).not.toMatch(/^\s*cache-dependency-path:/m)
  })

  it('pins all setup-node steps to the same reviewed SHA', () => {
    const shas = setupNodeSteps().map(
      (block) => block.match(/actions\/setup-node@([0-9a-f]{40})/)?.[1],
    )
    expect(shas).toHaveLength(3) // quality, e2e, compatibility
    expect(new Set(shas).size).toBe(1)
  })

  it('runs the real typecheck and unit suite under Node 22.20.0 in the compatibility job', () => {
    const normalized = normalize(findStepByRun('npm ci && npm run typecheck && npm run test:run'))
    expect(normalized).toContain(`if: ${FULL_TIER_CONDITION}`)
    expect(
      normalize(findStepByName('Typecheck and unit tests on compatibility LTS (Node 22.20.0)')),
    ).toBe(normalized)
    const compatSection = workflow.split(/^ {2}compatibility:/m)[1] ?? ''
    expect(compatSection).toContain('Typecheck and unit tests on compatibility LTS')
  })

  it('activates the exact canonical npm 11.17.0 for the compatibility runtime', () => {
    const activate = findStepByName('Activate canonical npm 11.17.0 on compatibility runtime')
    expect(normalize(activate)).toContain(`if: ${FULL_TIER_CONDITION}`)
    expect(normalize(activate)).toMatch(/npm install -g npm@11\.17\.0/)
    expect(normalize(activate)).toMatch(/cd \/tmp/)
  })
})

describe('ci.yml Playwright report upload gating', () => {
  it('gives the Playwright E2E step the stable id e2e', () => {
    expect(stepId(findStepByName('Run Playwright E2E'))).toBe('e2e')
    expect(stepId(findStepByRun('npm run test:e2e'))).toBe('e2e')
  })

  it('gives the release smoke step the stable id release_smoke', () => {
    expect(stepId(findStepByName('Run production release smoke'))).toBe('release_smoke')
    expect(stepId(findStepByRun('npm run test:e2e:release'))).toBe('release_smoke')
  })

  it('gives the v2.5.13 mobile-contract step the stable id e2e_mobile behind the full tier', () => {
    expect(stepId(findStepByName('Run Playwright mobile contract E2E'))).toBe('e2e_mobile')
    const block = findStepByRun('npm run test:e2e:mobile')
    expect(stepId(block)).toBe('e2e_mobile')
    expect(normalize(block)).toContain(`if: ${FULL_TIER_CONDITION}`)
  })

  it('keeps Playwright steps in the e2e job', () => {
    const e2eSection = workflow.split(/^ {2}e2e:/m)[1] ?? ''
    expect(e2eSection).toContain('Run Playwright E2E')
    expect(e2eSection).toContain('Run Playwright mobile contract E2E')
    expect(e2eSection).toContain('Run production release smoke')
  })

  it('uploads the main report only when the E2E step itself ran and failed', () => {
    const normalized = normalize(findUploadStep('playwright-report'))
    expect(normalized).toContain('failure() &&')
    expect(normalized).toContain(`${FULL_TIER_CONDITION} &&`)
    expect(normalized).toContain("steps.e2e.outcome == 'failure'")
    expect(normalized).not.toContain('release_smoke')
    expect(normalized).toContain('name: playwright-report ')
    expect(normalized).toContain('path: tests/e2e/report ')
  })

  it('uploads the release report only when the release smoke step itself ran and failed', () => {
    const normalized = normalize(findUploadStep('playwright-report-release'))
    expect(normalized).toContain('failure() &&')
    expect(normalized).toContain(`${FULL_TIER_CONDITION} &&`)
    expect(normalized).toContain("steps.release_smoke.outcome == 'failure'")
    expect(normalized).not.toContain('steps.e2e.outcome')
    expect(normalized).toContain('name: playwright-report-release ')
    expect(normalized).toContain('path: tests/e2e/report-release ')
  })

  it('uploads the mobile contract report only when that step itself ran and failed', () => {
    const normalized = normalize(findUploadStep('playwright-report-mobile'))
    expect(normalized).toContain('failure() &&')
    expect(normalized).toContain(`${FULL_TIER_CONDITION} &&`)
    expect(normalized).toContain("steps.e2e_mobile.outcome == 'failure'")
    expect(normalized).not.toContain('steps.e2e.outcome')
    expect(normalized).not.toContain('steps.release_smoke.outcome')
    expect(normalized).toContain('name: playwright-report-mobile ')
    expect(normalized).toContain('path: tests/e2e/report-mobile ')
  })
})
