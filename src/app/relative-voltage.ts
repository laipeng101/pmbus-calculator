export type RelativeVoltageResult =
  | { kind: 'missing-reference' }
  | { kind: 'finite'; value: number }
  | { kind: 'overflow' }
  | { kind: 'underflow' }

export const RELATIVE_VOLTAGE_RANGE_NOTE = {
  overflow: '计算结果太大，超出可表示范围',
  underflow: '计算下溢，非零结果太小，按计算精度会舍入为 0',
} as const

// 标称参考值和比值由上游保证为非负有限数。只有两个非零因子的乘积舍入为零才是计算下溢。
export function resolveRelativeVoltage(
  nominal: number | null,
  ratio: number,
): RelativeVoltageResult {
  if (nominal === null) return { kind: 'missing-reference' }
  const product = nominal * ratio
  if (Number.isFinite(product)) {
    if (product === 0 && nominal !== 0 && ratio !== 0) return { kind: 'underflow' }
    return { kind: 'finite', value: product }
  }
  return { kind: 'overflow' }
}
