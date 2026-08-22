import { describe, it, expect, afterEach } from 'vitest'
import { findTabNeighbor } from './focus-navigation'

const hosts: HTMLElement[] = []

function mount(html: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.appendChild(host)
  hosts.push(host)
  return host
}

function byId(id: string): HTMLElement {
  const el = document.getElementById(id)
  if (el == null) throw new Error(`missing #${id}`)
  return el
}

afterEach(() => {
  for (const host of hosts.splice(0)) host.remove()
})

describe('findTabNeighbor', () => {
  it('returns the next and previous tabbable elements in DOM order', () => {
    mount(`
      <button id="a">a</button>
      <input id="b" />
      <select id="c"><option>x</option></select>
      <textarea id="d"></textarea>
      <a id="e" href="#">e</a>
    `)
    expect(findTabNeighbor(byId('b'), 1)?.id).toBe('c')
    expect(findTabNeighbor(byId('b'), -1)?.id).toBe('a')
    expect(findTabNeighbor(byId('d'), 1)?.id).toBe('e')
  })

  it('does not wrap: null before the first and after the last candidate', () => {
    mount(`
      <button id="a">a</button>
      <button id="b">b</button>
    `)
    expect(findTabNeighbor(byId('a'), -1)).toBeNull()
    expect(findTabNeighbor(byId('b'), 1)).toBeNull()
  })

  it('skips disabled controls and tabindex="-1" elements', () => {
    mount(`
      <button id="a">a</button>
      <button id="b" disabled>b</button>
      <button id="c" tabindex="-1">c</button>
      <input id="d" disabled />
      <button id="e">e</button>
    `)
    expect(findTabNeighbor(byId('a'), 1)?.id).toBe('e')
  })

  it('excludes an entire subtree such as a portal popup', () => {
    const host = mount(`
      <button id="trigger">t</button>
      <button id="after">after</button>
    `)
    const popup = document.createElement('div')
    popup.innerHTML = '<input id="popup-input" /><button id="popup-btn">p</button>'
    host.appendChild(popup)
    expect(findTabNeighbor(byId('trigger'), 1)?.id).toBe('after')
    expect(findTabNeighbor(byId('after'), 1)?.id).toBe('popup-input')
    expect(findTabNeighbor(byId('trigger'), 1, popup)?.id).toBe('after')
    expect(findTabNeighbor(byId('after'), 1, popup)).toBeNull()
  })

  it('returns null for an anchor that is not itself tabbable', () => {
    mount(`
      <div id="plain">x</div>
      <button id="b">b</button>
    `)
    expect(findTabNeighbor(byId('plain'), 1)).toBeNull()
    expect(findTabNeighbor({} as HTMLElement, 1)).toBeNull()
  })
})
