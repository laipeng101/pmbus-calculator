import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { validateZipEntry } from '../scripts/release-artifact-contract.mjs'
import zipEntries from './fixtures/zip-entry-contract.json'

const python = process.env.PYTHON3 || 'python3'
const script = fileURLToPath(new URL('../scripts/release-zip.py', import.meta.url))
let root: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmbus-zip-'))
})

afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

it('keeps Python and JavaScript ZIP entry validation in agreement', () => {
  const entries = [...zipEntries.legal, ...zipEntries.illegal.map(({ entry }) => entry)]
  const check = `import json, runpy, sys
validate = runpy.run_path(sys.argv[1])['validate_name']
result = []
for name in json.load(sys.stdin):
    try:
        validate(name)
    except ValueError:
        result.append(False)
    else:
        result.append(True)
print(json.dumps(result))`
  const expected = entries.map((_, index) => index < zipEntries.legal.length)
  const result = execFileSync(python, ['-c', check, script], {
    input: JSON.stringify(entries),
    encoding: 'utf8',
  })
  expect(JSON.parse(result)).toEqual(expected)
  expect(entries.map((entry) => validateZipEntry(entry).ok)).toEqual(expected)
})

const rejectionCases = [
  { entry: '../escape.txt', content: 'outside', kind: 'unsafe ZIP entry' },
  { entry: 'assets/app.js', content: 'another app script', kind: 'ambiguous ZIP entry' },
  { entry: 'assets/symlink', symlink: true, kind: 'not a regular ZIP file' },
  { entry: 'pages-overlay.css', content: 'body {}', kind: 'Pages-only content' },
  { entry: 'assets/style.css', content: 'DATA-PAGES-ONLY', kind: 'Pages-only content' },
  {
    entry: 'assets/extra.css',
    content: 'https://CloudflareInsights.com',
    kind: 'Pages-only content',
  },
  {
    entry: 'assets/other.js',
    content: 'data-cf-beacon="fixture-value"',
    kind: 'Pages-only content',
  },
]

it.each(rejectionCases)('rejects extraction of $entry with $kind', (testCase) => {
  const zip = path.join(root, 'release.zip')
  const destination = path.join(root, '_site')
  const create = `import json, stat, sys, warnings, zipfile
warnings.filterwarnings('ignore', category=UserWarning)
case = json.loads(sys.argv[2])
with zipfile.ZipFile(sys.argv[1], 'w') as archive:
    archive.writestr('index.html', '''<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'"><script src="./assets/app.js"></script><link href="./assets/app.css">''')
    archive.writestr('assets/app.js', '')
    archive.writestr('assets/app.css', '')
    info = zipfile.ZipInfo(case['entry'])
    if case.get('symlink'):
        info.create_system = 3
        info.external_attr = (stat.S_IFLNK | 0o777) << 16
    archive.writestr(info, case.get('content', 'app.js'))`
  execFileSync(python, ['-c', create, zip, JSON.stringify(testCase)])
  const result = spawnSync(python, [script, 'extract', zip, destination], { encoding: 'utf8' })
  expect(result.status).toBe(1)
  expect(result.stderr).toContain(testCase.kind)
  expect(result.stderr).not.toContain('fixture-value')
  expect(fs.existsSync(destination)).toBe(false)
  expect(fs.existsSync(path.join(root, 'escape.txt'))).toBe(false)
})

it.skipIf(process.platform === 'win32')('rejects a FIFO in a build without blocking on it', () => {
  const dist = path.join(root, 'dist')
  const zip = path.join(root, 'release.zip')
  fs.mkdirSync(dist)
  execFileSync('mkfifo', [path.join(dist, 'pipe')])
  const result = spawnSync(python, [script, 'create', dist, zip], {
    encoding: 'utf8',
    timeout: 2000,
  })
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('not a regular build file')
  expect(fs.existsSync(zip)).toBe(false)
})
