/**
 * Half special-value operational semantics — single display source for how a
 * PMBus device must treat NaN / ±Infinity per Part II §7.6.2 (v2.5.5).
 *
 * The IEEE 754 binary16 MATH (encode/decode, §7.6) is unchanged and lives in
 * `PMBusMath.decodeHalf` / `encodeHalf`. This layer only answers the PMBus
 * OPERATIONAL question the calculator must explain: what a device does when it
 * receives such a word as written data, and what it means when a device
 * returns it as a read-back value:
 *
 * - The device shall return the exact IEEE-754 encoding the host sent,
 *   including NaN / +Inf / -Inf encodings (write-read round trip is lossless).
 * - NaN received while expecting a numeric value → invalid data +
 *   communications fault, responded to per §10.8. A device may return NaN
 *   when the value is not available.
 * - +Inf received → positive full scale. -Inf received → negative full scale.
 * - +Inf / -Inf returned → measurement channel saturated in the positive /
 *   negative direction.
 *
 * The resolver is total and pure. Finite values (including ±0) classify as
 * `half-finite` with `presentable: false` — the UI must not show any
 * special-value notice for them. The card always lists BOTH interpretations;
 * it never guesses the actual command direction of a bus transaction, and it
 * never claims a communication has taken place.
 */

export type HalfSpecialId =
  | 'half-finite'
  | 'half-nan'
  | 'half-positive-infinity'
  | 'half-negative-infinity'

export interface HalfSpecialSemantics {
  /** Stable machine-testable discriminator. */
  id: HalfSpecialId
  /** UI severity for the notice; 'none' is never rendered. */
  severity: 'warning' | 'none'
  /** True only for NaN / ±Infinity, the values §7.6.2 regulates. */
  presentable: boolean
  /** Short headline for the notice card. */
  title: string
  /**
   * Scoping line: PMBus device behaviour, not an observed bus transaction,
   * and not a change to the binary16 math.
   */
  scopeNote: string
  /** Meaning when the device receives this word as written data. */
  send: string
  /** Meaning when the device returns this word as a read-back value. */
  read: string
  /** Spec anchor for the operational clauses. */
  specRef: string
}

const SPEC_REF = 'Part II §7.6.2'

const SCOPE_NOTE =
  '以下是 PMBus 规范对设备的操作语义（§7.6.2），不代表本页已发生任何总线通信；' +
  'binary16 数学换算本身保持不变。设备读回主机先前写入的值时，必须返回主机发送的精确 IEEE 编码' +
  '（包括 NaN、+Inf、-Inf）。'

const HALF_FINITE: HalfSpecialSemantics = {
  id: 'half-finite',
  severity: 'none',
  presentable: false,
  title: '有限数值',
  scopeNote: SCOPE_NOTE,
  send: '普通有限数值按 IEEE 754 binary16 正常解释。',
  read: '普通有限数值按 IEEE 754 binary16 正常读回。',
  specRef: SPEC_REF,
}

const HALF_NAN: HalfSpecialSemantics = {
  id: 'half-nan',
  severity: 'warning',
  presentable: true,
  title: 'NaN：设备按无效数据处理',
  scopeNote: SCOPE_NOTE,
  send:
    '作为写入数据：设备收到 NaN 且期待数值时，必须当作 invalid data、声明 communications fault，' +
    '并按 §10.8 响应。不要把 NaN 当作普通数值写入设备。',
  read: '作为设备读回值：设备可以在值不可用时返回 NaN。',
  specRef: SPEC_REF,
}

const HALF_POSITIVE_INFINITY: HalfSpecialSemantics = {
  id: 'half-positive-infinity',
  severity: 'warning',
  presentable: true,
  title: '+Infinity：正满量程语义',
  scopeNote: SCOPE_NOTE,
  send: '作为写入数据：设备将收到的 +Inf 解释为正满量程（positive full-scale）。',
  read: '作为设备读回值：表示测量通道正方向饱和（positive saturation）。',
  specRef: SPEC_REF,
}

const HALF_NEGATIVE_INFINITY: HalfSpecialSemantics = {
  id: 'half-negative-infinity',
  severity: 'warning',
  presentable: true,
  title: '-Infinity：负满量程语义',
  scopeNote: SCOPE_NOTE,
  send: '作为写入数据：设备将收到的 -Inf 解释为负满量程（negative full-scale）。',
  read: '作为设备读回值：表示测量通道负方向饱和（negative saturation）。',
  specRef: SPEC_REF,
}

/**
 * Total resolver over the IEEE 754 binary16 value space. NaN and ±Infinity
 * map to their §7.6.2 send/read interpretations; every finite value
 * (including ±0) maps to the non-presentable finite verdict.
 */
export function resolveHalfSpecialSemantics(value: number): HalfSpecialSemantics {
  if (Number.isNaN(value)) return HALF_NAN
  if (value === Number.POSITIVE_INFINITY) return HALF_POSITIVE_INFINITY
  if (value === Number.NEGATIVE_INFINITY) return HALF_NEGATIVE_INFINITY
  return HALF_FINITE
}
