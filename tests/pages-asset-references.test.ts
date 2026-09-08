import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { verifyPagesAssetReferences } from '../scripts/verify-pages-asset-references.mjs'

function site(overrides: Record<string, string> = {}) {
  return new Map(
    Object.entries({
      'index.html': '<!doctype html>',
      'assets/app.css': 'body{color:black}',
      'assets/app.js': 'export const value = 1;',
      'assets/dep.js': 'export const value = 2;',
      'assets/shared.css': '.shared{}',
      'assets/font.woff2': 'font fixture',
      'assets/pixel.svg': '<svg/>',
      ...overrides,
    }).map(([name, contents]) => [name, Buffer.from(contents)]),
  )
}

describe('Pages CSS asset references', () => {
  it('accepts relative fonts, images and imported stylesheets that exist in the tree', () => {
    expect(() =>
      verifyPagesAssetReferences(
        site({
          'assets/app.css': `
            @import "./shared.css" layer(base);
            @IMPORT url('./shared.css') screen;
            @font-face { src: URL(./font.woff2?#font) format('woff2') }
            .image { background: url(./pixel.svg#icon) }
            .mask { mask: url(#local-mask) }
          `,
        }),
      ),
    ).not.toThrow()
  })

  it('ignores comments and inert strings while accepting Tailwind selector escapes', () => {
    expect(() =>
      verifyPagesAssetReferences(
        site({
          'assets/app.css': String.raw`
            /* https://licenses.example/; @import "https://ignored.example/x.css" */
            .hover\:active { content: 'url("https://text.example/image")'; color: red }
            .w-2\.5 { width: 2.5rem }
          `,
        }),
      ),
    ).not.toThrow()
  })

  it.each([
    'data:image/png;base64,aGVsbG8=',
    'data:image/svg+xml,%3Csvg/%3E',
    'data:font/woff2;base64,aGVsbG8=',
    'data:application/font-woff;base64,aGVsbG8=',
  ])('accepts the existing CSP image/font data allowance: %s', (reference) => {
    expect(() =>
      verifyPagesAssetReferences(site({ 'assets/app.css': `a{background:url('${reference}')}` })),
    ).not.toThrow()
  })

  it.each([
    'a{background:url(https://outside.example/image.png)}',
    'a{background:URL("//outside.example/image.png")}',
    '@import "https://outside.example/style.css";',
    '@import url(https://outside.example/style.css);',
    '@IMPORT/**/url("https://outside.example/style.css") screen;',
    'a{background:url(https://static.cloudflareinsights.com/beacon.min.js)}',
    '@font-face{src:url(https://fonts.example/font.woff2)}',
    'a{background:url(/assets/pixel.svg)}',
    'a{background:url(./missing.svg)}',
    '@import "./missing.css";',
    'a{background:url(../../escape.svg)}',
    'a{background:url(./%70ixel.svg)}',
    'a{background:url(data:text/html,hello)}',
    '@import "data:text/css,body{}";',
  ])('rejects an external, absent or unsupported CSS resource: %s', (css) => {
    expect(() => verifyPagesAssetReferences(site({ 'assets/app.css': css }))).toThrow(
      /Pages asset references/,
    )
  })

  it.each([
    String.raw`@\69mport "./shared.css";`,
    String.raw`a{background:u\72l(./pixel.svg)}`,
    'a{background:u\\72\r\nl(https://outside.example/image.png)}',
    String.raw`a{background:url("./p\69xel.svg")}`,
    String.raw`a{background:url(./p\69xel.svg)}`,
    '@import var(--stylesheet);',
    'a{background:url(var(--image))}',
    'a{background:url("./pixel.svg" unexpected)}',
    'a{background:image-set("https://outside.example/p.png" 1x)}',
    'a{background:src("https://outside.example/p.png")}',
    '/* unfinished comment',
    'a{content:"unfinished string}',
  ])('fails closed for escaped or unknown CSS reference grammar: %s', (css) => {
    expect(() => verifyPagesAssetReferences(site({ 'assets/app.css': css }))).toThrow(
      /Pages asset references/,
    )
  })
})

