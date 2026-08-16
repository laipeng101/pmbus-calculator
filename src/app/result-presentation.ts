/**
 * Presentation-only helpers for the result panel.
 *
 * These functions are intentionally pure so they can be unit-tested in jsdom
 * without mounting React. They never change PMBus math or copy output.
 */

export type ResultValueSizeClass = 'xl' | 'lg' | 'md' | 'sm'

/** Predictable mono font-size step for the result headline value. */
export function getResultValueSizeClass(valueText: string): ResultValueSizeClass {
  const length = valueText.length
  if (length <= 8) return 'xl'
  if (length <= 12) return 'lg'
  if (length <= 16) return 'md'
  return 'sm'
}

export type QuantizationKind = 'ok' | 'warn' | 'error'

/** Map quantization-error severity to a semantic CSS token. */
export function getQuantizationTextColorToken(kind: QuantizationKind): string {
  switch (kind) {
    case 'ok':
      return 'var(--color-success-text)'
    case 'warn':
      return 'var(--color-warning-text)'
    case 'error':
      return 'var(--color-danger-text)'
  }
}

/** Copy label for the primary Hex button; reflects the current copy endianness. */
export function getCopyHexLabel(endian: 'le' | 'be'): string {
  return endian === 'be' ? 'Hex（BE）' : 'Hex（LE）'
}
