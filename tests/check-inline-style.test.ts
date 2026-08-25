import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkInlineStyle } from '../scripts/check-inline-style.mjs'

const roots: string[] = []

async function makeTempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pmbus-inline-style-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

async function makeSource(root: string, files: Record<string, string>) {
  for (const [relative, text] of Object.entries(files)) {
    const full = path.join(root, relative)
    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.writeFile(full, text, 'utf8')
  }
}

describe('checkInlineStyle', () => {
  it('passes when production sources contain no style props', async () => {
    const root = await makeTempRoot()
    await makeSource(root, {
      'src/App.tsx': "export default function App() {\n  return <div className='app' />\n}\n",
      'src/styles/tokens.css': '.app { color: var(--color-text-primary) }',
    })
    const result = await checkInlineStyle(root)
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.files.some((file) => file.endsWith('App.tsx'))).toBe(true)
  })

  it('fails when a style prop appears in a production TSX source', async () => {
    const root = await makeTempRoot()
    await makeSource(root, {
      'src/components/Example.tsx':
        "export default function Example() {\n  return <div style={{ color: 'red' }} />\n}\n",
    })
    const result = await checkInlineStyle(root)
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/Example\.tsx contains an inline style prop/)
  })

  it('does not need to scan non-source files for the gate', async () => {
    const root = await makeTempRoot()
    await makeSource(root, {
      'src/App.tsx': "export default function App() {\n  return <div className='app' />\n}\n",
      'docs/note.md': '<div style="color: red">legacy markdown sample</div>',
    })
    const result = await checkInlineStyle(root)
    expect(result.ok).toBe(true)
  })
})
