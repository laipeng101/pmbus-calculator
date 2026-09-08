// Check the static asset graph that Vite emits, without evaluating application
// code. This deliberately covers CSS url()/@import and literal ESM references;
// it is not a general JavaScript security audit or a proof about computed fetch
// calls. Ordinary help/license URL strings are not runtime asset references.

import path from 'node:path'

/** @typedef {Map<string, import('node:buffer').Buffer>} SiteFiles */
/** @typedef {'CSS URL' | 'CSS import' | 'ESM import'} ReferenceKind */
/** @typedef {{ value: string, end: number }} ParsedReference */
/** @typedef {ParsedReference & { escaped: boolean }} ParsedString */
/** @typedef {ParsedString & { kind: 'string' }} StringToken */
/** @typedef {{ kind: 'template', value: string, escaped: boolean, substitutions: boolean }} TemplateToken */
/** @typedef {{ kind: 'word' | 'punctuation' | 'regex', value: string }} OtherToken */
/** @typedef {StringToken | TemplateToken | OtherToken} JsToken */

/** @param {string} asset @param {string} reason @returns {never} */
function reject(asset, reason) {
  // Never include the rejected reference: deployment input could be embedded.
  throw new Error(`Pages asset references: ${asset}: ${reason}`)
}

/**
 * @param {SiteFiles} files
 * @param {string} asset
 * @param {string} reference
 * @param {ReferenceKind} kind
 * @returns {void}
 */
