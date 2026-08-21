// Tailwind source-scope canary (M17).
//
// This file deliberately lives OUTSIDE the production Tailwind scan scope:
// `src/styles/tokens.css` registers only `@source '../'` (minus `*.test.ts`),
// so nothing under `tests/` is a candidate source. The exported utility below
// is a unique arbitrary-value class that product sources never use.
// `scripts/check-tailwind-scope.mjs` parses this single source of truth and
// fails the build gate if the utility shows up in the compiled `dist/` CSS —
// which is exactly what happens if Tailwind ever falls back to scanning
// non-production files again.
//
// If you change this value, pick another unique arbitrary value that appears
// nowhere under `src/`; the gate fails on any collision.
export const TAILWIND_SOURCE_CANARY_UTILITY = 'w-[77.125rem]'
