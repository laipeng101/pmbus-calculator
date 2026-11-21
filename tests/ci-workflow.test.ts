import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
const checkJob = workflow.split(/^ {2}check:\s*$/m)[1]
const checkCommand = checkJob.split(/^ {8}run: \|$/m)[1].replace(/^ {10}/gm, '')

describe('required CI check', () => {
  it('runs once for each PR, classifies centrally, and checks the revision GitHub merged for CI', () => {
    expect(workflow).toMatch(
      /^on:\n {2}pull_request:\n {4}branches: \[main\]\n {2}workflow_dispatch:\s*\n/m,
    )
    expect(workflow).not.toMatch(/^ {2}push:|^\s*paths(?:-ignore)?:/m)
    expect(workflow.match(/scripts\/classify-ci-scope\.mjs/g)).toHaveLength(1)
    expect(workflow).not.toMatch(/^ {10}ref:/m)
    expect(workflow).toContain("git rev-parse --verify 'HEAD^{tree}'")
    expect(workflow).toContain('git diff --check "$BASE_SHA" "$HEAD_SHA"')
  })

  it('reads every job result even after a failure or skip', () => {
    expect(checkJob).toContain('if: ${{ always() }}')
    expect(checkJob).toContain('needs: [quality, browser, compatibility]')
    expect(checkJob).toContain('QUALITY_RESULT: ${{ needs.quality.result }}')
    expect(checkJob).toContain('BROWSER_RESULT: ${{ needs.browser.result }}')
    expect(checkJob).toContain('NODE22_RESULT: ${{ needs.compatibility.result }}')
  })

  it.each([
    ['light', 'success', 'skipped', 'skipped', 0],
    ['checks', 'success', 'skipped', 'skipped', 0],
    ['product', 'success', 'success', 'skipped', 0],
    ['full', 'success', 'success', 'success', 0],
    ['light', 'failure', 'skipped', 'skipped', 1],
    ['product', 'success', 'skipped', 'skipped', 1],
    ['product', 'success', 'cancelled', 'skipped', 1],
    ['full', 'success', 'success', 'skipped', 1],
    ['full', 'success', 'failure', 'success', 1],
    ['', 'success', 'success', 'success', 1],
  ])(
    'enforces tier %s with quality=%s, browser=%s and Node 22=%s',
    (tier, quality, browser, node22, code) => {
      const result = spawnSync('bash', ['-c', checkCommand], {
        env: {
          ...process.env,
          TIER: tier,
          QUALITY_RESULT: quality,
          BROWSER_RESULT: browser,
          NODE22_RESULT: node22,
        },
      })
      expect(result.status).toBe(code)
    },
  )
})
