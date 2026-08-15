/**
 * Copy utilities — text-building and clipboard access.
 *
 * Kept outside components so the copy format and clipboard fallback are unit
 * testable in jsdom without mounting React.
 */

/** Normalize a PMBus command key into a safe C macro identifier fragment. */
export function sanitizeMacroName(value: string | null | undefined): string {
  if (!value) return 'RAW_VALUE'
  const cleaned = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!cleaned) return 'RAW_VALUE'
  if (/^[0-9]/.test(cleaned)) return `CMD_${cleaned}`
  return cleaned
}

/** Build a C macro for the un-swapped 16-bit raw word. */
export function buildCMacro(
  name: string | null | undefined,
  rawWordHex: string,
  formula: string,
): string {
  return `#define ${sanitizeMacroName(name)} ${rawWordHex} /* ${formula} */`
}

export async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  // Fallback for non-secure contexts / older browsers.
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const ok = document.execCommand('copy')
  textarea.remove()
  if (!ok) throw new Error('copy rejected')
}
