/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Inject a strict CSP meta tag into the production build only.
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
  plugins: [tailwindcss(), react(), productionCspPlugin()],
  test: {
    globals: true,
    environment: 'jsdom',
    exclude: ['node_modules', 'dist', '.claude', 'everything-claude-code', 'tests/e2e'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/app/**/*.{ts,tsx}', 'src/legacy/**/*.{ts,tsx}'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
      exclude: [
        'node_modules/',
        'tests/',
        '**/*.test.ts',
        '**/*.test.tsx',
        'src/main.tsx',
        'src/App.tsx',
        'src/**/*.d.ts',
      ],
    },
  },
})
