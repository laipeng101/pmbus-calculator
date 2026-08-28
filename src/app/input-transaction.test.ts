import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createEditTransaction, useEditTransaction } from './input-transaction'

describe('createEditTransaction', () => {
  it('reports an untouched focus session as no-commit', () => {
    const tx = createEditTransaction()
    expect(tx.shouldCommitOnBlur()).toBe(false)
  })

  it('commits after a real onChange transaction and consumes the dirty flag', () => {
    const tx = createEditTransaction()
    tx.markDirty()
    expect(tx.shouldCommitOnBlur()).toBe(true)
    // The flag is consumed: the next untouched blur must not commit again.
    expect(tx.shouldCommitOnBlur()).toBe(false)
  })

  it('tracks per-focus-session dirty state across many edits', () => {
    const tx = createEditTransaction()
    tx.markDirty()
    tx.markDirty()
    tx.markDirty()
    expect(tx.shouldCommitOnBlur()).toBe(true)
    expect(tx.shouldCommitOnBlur()).toBe(false)
    tx.markDirty()
    expect(tx.shouldCommitOnBlur()).toBe(true)
    expect(tx.shouldCommitOnBlur()).toBe(false)
  })

  it('transactions are independent per input instance', () => {
    const a = createEditTransaction()
    const b = createEditTransaction()
    a.markDirty()
    expect(b.shouldCommitOnBlur()).toBe(false)
    expect(a.shouldCommitOnBlur()).toBe(true)
  })
})

describe('useEditTransaction', () => {
  let container: HTMLElement | null = null
  let root: Root | null = null
  let latest: ReturnType<typeof useEditTransaction> | null = null

  function Probe() {
    latest = useEditTransaction()
    return null
  }

  beforeAll(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterAll(() => {
    if (root && container) {
      root.unmount()
      container.remove()
    }
  })

  it('keeps one stable transaction instance across re-renders', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement(Probe))
    })
    const first = latest
    expect(first).not.toBeNull()
    await act(async () => {
      root?.render(createElement(Probe))
    })
    expect(latest).toBe(first)
    // Dirty state survives re-renders (a per-render instance would lose it).
    first?.markDirty()
    expect(latest?.shouldCommitOnBlur()).toBe(true)
  })
})
