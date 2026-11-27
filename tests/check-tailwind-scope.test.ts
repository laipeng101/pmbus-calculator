import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkTailwindScope } from '../scripts/check-tailwind-scope.mjs'
import { TAILWIND_SOURCE_CANARY_UTILITY } from './tailwind-source-canary'

const roots: string[] = []

async function makeTempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pmbus-tailwind-scope-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

const CLEAN_TAILWIND_CSS = [
  ':root{--color-canvas:#f8fafc;--color-panel:#ffffff}',
  '.flex{display:flex}',
].join('')

async function makeEnvironment(
  root: string,
  tailwindCss: string,
  katexCss = '.katex{font-size:1em}',
) {
  const canaryPath = path.join(root, 'tailwind-source-canary.ts')
  await fs.writeFile(
    canaryPath,
    `export const TAILWIND_SOURCE_CANARY_UTILITY = '${TAILWIND_SOURCE_CANARY_UTILITY}'\n`,
    'utf8',
  )

  const distDir = path.join(root, 'dist')
  await fs.mkdir(path.join(distDir, 'assets'), { recursive: true })
  await fs.writeFile(path.join(distDir, 'assets', 'index-tailwind.css'), tailwindCss, 'utf8')
  await fs.writeFile(path.join(distDir, 'assets', 'katex.css'), katexCss, 'utf8')

  const productionSrcDir = path.join(root, 'src')
  await fs.mkdir(path.join(productionSrcDir, 'components'), { recursive: true })
  await fs.writeFile(
    path.join(productionSrcDir, 'components', 'Example.tsx'),
    "export const example = () => <div className='flex' />\n",
    'utf8',
  )

  return { distDir, canaryPath, productionSrcDir }
}

describe('checkTailwindScope', () => {
  it('passes for a clean dist even if excluded colocated tests mention the canary', async () => {
    const root = await makeTempRoot()
    const env = await makeEnvironment(root, CLEAN_TAILWIND_CSS)
    await fs.writeFile(
      path.join(env.productionSrcDir, 'components', 'Example.test.tsx'),
      `const testCanary = '${TAILWIND_SOURCE_CANARY_UTILITY}'\n`,
    )
    const result = await checkTailwindScope(env)
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.canaryUtility).toBe(TAILWIND_SOURCE_CANARY_UTILITY)
    expect(result.tailwindCss).toHaveLength(1)
  })

  it('fails when the canary utility leaks into the compiled Tailwind CSS', async () => {
    const root = await makeTempRoot()
    const leaked = `${CLEAN_TAILWIND_CSS}.w-\\[77.125rem\\]{width:77.125rem}`
    const result = await checkTailwindScope(await makeEnvironment(root, leaked))
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/canary .* leaked into compiled CSS/)
  })

  it.each([
    ['lowercase', 'text-transform:lowercase'],
    ['table', 'display:table'],
  ])('rejects a leaked .%s rule', async (selector, declaration) => {
    const root = await makeTempRoot()
    const leaked = `${CLEAN_TAILWIND_CSS}.${selector}{${declaration}}`
    const result = await checkTailwindScope(await makeEnvironment(root, leaked))
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain(`leaked rule ".${selector}{…}"`)
  })

  it('fails when a required product utility is missing from the compiled CSS', async () => {
    const root = await makeTempRoot()
    const stripped = CLEAN_TAILWIND_CSS.replace('.flex{display:flex}', '')
    const result = await checkTailwindScope(await makeEnvironment(root, stripped))
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/required product utility "\.flex\{…\}" missing/)
  })

  it('fails when the dist directory does not exist', async () => {
    const root = await makeTempRoot()
    const env = await makeEnvironment(root, CLEAN_TAILWIND_CSS)
    await fs.rm(env.distDir, { recursive: true, force: true })
    const result = await checkTailwindScope(env)
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/dist directory not found/)
  })

  it('fails when no compiled CSS carries the Tailwind theme marker', async () => {
    const root = await makeTempRoot()
    const result = await checkTailwindScope(await makeEnvironment(root, '.flex{display:flex}'))
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/no compiled Tailwind CSS found/)
  })

  it('ignores marker-less CSS such as katex.min.css for leak judgements', async () => {
    const root = await makeTempRoot()
    const katexCss = '.lowercase{font-size:1em}.table{display:table}'
    const result = await checkTailwindScope(
      await makeEnvironment(root, CLEAN_TAILWIND_CSS, katexCss),
    )
    expect(result.ok).toBe(true)
  })

  it('fails when the canary value collides with a production source file', async () => {
    const root = await makeTempRoot()
    const env = await makeEnvironment(root, CLEAN_TAILWIND_CSS)
    await fs.writeFile(
      path.join(env.productionSrcDir, 'components', 'Example.tsx'),
      "export const width = '77.125rem'\n",
      'utf8',
    )
    const result = await checkTailwindScope(env)
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/collides with production source/)
  })

  it('fails when the canary file cannot be parsed', async () => {
    const root = await makeTempRoot()
    const env = await makeEnvironment(root, CLEAN_TAILWIND_CSS)
    await fs.writeFile(env.canaryPath, 'export const nothing = true\n', 'utf8')
    const result = await checkTailwindScope(env)
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/cannot read canary utility/)
  })
})
