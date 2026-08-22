import { describe, it, expect } from 'vitest'
import { isEditableEventTarget } from './editable-target'

function mount(html: string): Element {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.appendChild(host)
  return host
}

describe('isEditableEventTarget', () => {
  it('flags input, textarea and select elements', () => {
    const host = mount('<input id="a" /><textarea id="b"></textarea><select id="c"></select>')
    for (const id of ['a', 'b', 'c']) {
      expect(isEditableEventTarget(document.getElementById(id)), id).toBe(true)
    }
    host.remove()
  })

  it('flags contenteditable regions including inherited children', () => {
    const host = mount(
      '<div contenteditable="true" id="ce"><span id="ce-child">text</span></div>' +
        '<div contenteditable="" id="ce-empty"></div>',
    )
    expect(isEditableEventTarget(document.getElementById('ce'))).toBe(true)
    expect(isEditableEventTarget(document.getElementById('ce-child'))).toBe(true)
    expect(isEditableEventTarget(document.getElementById('ce-empty'))).toBe(true)
    host.remove()
  })

  it('does not flag contenteditable="false"', () => {
    const host = mount('<div contenteditable="false" id="ce-false">text</div>')
    expect(isEditableEventTarget(document.getElementById('ce-false'))).toBe(false)
    host.remove()
  })

  it('flags role=textbox and role=combobox widgets and their children', () => {
    const host = mount(
      '<div role="textbox" id="tb"><span id="tb-child">x</span></div>' +
        '<div role="combobox" id="cb"></div>',
    )
    expect(isEditableEventTarget(document.getElementById('tb'))).toBe(true)
    expect(isEditableEventTarget(document.getElementById('tb-child'))).toBe(true)
    expect(isEditableEventTarget(document.getElementById('cb'))).toBe(true)
    host.remove()
  })

  it('does not flag buttons, headings, body or non-element targets', () => {
    const host = mount('<button id="btn">b</button><h1 id="h">h</h1>')
    expect(isEditableEventTarget(document.getElementById('btn'))).toBe(false)
    expect(isEditableEventTarget(document.getElementById('h'))).toBe(false)
    expect(isEditableEventTarget(document.body)).toBe(false)
    expect(isEditableEventTarget(null)).toBe(false)
    expect(isEditableEventTarget(window)).toBe(false)
    host.remove()
  })
})
