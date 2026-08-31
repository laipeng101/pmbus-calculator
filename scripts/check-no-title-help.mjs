#!/usr/bin/env node
/**
 * v2.6.0 regression gate: production interactive controls must not use the
 * native `title` attribute as help text.
 *
 * Native titles have unstyleable rendering, OS-controlled delay, no touch or
 * keyboard story and no testable contract; v2.6.0 replaced the last three
 * button titles with the shared CONTROL_HELP tooltip layer. This scan keeps
 * them from coming back.
 *
 * Scope: JSX attribute usage (`title="…"` / `title={…}`) under src/. The HTML
 * document `<title>` element lives in index.html and SVG `<title>` elements
 * are elements, not attributes — both are outside this gate by construction.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const ROOT = new URL('..', import.meta.url).pathname

/**
 * @param {string} dir
 * @param {string[]} [files]
 * @returns {string[]}
 */
function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      walk(full, files)
    } else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) {
      files.push(full)
    }
  }
  return files
}

/** @type {string[]} */
const offenders = []
for (const file of walk(join(ROOT, 'src'))) {
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, i) => {
    if (/^\s*\/\//.test(line) || /^\s*\*/.test(line)) return
    const match = line.match(/\btitle=\s*(?:"|'|\{)/)
    if (match) {
      offenders.push(file.replace(ROOT, '') + ':' + (i + 1) + ': ' + line.trim().slice(0, 120))
    }
  })
}

if (offenders.length > 0) {
  console.error('check:no-title-help: native title help is banned in src/ (v2.6.0):')
  for (const offender of offenders) console.error('  ' + offender)
  console.error('Use the CONTROL_HELP registry + ControlTooltip instead.')
  process.exit(1)
}

console.log('check:no-title-help: OK (no native title attributes under src/)')
