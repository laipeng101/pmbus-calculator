/**
 * Copy utilities — text-building and clipboard access.
 *
 * Kept outside components so the copy format and clipboard fallback are unit
 * testable in jsdom without mounting React.
 */

/** Build a C macro for the un-swapped 16-bit raw word. */
export function buildCMacro(rawWordHex: string, formula: string): string {
  return `#define RAW_VALUE ${rawWordHex} /* ${formula} */`
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