describe('Pages ESM asset references', () => {
  it('accepts literal same-origin static imports, re-exports and dynamic imports', () => {
    const js = [
      'import "./dep.js";',
      'import/* comment */{ value as dep }from"./dep.js";',
      'import value from "./dep.js";',
      'import from from "./dep.js";',
      'import * as module from "./dep.js";',
      'export { value } from "./dep.js";',
      'export * from "./dep.js";',
      'export * as namespace from "./dep.js";',
      'import("./dep.js");',
      'import(`./dep.js`);',
      'import("./dep.js", { with: { type: "json" } });',
      'export const result = value;',
    ].join('\n')
    expect(() => verifyPagesAssetReferences(site({ 'assets/app.js': js }))).not.toThrow()
  })

  it('ignores license/help strings, comments, template raw text, regular expressions and property calls', () => {
    const js = [
      '// import "https://comment.example/module.js";',
      '/* export * from "https://license.example/module.js"; */',
      'const help = "https://docs.example/help";',
      'const sample = \'import("https://string.example/module.js")\';',
      'const template = `import("https://template.example/module.js")`;',
      String.raw`const regex = /import\("https:\/\/regex\.example"\)/;`,
      String.raw`if (ready) /import\("https:\/\/conditional\.example"\)/.test(text);`,
      'object.import("https://property.example/module.js");',
      'object?.import("https://property.example/module.js");',
      'const ratio = object.return / 2;',
      'const otherRatio = object.if(true) / 2;',
      'const meta = import.meta.url;',
      'export { help };',
    ].join('\n')
    expect(() => verifyPagesAssetReferences(site({ 'assets/app.js': js }))).not.toThrow()
  })

  it.each([
    'import "https://outside.example/module.js";',
    'import value from "https://outside.example/module.js";',
    'import { value } from "//outside.example/module.js";',
    'export * from "https://outside.example/module.js";',
    'export { value } from "https://outside.example/module.js";',
    'import("https://outside.example/module.js");',
    'import(`https://outside.example/module.js`);',
    'import("https://static.cloudflareinsights.com/beacon.min.js");',
    'import "./missing.js";',
    'import "react";',
    'import "/assets/dep.js";',
    'import "../../escape.js";',
    'import "data:text/javascript,export default 1";',
    String.raw`import "./d\u0065p.js";`,
    'import("./dep.js" + suffix);',
    'import(moduleUrl);',
    'import(`./${moduleName}.js`);',
    'const result = `${import("https://outside.example/module.js")}`;',
    'const result = 10 / import("https://outside.example/module.js");',
    'const value = function(){} / import("https://outside.example/module.js") / 2;',
    'const value = object.return / import("external-module") / 2;',
    'const value = object.if(true) / import("external-module") / 2;',
  ])('rejects external, absent or computed ESM dependencies: %s', (js) => {
    expect(() => verifyPagesAssetReferences(site({ 'assets/app.js': js }))).toThrow(
      /Pages asset references/,
    )
  })

  it.each(['\r', '\u2028', '\u2029'])(
    'does not swallow imports after a line comment terminated by %j',
    (terminator) => {
      const js = `// harmless comment${terminator}import("https://outside.example/module.js");`
      expect(() => verifyPagesAssetReferences(site({ 'assets/app.js': js }))).toThrow(
        /Pages asset references/,
      )
    },
  )

  it.each(['\u00a0', '\u2028', '\u2029'])(
    'recognizes module keywords separated by Unicode whitespace %j',
    (whitespace) => {
      for (const js of [
        `import${whitespace}("https://outside.example/module.js");`,
        `export${whitespace}* from "https://outside.example/module.js";`,
      ]) {
        expect(() => verifyPagesAssetReferences(site({ 'assets/app.js': js }))).toThrow(
          /Pages asset references/,
        )
      }
    },
  )

  it('does not include the rejected dependency or its private query in diagnostics', () => {
    const privateValue = 'deployment-input-must-not-be-logged'
    let diagnostic = ''
    try {
      verifyPagesAssetReferences(
        site({ 'assets/app.js': `import "https://outside.example/module.js?${privateValue}";` }),
      )
    } catch (error) {
      diagnostic = (error as Error).message
    }
    expect(diagnostic).toMatch(/Pages asset references/)
    expect(diagnostic).not.toContain(privateValue)
    expect(diagnostic).not.toContain('outside.example')
  })
})
