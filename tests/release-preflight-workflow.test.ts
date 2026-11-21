import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync('.github/workflows/release-preflight.yml', 'utf8')
const script = workflow.match(/^ {8}run: \|\n((?: {10}.*\n|\n)+)/m)?.[1]
if (!script) throw new Error('Missing release preflight run block')

function runPreflight(env: Record<string, string> = {}) {
  // Exercise the actual workflow block with a fake CLI and fixture auth.
  const fakeCli = `
timeout() { shift; "$@"; }
gh() {
  [[ "$GH_TOKEN" == fixture-only && "$1 $2 $3 $5" == 'api --method GET --jq' ]] || return 97
  case "$4 $6" in
    'repos/laipeng101/pmbus-calculator/immutable-releases .enabled == true')
      [[ "$IMMUTABLE" != denied ]] || return 1
      echo "$IMMUTABLE" ;;
    'repos/laipeng101/pmbus-calculator/environments/github-pages/secrets/CLOUDFLARE_WEB_ANALYTICS_TOKEN .name')
      [[ "$PAGES_SECRET" != denied ]] || return 1
      echo "$PAGES_SECRET" ;;
    *) return 97 ;;
  esac
}`
  return spawnSync('bash', ['-e', '-o', 'pipefail', '-c', `${fakeCli}\n${script}`], {
    encoding: 'utf8',
    timeout: 5000,
    env: {
      PATH: process.env.PATH,
      GH_TOKEN: 'fixture-only',
      GITHUB_REPOSITORY: 'laipeng101/pmbus-calculator',
      GITHUB_REF: 'refs/heads/main',
      GITHUB_SHA: 'a'.repeat(40),
      IMMUTABLE: 'true',
      PAGES_SECRET: 'CLOUDFLARE_WEB_ANALYTICS_TOKEN',
      ...env,
    },
  })
}

describe('hosted release preflight', () => {
  it('runs on demand with a dedicated environment and a step-scoped PAT', () => {
    expect(workflow).toMatch(/^on:\n {2}workflow_dispatch:\n\npermissions: \{\}\n/m)
    expect(workflow).toMatch(/^ {4}environment: release-preflight\n/m)
    expect(workflow).toContain('          GH_TOKEN: ${{ secrets.PMBUS_RELEASE_GITHUB_TOKEN }}')
    expect(workflow).not.toMatch(/\buses:/)
  })

  it('reports both successful reads and the evaluated SHA', () => {
    const result = runPreflight()
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(`Checking release prerequisites for ${'a'.repeat(40)}`)
    expect(result.stdout).toContain('Immutable releases are enabled.')
    expect(result.stdout).toContain(
      'The github-pages environment has CLOUDFLARE_WEB_ANALYTICS_TOKEN.',
    )
    expect(result.stdout).not.toContain('fixture-only')
  })

  it.each([
    ['GITHUB_REF', 'refs/heads/topic'],
    ['GITHUB_REPOSITORY', 'example/pmbus-calculator'],
  ])('rejects a dispatch outside official main (%s)', (variable, value) => {
    const result = runPreflight({ [variable]: value })
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('Run release preflight on laipeng101/pmbus-calculator main.')
    expect(result.stdout).not.toContain('Checking release prerequisites')
  })

  it('fails before contacting GitHub when the environment secret is missing', () => {
    const result = runPreflight({ GH_TOKEN: '' })
    expect(result.status).toBe(1)
    expect(result.stdout).toContain(
      'Set PMBUS_RELEASE_GITHUB_TOKEN in the release-preflight environment.',
    )
    expect(result.stdout).not.toContain('Checking release prerequisites')
  })

  it('reports the Pages result even when immutable releases are disabled', () => {
    const result = runPreflight({ IMMUTABLE: 'false' })
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('requires Administration: Read')
    expect(result.stdout).toContain(
      'The github-pages environment has CLOUDFLARE_WEB_ANALYTICS_TOKEN.',
    )
  })

  it('fails when the Pages secret metadata names a different secret', () => {
    const result = runPreflight({ PAGES_SECRET: 'ANOTHER_SECRET' })
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('Immutable releases are enabled.')
    expect(result.stdout).toContain('requires Environments: Read')
    expect(result.stdout).not.toContain('ANOTHER_SECRET')
  })

  it('reports both failed API reads', () => {
    const result = runPreflight({ IMMUTABLE: 'denied', PAGES_SECRET: 'denied' })
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('requires Administration: Read')
    expect(result.stdout).toContain('requires Environments: Read')
  })
})
