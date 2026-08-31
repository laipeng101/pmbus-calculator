// Regression tests for .github/workflows/pages.yml structure.
//
// The Pages workflow deploys immutable GitHub Release assets. These
// assertions pin the source-binding contract that GitHub expressions cannot
// check for themselves: a manual workflow_dispatch run must originate from
// the exact tag ref it claims to deploy, tag resolution and SemVer
// validation happen before any repository source is checked out, the
// checkout ref is the resolved tag, and the checked-out HEAD must equal the
// peeled annotated tag commit so every verifier script always runs from the
// deployed tag's tree. Parsing is deliberately dependency-free
// text-structure matching over step blocks (same style as ci-workflow.test.ts).

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'

// vitest (jsdom environment) does not expose import.meta.url as a file://
// URL, so resolve from the repository root instead.
const workflowPath = path.resolve(process.cwd(), '.github/workflows/pages.yml')
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

function stepIndexByName(name: string): number {
  const index = stepBlocks(workflow).findIndex(
    (block) =>
      normalize(block).startsWith(`name: ${name} `) || normalize(block) === `name: ${name}`,
  )
  if (index < 0) throw new Error(`workflow step not found: ${name}`)
  return index
}

describe('pages.yml trigger model', () => {
  it('deploys on release published and manual dispatch with a release_tag input', () => {
    expect(workflow).toMatch(/^on:\n {2}release:\n {4}types: \[published\]\n/m)
    expect(workflow).toMatch(/^ {2}workflow_dispatch:\n {4}inputs:\n {6}release_tag:\n/m)
  })

  it('keeps the deployment token permissions minimal', () => {
    expect(workflow).toMatch(
      /^permissions:\n {2}contents: read\n {2}pages: write\n {2}id-token: write\n/m,
    )
  })

  it('keeps the github-pages environment and a real post-deploy smoke', () => {
    expect(workflow).toMatch(/^ {4}environment:\n {6}name: github-pages\n/m)
    expect(normalize(findStepByName('Run remote deployment smoke'))).toContain(
      'run: npm run test:e2e:deployment',
    )
  })
})

describe('pages.yml manual dispatch source binding', () => {
  it('resolves the release event tag from the event payload', () => {
    const resolve = normalize(findStepByName('Resolve release tag'))
    expect(resolve).toContain('if [ "$EVENT_NAME" = "release" ]; then')
    expect(resolve).toContain('echo "tag=${RELEASE_TAG}"')
  })

  it('runs manual dispatches only from the exact tag ref they claim to deploy', () => {
    const resolve = normalize(findStepByName('Resolve release tag'))
    expect(resolve).toContain('REF_TYPE: ${{ github.ref_type }}')
    expect(resolve).toContain('REF_NAME: ${{ github.ref_name }}')
    // A run started on main, any branch, or a different tag can never inject
    // another tag: both guards fail hard before the output is written.
    expect(resolve).toContain('if [ "$REF_TYPE" != "tag" ]; then')
    expect(resolve).toContain('if [ "$REF_NAME" != "$INPUT_RELEASE_TAG" ]; then')
    expect(resolve).toContain('exit 1')
    const lastGuard = Math.max(
      resolve.indexOf('if [ "$REF_TYPE" != "tag" ]; then'),
      resolve.indexOf('if [ "$REF_NAME" != "$INPUT_RELEASE_TAG" ]; then'),
    )
    expect(lastGuard).toBeGreaterThanOrEqual(0)
    const dispatchOutputWrite = resolve.indexOf(
      'echo "tag=${INPUT_RELEASE_TAG}" >> "$GITHUB_OUTPUT"',
    )
    expect(dispatchOutputWrite).toBeGreaterThan(lastGuard)
  })
})

describe('pages.yml checkout binding', () => {
  it('resolves the tag and validates SemVer before any repository source is checked out', () => {
    const resolveIndex = stepIndexByName('Resolve release tag')
    const semverIndex = stepIndexByName('Validate stable SemVer tag format')
    const checkoutIndex = stepIndexByName('Checkout repository')
    expect(resolveIndex).toBeGreaterThanOrEqual(0)
    expect(semverIndex).toBeGreaterThan(resolveIndex)
    expect(checkoutIndex).toBeGreaterThan(semverIndex)
    // The pre-checkout steps must not depend on repository source: they are
    // pure shell (no node/npm invocation of repo scripts).
    for (const name of ['Resolve release tag', 'Validate stable SemVer tag format']) {
      expect(normalize(findStepByName(name))).not.toMatch(/run: (node|npm) /)
    }
  })

  it('keeps the stable SemVer tag restriction', () => {
    const semver = normalize(findStepByName('Validate stable SemVer tag format'))
    expect(semver).toContain('^v[1-9][0-9]*\\.[0-9]+\\.[0-9]+$')
    expect(semver).toContain('exit 1')
  })

  it('checks out the resolved tag without persisting credentials', () => {
    const checkout = normalize(findStepByName('Checkout repository'))
    expect(checkout).toContain('ref: ${{ steps.resolve.outputs.tag }}')
    expect(checkout).toContain('persist-credentials: false')
  })
})

describe('pages.yml post-checkout tag verification', () => {
  it('verifies the checked-out HEAD against the annotated tag', () => {
    const step = normalize(findStepByName('Verify checkout matches the resolved tag'))
    expect(step).toContain('set -euo pipefail')
    expect(step).toContain('git cat-file -t')
    expect(step).toContain('!= "tag"')
    expect(step).toContain('^{commit}')
    expect(step).toContain('^[0-9a-f]{40}$')
    expect(step).toContain('git rev-parse HEAD')
    expect(step).toContain('exit 1')
    // The HEAD equality gate must run before anything consumes the checkout.
    const verifyIndex = stepIndexByName('Verify checkout matches the resolved tag')
    expect(verifyIndex).toBeGreaterThan(stepIndexByName('Checkout repository'))
    expect(verifyIndex).toBeLessThan(stepIndexByName('Setup Node.js'))
  })

  it('checks the release metadata tag_name against the resolved tag', () => {
    const step = normalize(findStepByName('Verify GitHub Release metadata and Git tag'))
    expect(step).toContain('.tag_name')
  })
})

describe('pages.yml preserved release-security contracts', () => {
  it('keeps the three release verifier scripts in the deploy path', () => {
    expect(workflow).toContain('node scripts/release-assets-verify.mjs')
    expect(workflow).toContain('node scripts/download-release-assets.mjs')
    expect(workflow).toContain('node scripts/verify-downloaded-assets.mjs')
  })

  it('extracts exactly the validated release zip', () => {
    const step = normalize(findStepByName('Extract release assets to _site'))
    expect(step).toContain('unzip -q "pmbus-calculator-${VERSION}-web.zip" -d _site')
  })

  it('pins every action to a full 40-hex commit SHA', () => {
    const uses = [...workflow.matchAll(/uses:\s*(\S+)/g)].map((match) => match[1])
    expect(uses.length).toBeGreaterThan(0)
    for (const action of uses) {
      expect(action).toMatch(/@[0-9a-f]{40}$/)
    }
  })
})
