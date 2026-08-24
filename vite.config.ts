/// <reference types="vitest/config" />
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

export default defineConfig({
  base: './',
  plugins: [tailwindcss(), react(), productionCspPlugin()],
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
