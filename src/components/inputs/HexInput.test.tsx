// HexInput 步进器组件合同（v3.1.0）。
//
// 锁定 +1/-1 步进的核心语义：范围由 maxDigits 推导（16 位 0x0000..0xFFFF、
// 8 位 0x00..0xFF）、边界真实 disabled、永不回绕；合法草稿以草稿值为基值，
// 空/非法过渡草稿以最后 committed value 为基值；每次激活只经现有 onCommit
// 提交一次，步进后 blur 是严格 no-op；步进按钮以 preventDefault 阻止焦点
// 转移（真实浏览器中的 blur/click 竞态由 Playwright E2E 覆盖）。
//
// 渲染使用真实 react-dom/client + act，不 mock 组件内部。

import { StrictMode, act } from 'react'
import { useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import HexInput from './HexInput'
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

interface SetupOptions {
  initial?: string
  maxDigits?: number
  stepper?: boolean
  ariaLabel?: string
}

function setup({
  initial = '0000',
  maxDigits = 4,
  stepper = true,
  ariaLabel = '测试十六进制字段',
}: SetupOptions = {}) {
  const commits: string[] = []
  let setValueFromHost: ((v: string) => void) | null = null

  function Host() {
    const [value, setValue] = useState(initial)
    setValueFromHost = setValue
    return (
      <StrictMode>
        <HexInput
          id="test-hex"
          value={value}
          maxDigits={maxDigits}
          ariaLabel={ariaLabel}
          fixedPrefix="0x"
          stepper={stepper}
          onCommit={(text) => {
            commits.push(text)
            setValue(text)
          }}
        />
      </StrictMode>
    )
  }

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  act(() => {
    root.render(<Host />)
  })

  const input = () => container.querySelector('#test-hex') as HTMLInputElement
  const up = () =>
    container.querySelector('[data-testid="test-hex-step-up"]') as HTMLButtonElement | null
  const down = () =>
    container.querySelector('[data-testid="test-hex-step-down"]') as HTMLButtonElement | null

  const fire = (el: Element, type: string) => {
    act(() => {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }))
    })
  }

  const typeText = (text: string) => {
    const el = input()
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    act(() => {
      setter?.call(el, text)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  return {
    commits,
    container,
    input,
    up,
    down,
    fire,
    typeText,
    setValue: (v: string) => act(() => setValueFromHost?.(v)),
    cleanup: () => {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

describe('HexInput stepper', () => {
  const cleanups: Array<() => void> = []
  function setupTracked(options?: SetupOptions) {
    const h = setup(options)
    cleanups.push(h.cleanup)
    return h
  }
  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.()
  })

  it('渲染带上下文可访问名的 +1/-1 按钮', () => {
    const h = setupTracked({ ariaLabel: 'Raw Word（16 位原始字）' })
    expect(h.up()?.getAttribute('aria-label')).toBe('Raw Word（16 位原始字）增加 1')
    expect(h.down()?.getAttribute('aria-label')).toBe('Raw Word（16 位原始字）减少 1')
    expect(h.up()?.getAttribute('type')).toBe('button')
    expect(h.down()?.getAttribute('type')).toBe('button')
  })

  it('0000 加 1 到 0001，再减 1 回 0000，输出大写固定位宽补零', () => {
    const h = setupTracked({ initial: '0000' })
    h.fire(h.up()!, 'click')
    expect(h.commits).toEqual(['0001'])
    expect(h.input().value).toBe('0001')
    h.fire(h.down()!, 'click')
    expect(h.commits).toEqual(['0001', '0000'])
    expect(h.input().value).toBe('0000')
  })

  it('FFFF 上界：+1 真实 disabled、不回绕', () => {
    const h = setupTracked({ initial: 'FFFF' })
    expect(h.up()!.disabled).toBe(true)
    h.fire(h.up()!, 'click')
    expect(h.commits).toEqual([])
    expect(h.input().value).toBe('FFFF')
    h.fire(h.down()!, 'click')
    expect(h.commits).toEqual(['FFFE'])
  })

  it('0000 下界：-1 真实 disabled、不回绕', () => {
    const h = setupTracked({ initial: '0000' })
    expect(h.down()!.disabled).toBe(true)
    h.fire(h.down()!, 'click')
    expect(h.commits).toEqual([])
    h.fire(h.up()!, 'click')
    expect(h.commits).toEqual(['0001'])
  })

  it('8 位字段（maxDigits=2）：FF 上界与补零格式', () => {
    const h = setupTracked({ initial: 'FE', maxDigits: 2 })
    h.fire(h.up()!, 'click')
    expect(h.commits).toEqual(['FF'])
    expect(h.up()!.disabled).toBe(true)
    h.fire(h.down()!, 'click')
    expect(h.commits).toEqual(['FF', 'FE'])
    h.setValue('01')
    expect(h.down()!.disabled).toBe(false)
    h.fire(h.down()!, 'click')
    expect(h.commits).toEqual(['FF', 'FE', '00'])
    expect(h.down()!.disabled).toBe(true)
  })

  it('合法草稿以草稿解析值为步进基值（000A +1 → 000B）', () => {
    const h = setupTracked({ initial: '0000' })
    act(() => h.input().focus())
    h.typeText('000A')
    expect(h.commits).toEqual(['000A'])
    h.fire(h.up()!, 'click')
    expect(h.commits).toEqual(['000A', '000B'])
    expect(h.input().value).toBe('000B')
  })

  it('空过渡草稿以 committed 值为基值并补齐规范位宽', () => {
    const h = setupTracked({ initial: '00FF' })
    act(() => h.input().focus())
    h.typeText('')
    expect(h.commits).toEqual([])
    h.fire(h.up()!, 'click')
    expect(h.commits).toEqual(['0100'])
    expect(h.input().value).toBe('0100')
  })

  it('非法草稿以 committed 值为基值，步进后清除错误', () => {
    const h = setupTracked({ initial: '0005' })
    act(() => h.input().focus())
    h.typeText('ZZ')
    expect(h.input().getAttribute('aria-invalid')).toBe('true')
    h.fire(h.up()!, 'click')
    expect(h.commits).toEqual(['0006'])
    expect(h.input().getAttribute('aria-invalid')).toBeNull()
    expect(h.input().value).toBe('0006')
  })

  it('步进后 blur 不二次提交（事务被消费）', () => {
    const h = setupTracked({ initial: '0005' })
    act(() => h.input().focus())
    // 输入与 committed 不同的合法草稿：每次合法 onChange 都会即时提交。
    h.typeText('0009')
    expect(h.commits).toEqual(['0009'])
    h.fire(h.up()!, 'click')
    expect(h.commits).toEqual(['0009', '000A'])
    act(() => h.input().blur())
    expect(h.commits).toEqual(['0009', '000A'])
  })

  it('pointerdown / mousedown 阻止焦点转移（blur/click 竞态根因）', () => {
    const h = setupTracked()
    const seen: boolean[] = []
    const record = (e: Event) => seen.push(e.defaultPrevented)
    h.container.addEventListener('pointerdown', record)
    h.container.addEventListener('mousedown', record)
    const btn = h.up()!
    act(() => {
      btn.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }))
    })
    act(() => {
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    })
    // 两个事件都先经过 React 的根监听器并调用 preventDefault
    expect(seen).toEqual([true, true])
    h.container.removeEventListener('pointerdown', record)
    h.container.removeEventListener('mousedown', record)
  })

  it('未启用 stepper 时渲染为普通输入，无步进按钮', () => {
    const h = setupTracked({ stepper: false })
    expect(h.up()).toBeNull()
    expect(h.down()).toBeNull()
    expect(h.input().className).not.toContain('hex-field-input')
  })
})
