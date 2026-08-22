import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const files = execFileSync('git', ['ls-files', '*.md'], { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean)
  .filter((f) => f.startsWith('docs/archive/') === false)

const FORBIDDEN_STRINGS = [
  ['\\operatorname', 'forbidden \\operatorname'],
  ['\\newcommand', 'forbidden custom macro \\newcommand'],
  ['\\DeclareMathOperator', 'forbidden custom macro \\DeclareMathOperator'],
  ['\\def', 'forbidden custom macro \\def'],
]

let failed = false

/**
 * @param {string} file
 * @param {string} message
 */
function error(file, message) {
  failed = true
  console.error(`::error file=${file}::${message}`)
}

/**
 * @param {string} line
 * @returns {boolean}
 */
function isCodeFence(line) {
  return /^(```|~~~)/.test(line)
}

/**
 * @param {string} line
 * @returns {string}
 */
function fenceMarker(line) {
  const match = line.match(/^(`+|~+)/)
  return match ? match[1] : ''
}

for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const lines = text.split(/\r?\n/)

  let inMathFence = false
  let inCodeFence = false
  let codeFenceMarker = ''
  const checkLines = []

  for (const line of lines) {
    const trimmed = line.trim()

    if (inMathFence || inCodeFence) {
      if (isCodeFence(trimmed)) {
        const marker = fenceMarker(trimmed)
        if (marker === codeFenceMarker || (inMathFence && marker.startsWith('```'))) {
          inMathFence = false
          inCodeFence = false
          codeFenceMarker = ''
          continue
        }
      }
      continue
    }

    if (trimmed.startsWith('```math')) {
      inMathFence = true
      codeFenceMarker = '```'
      continue
    }

    if (isCodeFence(trimmed)) {
      inCodeFence = true
      codeFenceMarker = fenceMarker(trimmed)
      continue
    }

    checkLines.push(line)
  }

  if (inMathFence) error(file, 'unclosed ```math fence')
  if (inCodeFence) error(file, `unclosed code fence (${codeFenceMarker || '?'})`)

  const checkText = checkLines.join('\n').replace(/`[^`]*`/g, '')
  for (const [needle, message] of FORBIDDEN_STRINGS) {
    if (checkText.includes(needle)) {
      error(file, message)
    }
  }

  const dollarCount = (checkText.match(/\$/g) ?? []).length
  if (dollarCount % 2 !== 0) {
    error(file, `unbalanced dollar delimiters (${dollarCount} dollar signs)`)
  }
}

if (failed) process.exit(1)
console.log(`checked ${files.length} active markdown files`)