function verifyReference(files, asset, reference, kind) {
  if (/^data:/i.test(reference)) {
    if (
      kind === 'CSS URL' &&
      /^data:(?:image\/[a-z0-9.+-]+|font\/[a-z0-9.+-]+|application\/(?:font-woff|vnd\.ms-fontobject|x-font-ttf|x-font-opentype))(?:;[^,]*)?,[^\r\n]+$/i.test(
        reference,
      )
    ) {
      return
    }
    reject(asset, `${kind} has an unsupported data resource`)
  }
  if (
    !reference ||
    /[\x00-\x20\x7f\\]/.test(reference) ||
    /^[a-z][a-z0-9+.-]*:/i.test(reference) ||
    reference.startsWith('/') ||
    /%/.test(reference)
  ) {
    reject(asset, `${kind} must use an unescaped same-origin relative reference`)
  }
  if (kind === 'ESM import' && !/^\.\.?\//.test(reference)) {
    reject(asset, 'ESM import must use a relative module specifier')
  }
  const resource = reference.split(/[?#]/, 1)[0]
  const resolved = resource
    ? path.posix.normalize(path.posix.join(path.posix.dirname(asset), resource))
    : asset
  if (resolved.startsWith('../') || resolved === '..' || !files.has(resolved)) {
    reject(asset, `${kind} does not resolve to a file in the verified site tree`)
  }
}

/** @param {string} source @param {number} offset @param {string} asset @returns {number} */
function skipComment(source, offset, asset) {
  const end = source.indexOf('*/', offset + 2)
  if (end === -1) reject(asset, 'unterminated asset comment')
  return end + 2
}

/** @param {string} source @param {number} offset @param {string} asset @returns {ParsedString} */
function readString(source, offset, asset) {
  const quote = source[offset]
  const start = ++offset
  let escaped = false
  while (offset < source.length) {
    if (source[offset] === quote) {
      return { value: source.slice(start, offset), escaped, end: offset + 1 }
    }
    if (source[offset] === '\\') {
      escaped = true
      offset += source[offset + 1] === '\r' && source[offset + 2] === '\n' ? 3 : 2
    } else {
      if (/[\r\n]/.test(source[offset])) reject(asset, 'unterminated asset string')
      offset++
    }
  }
  reject(asset, 'unterminated asset string')
}

/** @param {string} source @param {number} offset @param {string} asset @returns {number} */
function skipCssTrivia(source, offset, asset) {
  while (offset < source.length) {
    if (/\s/.test(source[offset])) offset++
    else if (source.startsWith('/*', offset)) offset = skipComment(source, offset, asset)
    else break
  }
  return offset
}

/** @param {string} source @param {number} offset @param {string} asset @returns {ParsedString} */
function readCssName(source, offset, asset) {
  let value = ''
  let escaped = false
  while (offset < source.length) {
    const char = source[offset]
    if (/[a-z0-9_-]/i.test(char) || char.charCodeAt(0) >= 128) {
      value += char
      offset++
    } else if (char === '\\') {
      escaped = true
      const hex = source.slice(offset + 1).match(/^[0-9a-f]{1,6}/i)?.[0]
      if (hex) {
        const point = Number.parseInt(hex, 16)
        if (point === 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) {
          reject(asset, 'unsupported CSS identifier escape')
        }
        value += String.fromCodePoint(point)
        offset += hex.length + 1
        if (source.startsWith('\r\n', offset)) offset += 2
        else if (/\s/.test(source[offset] || '')) offset++
      } else {
        if (!source[offset + 1] || /[\r\n\f]/.test(source[offset + 1])) {
          reject(asset, 'unsupported CSS identifier escape')
        }
        value += source[offset + 1]
        offset += 2
      }
    } else break
  }
  return { value: value.toLowerCase(), escaped, end: offset }
}

/** @param {string} source @param {number} open @param {string} asset @returns {ParsedReference} */
function readCssUrl(source, open, asset) {
  let offset = skipCssTrivia(source, open + 1, asset)
  let value
  if (source[offset] === '"' || source[offset] === "'") {
    const string = readString(source, offset, asset)
    if (string.escaped) reject(asset, 'escaped CSS URL is unsupported')
    value = string.value
    offset = skipCssTrivia(source, string.end, asset)
  } else {
    const end = source.indexOf(')', offset)
    if (end === -1) reject(asset, 'unterminated CSS URL')
    value = source.slice(offset, end).trim()
    if (/[\\'"(\s]/.test(value) || value.includes('/*')) {
      reject(asset, 'unsupported CSS URL grammar')
    }
    offset = end
  }
  if (source[offset] !== ')') reject(asset, 'unsupported CSS URL grammar')
  return { value, end: offset + 1 }
}

/** @param {SiteFiles} files @param {string} asset @param {string} source @returns {void} */
function verifyCss(files, asset, source) {
  let offset = 0
  while (offset < source.length) {
    const next = skipCssTrivia(source, offset, asset)
    if (next !== offset) {
      offset = next
      continue
    }
    if (source[offset] === '"' || source[offset] === "'") {
      offset = readString(source, offset, asset).end
      continue
    }
    const atRule = source[offset] === '@'
    const start = offset + Number(atRule)
    if (!/[a-z_\\-]/i.test(source[start] || '')) {
      offset++
      continue
    }
    const name = readCssName(source, start, asset)
    offset = name.end
    const following = skipCssTrivia(source, offset, asset)
    if (atRule && name.value === 'import') {
      if (name.escaped) reject(asset, 'escaped CSS import is unsupported')
      let imported
      if (source[following] === '"' || source[following] === "'") {
        imported = readString(source, following, asset)
        if (imported.escaped) reject(asset, 'escaped CSS import is unsupported')
      } else {
        const urlName = readCssName(source, following, asset)
        const open = skipCssTrivia(source, urlName.end, asset)
        if (urlName.value !== 'url' || urlName.escaped || source[open] !== '(') {
          reject(asset, 'unsupported CSS import grammar')
        }
        imported = readCssUrl(source, open, asset)
      }
      verifyReference(files, asset, imported.value, 'CSS import')
      offset = imported.end
    } else if (name.value === 'url' && source[following] === '(') {
      if (name.escaped) reject(asset, 'escaped CSS URL function is unsupported')
      const url = readCssUrl(source, following, asset)
      verifyReference(files, asset, url.value, 'CSS URL')
      offset = url.end
    } else if (
      ['image-set', '-webkit-image-set', 'image', 'src'].includes(name.value) &&
      source[following] === '('
    ) {
      // These forms can use naked URL strings; do not mistake them for
      // inert text. The current bundle uses the explicit url() form.
      reject(asset, 'unsupported CSS resource function; use an explicit URL')
    }
  }
}

/** @param {string} source @param {string} asset @returns {JsToken[]} */
function jsTokens(source, asset) {
  /** @type {JsToken[]} */
  const tokens = []
  let offset = 0
  const identifier = /[\w$]/
  /** @param {boolean} templateExpression @returns {void} */
  function scan(templateExpression = false) {
    let braces = 0
    let expressionAllowed = true
    /** @type {boolean[]} */
    const parentheses = []
    while (offset < source.length) {
      const char = source[offset]
      if (/\s/.test(char)) {
        offset++
        continue
      }
      if (source.startsWith('/*', offset)) {
        offset = skipComment(source, offset, asset)
        continue
      }
      if (source.startsWith('//', offset)) {
        // All four ECMAScript line terminators end a line comment.
        const end = source.slice(offset + 2).search(/[\r\n\u2028\u2029]/)
        offset = end === -1 ? source.length : offset + 2 + end + 1
        continue
      }
      if (char === '}' && templateExpression && braces === 0) {
        offset++
        return
      }
      if (char === '"' || char === "'") {
        const string = readString(source, offset, asset)
        tokens.push({ kind: 'string', ...string })
        offset = string.end
        expressionAllowed = false
        continue
      }
      if (char === '`') {
        /** @type {TemplateToken} */
        const token = { kind: 'template', value: '', escaped: false, substitutions: false }
        tokens.push(token)
        offset++
        let closed = false
        while (offset < source.length) {
          if (source[offset] === '`') {
            offset++
            closed = true
            break
          }
          if (source[offset] === '\\') {
            token.escaped = true
            offset += 2
            continue
          }
          if (source.startsWith('${', offset)) {
            token.substitutions = true
            offset += 2
            scan(true)
          } else token.value += source[offset++]
        }
        if (!closed) reject(asset, 'unterminated JavaScript template')
        expressionAllowed = false
        continue
      }
      if (char === '/' && expressionAllowed) {
        if (tokens.at(-1)?.value === '}') {
          reject(asset, 'ambiguous JavaScript slash after a closing brace')
        }
        offset++
        let characterClass = false
        let closed = false
        while (offset < source.length) {
          const current = source[offset++]
          if (current === '\\') {
            offset++
            continue
          }
          if (/[\r\n\u2028\u2029]/.test(current))
            reject(asset, 'unsupported JavaScript regular expression')
          if (current === '[') characterClass = true
          if (current === ']') characterClass = false
          if (current === '/' && !characterClass) {
            closed = true
            break
          }
        }
        if (!closed) reject(asset, 'unterminated JavaScript regular expression')
        while (identifier.test(source[offset] || '')) offset++
        tokens.push({ kind: 'regex', value: '' })
        expressionAllowed = false
        continue
      }
      if (char === '\\') reject(asset, 'escaped JavaScript identifier is unsupported')
      if (identifier.test(char) || char.charCodeAt(0) >= 128) {
        const start = offset++
        while (
          offset < source.length &&
          !/\s/.test(source[offset]) &&
          (identifier.test(source[offset]) || source.charCodeAt(offset) >= 128)
        )
          offset++
        const value = source.slice(start, offset)
        const property = ['.', '?.'].includes(tokens.at(-1)?.value ?? '')
        tokens.push({ kind: 'word', value })
        expressionAllowed =
          !property &&
          /^(return|throw|case|delete|void|typeof|new|in|instanceof|yield|await|else|do)$/.test(
            value,
          )
        continue
      }
      const previous = tokens.at(-1)?.value
      const pair = source.slice(offset, offset + 2)
      const value = ['=>', '?.', '++', '--', '&&', '||', '??'].includes(pair) ? pair : char
      offset += value.length
      if (value === '(') {
        const propertyCall = ['.', '?.'].includes(tokens.at(-2)?.value ?? '')
        parentheses.push(!propertyCall && /^(if|while|for|with|switch|catch)$/.test(previous || ''))
      }
      if (value === '{') braces++
      if (value === '}') braces--
      expressionAllowed =
        value === ')' ? !!parentheses.pop() : ![']', '.', '?.', '++', '--'].includes(value)
      tokens.push({ kind: 'punctuation', value })
    }
    if (templateExpression) reject(asset, 'unterminated JavaScript template expression')
  }
  scan()
  return tokens
}

/** @param {SiteFiles} files @param {string} asset @param {string} source @returns {void} */
function verifyJs(files, asset, source) {
  const tokens = jsTokens(source, asset)
  /** @param {JsToken | undefined} token @returns {void} */
  const check = (token) => {
    if (!token || (token.kind !== 'string' && token.kind !== 'template')) {
      reject(asset, 'ESM import requires an unescaped literal module specifier')
    }
    if (token.escaped || (token.kind === 'template' && token.substitutions)) {
      reject(asset, 'ESM import requires an unescaped literal module specifier')
    }
    verifyReference(files, asset, token.value, 'ESM import')
  }
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (token.kind !== 'word' || !['import', 'export'].includes(token.value)) continue
    if (['.', '?.'].includes(tokens[index - 1]?.value ?? '')) continue
    const next = tokens[index + 1]
    if (!next || [':', '.'].includes(next.value)) continue
    if (token.value === 'import' && next.value === '(') {
      check(tokens[index + 2])
      if (![')', ','].includes(tokens[index + 3]?.value ?? ''))
        reject(asset, 'computed ESM import is unsupported')
      continue
    }
    if (token.value === 'import' && next.kind === 'string') {
      check(next)
      continue
    }
    if (token.value === 'export' && !['*', '{'].includes(next.value)) continue
    let depth = 0
    let found = false
    for (let cursor = index + 1; cursor < tokens.length; cursor++) {
      const current = tokens[cursor]
      if (current.value === '{') depth++
      if (current.value === '}') depth--
      if (
        depth === 0 &&
        current.kind === 'word' &&
        current.value === 'from' &&
        tokens[cursor + 1]?.kind === 'string'
      ) {
        check(tokens[cursor + 1])
        found = true
        break
      }
      if (depth === 0 && current.value === ';') break
      if (
        token.value === 'export' &&
        depth === 0 &&
        current.value === '}' &&
        tokens[cursor + 1]?.value !== 'from'
      )
        break
    }
    if (!found && token.value === 'import') reject(asset, 'unsupported ESM import grammar')
    if (!found && token.value === 'export' && next.value === '*')
      reject(asset, 'unsupported ESM export grammar')
  }
}

/**
 * Verify CSS and ESM references in an already verified site file map.
 * @param {SiteFiles} files
 * @returns {void}
 */
export function verifyPagesAssetReferences(files) {
  for (const [asset, bytes] of files) {
    if (/\.css$/i.test(asset)) verifyCss(files, asset, bytes.toString('utf8'))
    else if (/\.m?js$/i.test(asset)) verifyJs(files, asset, bytes.toString('utf8'))
  }
}
