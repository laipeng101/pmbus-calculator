/**
 * Editable-context detection for global keyboard shortcuts.
 *
 * Ctrl+1..4 must not fire while the user is typing in any real-world editing
 * context: input / textarea / select elements, contenteditable regions and
 * custom widgets exposed via role=textbox / role=combobox.  Attribute-based
 * checks (instead of HTMLElement.isContentEditable) keep this testable in
 * jsdom and still cover inherited contenteditable through ancestor matching.
 */

const EDITABLE_ANCESTOR_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
  '[role="textbox"]',
  '[role="combobox"]',
].join(', ')

export function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  const editable = target.getAttribute('contenteditable')
  if (editable === '' || editable === 'true' || editable === 'plaintext-only') return true
  return target.closest(EDITABLE_ANCESTOR_SELECTOR) != null
}
