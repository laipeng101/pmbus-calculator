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
  /** Mode bits [6:5]: 0=LINEAR, 1=VID, 2=DIRECT, 3=IEEE Half Float. */
  mode: number
  modeName: string
  /** Bit 7: true = relative (needs a reference value), false = absolute. */
  isRelative: boolean
  /** Parameter bits [4:0]. */
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
    return ((this.fromSigned(n, 5) & 0x1f) << 11) | (this.fromSigned(y, 11) & 0x7ff)
  },

  /** Largest positive value representable as LINEAR11: 1023 × 2^15. */
  maxLinear11(): number {
    return 1023 * this.pow2(15)
  },

  /** Most negative value representable as LINEAR11: -1024 × 2^15. */
  minLinear11(): number {
    return -1024 * this.pow2(15)
  },

  /**
   * LINEAR11 representable range for a fixed N: Y ∈ [-1024, 1023] ⇒
   * X ∈ [-1024 × 2^N, 1023 × 2^N].  Used to judge saturation when the
   * exponent is locked (autoN=false); the auto-N encoder saturates at the
   * global N=15 extremes instead (maxLinear11/minLinear11).
   */
  linear11RangeForN(n: number): { min: number; max: number } {
    const p = this.pow2(n)
    return { min: -1024 * p, max: 1023 * p }
  },

  /** Find best N/Y for a given physical value */
  findBestLinear11(val: number): BestLinear11Result {
    // Saturation: a hardware calculator must never encode an out-of-range
    // value as 0x0000 (N=0,Y=0). Clamp to the extreme LINEAR11 code instead,
    // and keep the large delta visible to the user.
    const maxVal = this.maxLinear11()
    const minVal = this.minLinear11()
    if (val >= maxVal) {
      return { n: 15, y: 1023, value: maxVal, delta: val - maxVal }
    }
    if (val <= minVal) {
      return { n: 15, y: -1024, value: minVal, delta: val - minVal }
    }

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

  /** LINEAR16: voltage = V × 2^N (V is 16-bit unsigned, N from VOUT_MODE). */
  decodeLinear16(raw: number, n: number): Linear16Result {
    return { v: raw, n, value: raw * this.pow2(n) }
  },

  encodeLinear16(v: number, _n: number): number {
    return this.clamp(v, 0, 65535)
  },

  /**
   * ULINEAR16 payload (Part II §8.4.1): X = Y_u × 2^N where Y_u is the
   * unsigned 16-bit integer 0..65535.  In Relative mode the same payload is a
   * dimensionless positive ratio R = Y_u × 2^N; the caller applies V_NOM.
   */
  decodeUlinear16(raw: number, n: number): Linear16Result {
    return { v: raw, n, value: raw * this.pow2(n) }
  },

  /**
   * ULINEAR16 encode from a physical value / ratio: Y_u = round(X / 2^N),
   * clamped to 0..65535 (the established rounding contract).
   */
  encodeUlinear16(value: number, n: number): number {
    return this.clamp(Math.round(value / this.pow2(n)), 0, 65535)
  },

  /**
   * SLINEAR16 offset payload (Part II §13.3 VOUT_TRIM / §13.4 VOUT_CAL_OFFSET):
   * X_offset = Y_s × 2^N where Y_s is the signed two's-complement 16-bit
   * integer -32768..32767.  bit7 of VOUT_MODE is NOT part of this payload's
   * math; it belongs to another command group's global behavior.
   */
  decodeSlinear16(raw: number, n: number): { y: number; n: number; value: number } {
    const y = this.toSigned(raw, 16)
    return { y, n, value: y * this.pow2(n) }
  },

  /** SLINEAR16 encode: Y_s = round(X / 2^N), clamped to -32768..32767. */
  encodeSlinear16(value: number, n: number): number {
    return this.fromSigned(this.clamp(Math.round(value / this.pow2(n)), -32768, 32767), 16)
  },

  /** DIRECT: X = (1/m) × (Y × 10^(-R) – b) */
  decodeDirect(y: number, m: number, b: number, R: number): DirectResult {
    if (m === 0) return { value: NaN }
    return { value: (1 / m) * (y * Math.pow(10, -R) - b) }
  },

  encodeDirect(value: number, m: number, b: number, R: number): number {
    return this.clamp(Math.round((m * value + b) * Math.pow(10, R)), -32768, 32767)
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

    // Values above (max finite + half ulp) round to infinity per IEEE 754.
    // Max finite binary16 = (1 + 1023/1024) × 2^15 = 65504; half ulp = 16.
    if (value >= 65520) return sign | 0x7c00

    const roundHalfEven = (x: number): number => {
      const floor = Math.floor(x)
      const frac = x - floor
      if (frac > 0.5) return floor + 1
      if (frac < 0.5) return floor
      return floor % 2 === 0 ? floor : floor + 1
    }

    let exp = Math.floor(Math.log2(value)) + 15
    let mant: number

    if (exp <= 0) {
      // Subnormal range (|value| < 2^-14). One subnormal ulp = 2^-24.
      exp = 0
      mant = roundHalfEven(value * 16777216)
      if (mant >= 1024) {
        // Rounded up to the smallest normal value.
        exp = 1
        mant = 0
      }
    } else {
      mant = roundHalfEven((value / this.pow2(exp - 15) - 1) * 1024)
      if (mant >= 1024) {
        mant = 0
        exp += 1
        if (exp >= 31) return sign | 0x7c00
      }
    }

    return sign | (exp << 10) | (mant & 0x03ff)
  },

  /**
   * Parse VOUT_MODE byte per PMBus Part II §8.3.
   *
   * Bit layout: bit7 = absolute/relative, bits[6:5] = mode,
   * bits[4:0] = parameter.  Earlier code mixed bit7 into the mode field
   * ((byte >> 5) & 0x07); the mode is only two bits wide.
   */
  parseVoutMode(byte: number): VoutModeResult {
    byte = byte & 0xff
    const isRelative = (byte & 0x80) !== 0
    const modeBits = (byte >> 5) & 0x03
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
      isRelative,
      param: paramBits,
      linearExponent: n,
      description:
        'VOUT_MODE per PMBus Part II §8.3 (bit7=absolute/relative, bits6:5=mode, bits4:0=parameter)',
    }
  },

  /**
   * Check special values (overflow, zero, etc.).
   *
   * Y=1023 and Y=-1024 are legal LINEAR11 boundary codes, not natural
   * saturation markers.  Saturation is only reported by the view-model when a
   * user-entered physical value falls outside the representable range and the
   * encoder actually saturated; the raw code itself is never flagged here.
   */
  checkSpecial(_raw: number, _mode: string): SpecialCheck | null {
    return null
  },

  /** SMBus PEC (CRC-8) per SMBus 3.0 Section 5.4 */
  calculatePEC(bytes: number[] | Uint8Array): number {
    let crc = 0
    for (const b of bytes) {
      crc ^= b & 0xff
      for (let i = 0; i < 8; i++) {
        crc = crc & 0x80 ? (crc << 1) ^ 0x07 : crc << 1
        crc &= 0xff
      }
    }
    return crc
  },
} as const
