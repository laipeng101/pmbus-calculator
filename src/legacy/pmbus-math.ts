/**
 * PMBus Math Core — migrated from pmbus-calculator.html
 *
 * Phase 1: mechanical migration only. Do not rewrite algorithms.
 * All golden-case behavior must be preserved.
 */

export interface Linear11Result {
  n: number
  y: number
  value: number
}

export interface Linear16Result {
  v: number
  n: number
  value: number
}

export interface DirectResult {
  value: number
}

export interface HalfResult {
  value: number
}

export interface VoutModeResult {
  byte: number
  mode: number
  modeName: string
  param: number
  linearExponent: number | 'IEEE Half' | null
  description: string
}

export interface SpecialCheck {
  type: 'overflow' | 'info'
  msg: string
}

export interface BestLinear11Result {
  n: number
  y: number
  value: number
  delta: number
}

export const PMBusMath = {
  toSigned(value: number, bits: number): number {
    const max = 1 << bits
    return value >= max / 2 ? value - max : value
  },

  fromSigned(value: number, bits: number): number {
    const max = 1 << bits
    return value < 0 ? value + max : value
  },

  clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value))
  },

  swapBytes(v: number): number {
    return ((v & 0xff) << 8) | ((v >> 8) & 0xff)
  },

  /** 2^N cache — performance optimization to avoid repeated Math.pow */
  pow2Cache: new Map<number, number>(),

  pow2(n: number): number {
    if (this.pow2Cache.has(n)) return this.pow2Cache.get(n)!
    let p: number
    // JS bitwise ops are 32-bit; 1 << 31 overflows. Fall back to Math.pow
    // for edge cases to prevent hidden bugs during testing / future extension.
    if (Number.isInteger(n) && n >= 0 && n < 31) p = 1 << n
    else if (Number.isInteger(n) && n < 0 && n > -31) p = 1 / (1 << -n)
    else p = Math.pow(2, n)
    this.pow2Cache.set(n, p)
    return p
  },

  /** LINEAR11: X = Y × 2^N (N is 5-bit signed, Y is 11-bit signed) */
  decodeLinear11(raw: number): Linear11Result {
    const n = this.toSigned((raw >> 11) & 0x1f, 5)
    const y = this.toSigned(raw & 0x7ff, 11)
    return { n, y, value: y * this.pow2(n) }
  },

  encodeLinear11(n: number, y: number): number {
    n = this.clamp(n, -16, 15)
    y = this.clamp(y, -1024, 1023)
    return (
      ((this.fromSigned(n, 5) & 0x1f) << 11) | (this.fromSigned(y, 11) & 0x7ff)
    )
  },

  /** Find best N/Y for a given physical value */
  findBestLinear11(val: number): BestLinear11Result {
    let bestN = 0
    let bestY = 0
    let bestErr = Infinity
    let bestVal = val
    for (let n = -16; n <= 15; n++) {
      const p = this.pow2(n)
      const y = Math.round(val / p)
      if (y < -1024 || y > 1023) continue
      const represented = y * p
      const err = Math.abs(val - represented)
      if (
        err < bestErr - 1e-15 ||
        (Math.abs(err - bestErr) < 1e-15 && Math.abs(n) < Math.abs(bestN))
      ) {
        bestErr = err
        bestN = n
        bestY = y
        bestVal = represented
      }
    }
    return { n: bestN, y: bestY, value: bestVal, delta: val - bestVal }
  },

  /** LINEAR16: voltage = V × 2^N (V is 16-bit unsigned, N from VOUT_MODE) */
  decodeLinear16(raw: number, n: number): Linear16Result {
    return { v: raw, n, value: raw * this.pow2(n) }
  },

  encodeLinear16(v: number, _n: number): number {
    return this.clamp(v, 0, 65535)
  },

  /** DIRECT: X = (1/m) × (Y × 10^(-R) – b) */
  decodeDirect(y: number, m: number, b: number, R: number): DirectResult {
    if (m === 0) return { value: NaN }
    return { value: (1 / m) * (y * Math.pow(10, -R) - b) }
  },

  encodeDirect(value: number, m: number, b: number, R: number): number {
    return this.clamp(
      Math.round((m * value + b) * Math.pow(10, R)),
      -32768,
      32767,
    )
  },

  /** IEEE 754 half-precision float (binary16) */
  decodeHalf(raw: number): HalfResult {
    const sign = (raw >> 15) & 1 ? -1 : 1
    const exp = (raw >> 10) & 0x1f
    const mant = raw & 0x03ff
    if (exp === 0) {
      if (mant === 0) return { value: sign * 0 }
      return { value: sign * (mant / 1024) * this.pow2(-14) }
    } else if (exp === 31) {
      if (mant === 0) return { value: sign * Infinity }
      return { value: NaN }
    }
    return { value: sign * (1 + mant / 1024) * this.pow2(exp - 15) }
  },

  encodeHalf(value: number): number {
    if (isNaN(value)) return 0x7e00
    const sign = value < 0 || Object.is(value, -0) ? 0x8000 : 0
    value = Math.abs(value)
    if (value === 0) return sign
    if (!isFinite(value)) return sign | 0x7c00
    let exp = Math.floor(Math.log2(value)) + 15
    let mant = (value / this.pow2(exp - 15) - 1) * 1024
    let raw: number
    if (exp <= 0) {
      // Subnormal
      exp = 0
      mant = Math.round(value * this.pow2(14) * 1024)
      if (mant > 0x3ff) mant = 0x3ff
      raw = sign | (mant & 0x03ff)
    } else if (exp >= 31) {
      raw = sign | 0x7c00
    } else {
      mant = Math.round(mant)
      if (mant >= 1024) {
        mant = 0
        exp += 1
        if (exp >= 31) {
          raw = sign | 0x7c00
        } else {
          raw = sign | (exp << 10)
        }
      } else {
        raw = sign | (exp << 10) | (mant & 0x03ff)
      }
    }
    return raw
  },

  /** Parse VOUT_MODE byte per PMBus 1.3 Section 8.3 */
  parseVoutMode(byte: number): VoutModeResult {
    byte = byte & 0xff
    const modeBits = (byte >> 5) & 0x07
    const paramBits = byte & 0x1f
    const modeNames: Record<number, string> = {
      0: 'LINEAR',
      1: 'VID',
      2: 'DIRECT',
      3: 'IEEE Half Float',
    }
    let n: number | 'IEEE Half' | null = null
    if (modeBits === 0) {
      n = this.toSigned(paramBits, 5)
    } else if (modeBits === 3) {
      n = 'IEEE Half'
    }
    return {
      byte,
      mode: modeBits,
      modeName: modeNames[modeBits] || '保留',
      param: paramBits,
      linearExponent: n,
      description: 'VOUT_MODE per PMBus 1.3 Part I Section 8.3',
    }
  },

  /** Check special values (overflow, zero, etc.) */
  checkSpecial(raw: number, mode: string): SpecialCheck | null {
    if (mode === 'L11') {
      const y = this.toSigned(raw & 0x7ff, 11)
      if (y === 1023 || y === -1024)
        return {
          type: 'overflow',
          msg: 'Y 接近极值 (±1023/±1024)，可能是饱和/溢出标记',
        }
      if (y === 0)
        return { type: 'info', msg: 'Y = 0，表示零值或未初始化' }
    }
    return null
  },

  /** SMBus PEC (CRC-8) per SMBus 3.0 Section 5.4 */
  calculatePEC(bytes: number[] | Uint8Array): number {
    let crc = 0
    for (const b of bytes) {
      crc ^= b & 0xff
      for (let i = 0; i < 8; i++) {
        crc = crc & 0x80 ? ((crc << 1) ^ 0x07) : crc << 1
        crc &= 0xff
      }
    }
    return crc
  },
} as const
