import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const releaseFixtureCsp =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'"

export function writeReleaseSite(root: string): string {
  const site = path.join(root, '_site')
  mkdirSync(path.join(site, 'assets'), { recursive: true })
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '3.3.0' }))
  writeFileSync(
    path.join(site, 'index.html'),
    `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${releaseFixtureCsp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>PMBus fixture</title>
    <script type="module" crossorigin src="./assets/app.js"></script>
    <link rel="stylesheet" crossorigin href="./assets/app.css">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`,
  )
  writeFileSync(path.join(site, 'assets', 'app.js'), 'export {}\n')
  writeFileSync(path.join(site, 'assets', 'app.css'), 'body { color: black; }\n')
  return site
}
