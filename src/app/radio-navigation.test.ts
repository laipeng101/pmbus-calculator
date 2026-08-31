import { describe, expect, it } from 'vitest'
import { findRadioNeighbor, radioArrowDirection, radioTabStop } from './radio-navigation'

const noneDisabled = () => false

describe('radioArrowDirection', () => {
  it.each([
    ['ArrowRight', 'next'],
    ['ArrowDown', 'next'],
    ['ArrowLeft', 'previous'],
    ['ArrowUp', 'previous'],
  ])('maps %s to %s', (key, direction) => {
    expect(radioArrowDirection(key)).toBe(direction)
  })

  it.each(['Home', 'End', ' ', 'Enter', 'Escape', 'a'])('returns null for %s', (key) => {
    expect(radioArrowDirection(key)).toBeNull()
  })
})

describe('findRadioNeighbor', () => {
  it('walks forward and wraps at the end', () => {
    expect(findRadioNeighbor(4, 0, 'next', noneDisabled)).toBe(1)
    expect(findRadioNeighbor(4, 3, 'next', noneDisabled)).toBe(0)
  })

  it('walks backward and wraps at the start', () => {
    expect(findRadioNeighbor(4, 2, 'previous', noneDisabled)).toBe(1)
    expect(findRadioNeighbor(4, 0, 'previous', noneDisabled)).toBe(3)
  })

  it('skips disabled radios in both directions', () => {
    const disabled = (i: number) => i === 1 || i === 2
    expect(findRadioNeighbor(4, 0, 'next', disabled)).toBe(3)
    expect(findRadioNeighbor(4, 3, 'previous', disabled)).toBe(0)
  })

  it('wraps past a trailing disabled radio', () => {
    const disabled = (i: number) => i === 3
    expect(findRadioNeighbor(4, 2, 'next', disabled)).toBe(0)
  })

  it('returns -1 when every other radio is disabled', () => {
    const disabled = (i: number) => i !== 0
    expect(findRadioNeighbor(2, 0, 'next', disabled)).toBe(-1)
    expect(findRadioNeighbor(2, 0, 'previous', disabled)).toBe(-1)
  })

  it('returns -1 for a single-radio group and out-of-range current', () => {
    expect(findRadioNeighbor(1, 0, 'next', noneDisabled)).toBe(-1)
    expect(findRadioNeighbor(2, -1, 'next', noneDisabled)).toBe(-1)
    expect(findRadioNeighbor(2, 2, 'next', noneDisabled)).toBe(-1)
    expect(findRadioNeighbor(0, 0, 'next', noneDisabled)).toBe(-1)
  })
})

describe('radioTabStop', () => {
  it('places the stop on the selected radio', () => {
    expect(radioTabStop(4, 2, noneDisabled)).toBe(2)
  })

  it('falls back to the first enabled radio when the selection is disabled', () => {
    // raw 相对 + VID 组合：选中项（index 1）disabled，绝对值（index 0）兜底。
    const disabled = (i: number) => i === 1
    expect(radioTabStop(2, 1, disabled)).toBe(0)
  })

  it('falls back to the first enabled radio for an out-of-range selection', () => {
    expect(radioTabStop(2, -1, noneDisabled)).toBe(0)
    expect(radioTabStop(2, 5, noneDisabled)).toBe(0)
  })

  it('returns -1 when nothing is enabled', () => {
    expect(radioTabStop(2, 0, () => true)).toBe(-1)
    expect(radioTabStop(0, 0, noneDisabled)).toBe(-1)
  })
})
