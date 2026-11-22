export const HALF_SPECIAL_SPEC_REF = 'Part II §7.6.2'

export interface HalfSpecialSemantics {
  id: 'half-nan' | 'half-positive-infinity' | 'half-negative-infinity'
  title: string
  write: string
  read: string
}

const HALF_NAN: HalfSpecialSemantics = {
  id: 'half-nan',
  title: 'NaN（非数值）',
  write: '设备期待数值时，会将 NaN 判为无效数据，并按 §10.8 报告通信故障。',
  read: '设备可用 NaN 表示数值不可用。',
}

const HALF_POSITIVE_INFINITY: HalfSpecialSemantics = {
  id: 'half-positive-infinity',
  title: '+Infinity（正无穷）',
  write: '设备按正满量程处理。',
  read: '在测量结果中，表示通道在正方向饱和。',
}

const HALF_NEGATIVE_INFINITY: HalfSpecialSemantics = {
  id: 'half-negative-infinity',
  title: '-Infinity（负无穷）',
  write: '设备按负满量程处理。',
  read: '在测量结果中，表示通道在负方向饱和。',
}

/** Explain what a PMBus device does with the encoded special value. */
export function resolveHalfSpecialSemantics(value: number): HalfSpecialSemantics | undefined {
  if (Number.isNaN(value)) return HALF_NAN
  if (value === Infinity) return HALF_POSITIVE_INFINITY
  if (value === -Infinity) return HALF_NEGATIVE_INFINITY
  return undefined
}
