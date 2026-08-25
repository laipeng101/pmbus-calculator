/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
// M32 WP-C: test/coverage shape comes from the shared constants module --
// vite.config.ts and vitest.coverage.config.ts consume ONE source (no copied
// lists that can drift).
import {
  BASE_TEST_EXCLUDE,
  COVERAGE_EXCLUDE,
  COVERAGE_SCOPE_INCLUDE,
  COVERAGE_THRESHOLDS,
} from './scripts/vitest-shared-config.mjs'

/**
 * Inject a production CSP meta tag into the build only. It restricts runtime
 * resource origins, but style-src currently allows 'unsafe-inline' because
 * Tailwind and runtime styles require inline style elements.
 * Dev mode is left untouched so Vite HMR / React Refresh keep working.
 */
function productionCspPlugin(): Plugin {
  return {
    name: 'inject-production-csp',
    apply: 'build',
    transformIndexHtml(html) {
      const csp = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self' data:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; ')
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
      )
    },
  }
}

// Build-time version badge source: package.json is the single version of
// truth; the app never maintains a hand-edited copy of the version string.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [tailwindcss(), react(), productionCspPlugin()],
  build: {
    rollupOptions: {
      output: {
        // Split stable third-party code out of the application bundle. This
        // keeps the initial app chunk below Vite's 500 kB advisory limit and
        // gives dependency-only changes long-lived cache entries.
        manualChunks(id) {
          if (id.includes('node_modules/katex')) return 'katex'
          if (
            id.includes('node_modules/react') ||
            id.includes('node_modules/react-dom') ||
            id.includes('node_modules/scheduler') ||
            id.includes('node_modules/@floating-ui')
          ) {
            return 'react-vendor'
          }
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    exclude: [...BASE_TEST_EXCLUDE],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [...COVERAGE_SCOPE_INCLUDE],
      thresholds: { ...COVERAGE_THRESHOLDS },
      exclude: [...COVERAGE_EXCLUDE],
    },
  },
})
