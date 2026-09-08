// @vitest-environment node
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import defaultConfig from '../playwright.config'
import { isAllowedPagesRequest } from './e2e/helpers/pages-network-policy'
import { isAllowedPagesRequest as sharedPolicy } from '../scripts/pages-network-policy.mjs'

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>
}
const ci = fs.readFileSync('.github/workflows/ci.yml', 'utf8')
const live = fs.readFileSync('scripts/verify-live-analytics.mjs', 'utf8')

// Follow aliases and npm's automatic pre/post hooks: a future indirection must
// not sneak the external-service probe into deterministic local/PR validation.
function scriptClosure(command: string, seen = new Set<string>()): string {
  let result = command
  const names = [...command.matchAll(/npm run ([\w:-]+)/g)].map((match) => match[1])
  if (/\bnpm (?:ci|install)\b/.test(command)) {
    names.push(
      'preinstall',
      'install',
      'postinstall',
      'prepublish',
      'preprepare',
      'prepare',
      'postprepare',
    )
  }
  for (const name of names) {
    for (const invoked of [name, `pre${name}`, `post${name}`]) {
      if (seen.has(invoked) || !(invoked in pkg.scripts)) continue
      seen.add(invoked)
      result += '\n' + scriptClosure(pkg.scripts[invoked], seen)
    }
  }
  return result
}

describe('deterministic versus real Analytics entry isolation', () => {
  it('keeps full verify and full PR CI overlay validation while excluding the real entry transitively', () => {
    expect(pkg.scripts.verify.split(' && ')).toContain('npm run test:pages-overlay')
    expect(ci).toMatch(
      /if: steps\.scope\.outputs\.run_full != 'false'\n {8}run: npm run test:pages-overlay/,
    )
    for (const command of ['npm run verify', 'npm run verify:light', ci]) {
      expect(scriptClosure(command)).not.toMatch(
        /verify-live-analytics|Real Cloudflare Analytics acceptance/,
      )
    }
  })

  it('shares the audited exact network policy and retains both deterministic stubs', () => {
    expect(isAllowedPagesRequest).toBe(sharedPolicy)
    expect(live).toContain("from './pages-network-policy.mjs'")
    for (const file of ['tests/e2e/pages-overlay.spec.ts', 'tests/e2e/deployment.spec.ts']) {
      expect(fs.readFileSync(file, 'utf8')).toContain('await stubCloudflare(page)')
    }
    const helper = fs.readFileSync('tests/e2e/helpers/pages-contract.ts', 'utf8')
    expect(helper).toContain('page.route(CLOUDFLARE_BEACON_URL,')
    expect(helper).toContain('page.route(CLOUDFLARE_RUM_URL,')
  })

  it('keeps live acceptance outside E2E discovery, build, source, secret and request-mocking paths', () => {
    expect(defaultConfig.testDir).toBe('./tests/e2e')
    expect(fs.existsSync('scripts/verify-live-analytics.mjs')).toBe(true)
    expect(live).not.toMatch(
      /stubCloudflare|\.route\(|\.fulfill\(|\bfetch\(|postData\(|\.headers\(|\.content\(|\.tracing\.|recordHar|screenshot\(|CLOUDFLARE_WEB_ANALYTICS_TOKEN/,
    )
    expect(live).not.toMatch(
      /proxy:|ignoreHTTPSErrors|--host-resolver-rules|--disable-web-security/,
    )
    expect(scriptClosure('npm run build')).not.toContain('verify-live-analytics')
  })
})
