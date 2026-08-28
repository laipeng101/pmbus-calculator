import { useRef } from 'react'

/**
 * Shared edit-transaction detector for the numeric inputs (v2.5.7).
 *
 * Dirty is tracked by real onChange transactions inside the current focus
 * session — never by comparing parsed values (`NaN !== NaN`, `-0`, and
 * alternate textual forms like `1.0` vs `1` would all misreport). An
 * untouched focus/blur (no onChange at all) must be a strict no-op: it must
 * not call onCommit, rewrite raw or parameters, clear provenance, or drop a
 * still-visible field error (DOMAIN_MODEL §6.1 / UI_CONVENTIONS §8).
 */

export interface EditTransaction {
  /** Record a real onChange edit in the current focus session. */
  markDirty(): void
  /**
   * Consume the transaction at blur/Enter: `true` when at least one onChange
   * happened since the last consume, `false` for an untouched focus session.
   */
  shouldCommitOnBlur(): boolean
}

export function createEditTransaction(): EditTransaction {
  let dirty = false
  return {
    markDirty() {
      dirty = true
    },
    shouldCommitOnBlur() {
      const dirtyNow = dirty
      dirty = false
      return dirtyNow
    },
  }
}

/** React binding: one transaction instance per mounted input. */
export function useEditTransaction(): EditTransaction {
  const ref = useRef<EditTransaction | null>(null)
  if (ref.current === null) {
    ref.current = createEditTransaction()
  }
  return ref.current
}
