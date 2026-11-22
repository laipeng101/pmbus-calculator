import type { VoutModeAnalysis } from '../legacy/vout-mode'
import { resolveVoutModeRequirement } from './vout-mode-requirements'

export interface VoutModeExplanation {
  id: string
  severity: 'info' | 'warning' | 'error'
  /** Chinese-primary title; canonical tokens stay verbatim (Part II §8.3 …). */
  title: string
  /** Chinese-primary detail; no English translation paragraph. */
  detail: string
  specRef: string
}

export const SLINEAR16_OFFSET_BIT7_NOTE =
  'SLINEAR16 表示有符号电压偏移。第 7 位不参与偏移量的计算，也无需标称电压。'

function explanation(
  id: string,
  severity: VoutModeExplanation['severity'],
  title: string,
  detail: string,
  specRef: string,
): VoutModeExplanation {
  return { id, severity, title, detail, specRef }
}

/**
 * 「说明」用规范出处解释配置的含义和下一步操作。是否需要额外数据由
 * resolveVoutModeRequirement 判断，指数与 VID 代码直接取自字节解析。
 */
export function buildVoutModeExplanations(a: VoutModeAnalysis): VoutModeExplanation[] {
  const out: VoutModeExplanation[] = []
  const req = resolveVoutModeRequirement(a)

  out.push(
    explanation(
      'ar-command-scope',
      'info',
      '第 7 位：绝对值或相对值',
      '第 7 位决定 VOUT_MARGIN_HIGH/LOW、VOUT_OV/UV_FAULT/WARN_LIMIT、POWER_GOOD_ON/OFF 采用绝对电压还是比值。VOUT_COMMAND 提供标称电压。',
      'Part II §8.5',
    ),
  )

  if (a.format === 0) {
    const n = a.linearExponent ?? 0
    out.push(
      explanation(
        'linear-exponent',
        'info',
        'LINEAR：N = ' + n,
        `第 4 至 0 位给出二补码指数 N（−16～15）。ULINEAR16 用 Y_u × 2^N 换算，SLINEAR16 用 Y_s × 2^N 换算电压偏移。${
          req.id === 'linear-absolute' ? '可用 LINEAR16 换算绝对电压。' : ''
        }`,
        'Part II §8.3 / §8.4.1',
      ),
    )
    if (req.id === 'linear-relative') {
      out.push(
        explanation(
          'relative-linear-ratio',
          'warning',
          '相对 LINEAR：比值为正',
          '按与 VOUT_COMMAND 相同的格式解码数据字，得到比值 R = Y_u × 2^N。比值必须大于 0。使用 LINEAR16 并提供 VOUT_COMMAND 标称参考值 V_NOM，即可计算电压 X = V_NOM × R。',
          'Part II §8.5.2',
        ),
      )
    }
  } else if (a.format === 1) {
    if (req.id === 'vid-relative-invalid') {
      out.push(
        explanation(
          'relative-vid-invalid',
          'error',
          'VID 不能使用相对值',
          'VID 只支持绝对值。请将第 7 位设为 0，或按器件手册选择其他格式。',
          'Part II §8.5.3',
        ),
      )
    } else if (a.vidCode) {
      const codeHex = a.vidCode.code.toString(16).toUpperCase().padStart(2, '0')
      if (req.id === 'vid-not-used') {
        out.push(
          explanation(
            'vid-not-used',
            'warning',
            'VID 代码类型 ' + codeHex + 'h：未使用',
            '请核对器件手册中的 VOUT_MODE 设置。',
            'Part II §8.4.2 Table 3',
          ),
        )
      } else if (req.id === 'vid-profile-required') {
        out.push(
          explanation(
            'vid-profile-required',
            'warning',
            'VID 代码类型 ' + codeHex + 'h：制造商自定义',
            '这是规范允许的配置。请查阅器件手册中的 VID 码表，查找数据字对应的电压。',
            'Part II §8.4.2 Table 3',
          ),
        )
      } else if (req.id === 'vid-reserved-listed') {
        const reason = a.vidCode?.reservedReason
        out.push(
          explanation(
            'vid-reserved-listed',
            'warning',
            'VID 代码类型 ' + codeHex + 'h：保留（表 3 明列）',
            reason
              ? `${reason}。当前配置无法换算电压，请核对器件的 VOUT_MODE。`
              : '当前配置无法换算电压，请核对器件的 VOUT_MODE。',
            'Part II §8.4.2 Table 3',
          ),
        )
      } else if (req.id === 'vid-reserved-unlisted') {
        out.push(
          explanation(
            'vid-reserved-unlisted',
            'warning',
            'VID 代码类型 ' + codeHex + 'h：保留（表 3 未列出）',
            '规范将未列出的类型保留供未来使用。当前配置无法换算电压，请核对器件的 VOUT_MODE。',
            'Part II §8.4.2 Table 3',
          ),
        )
      }
    }
  } else if (req.id === 'direct-or-half-param-invalid') {
    // DIRECT (2) / IEEE Half (3) with a non-zero parameter (§8.3 Table 2).
    out.push(
      explanation(
        'nonlinear-param-invalid',
        'error',
        a.formatName + ' 参数必须为 0',
        'DIRECT 和 IEEE Half 要求第 4 至 0 位为 00000b。请核对器件的格式和参数位。',
        'Part II §8.3 Table 2',
      ),
    )
  } else if (req.id === 'direct-absolute' || req.id === 'direct-relative') {
    // DIRECT needs device-specific coefficients (Part II §7.4 / §8.4.3).
    out.push(
      explanation(
        'direct-profile-required',
        'warning',
        'DIRECT：换算需要器件系数',
        req.requiresNominalReference
          ? '从 COEFFICIENTS 或器件手册取得 m/b/R 系数，按器件规定的数据格式换算出比值。相对值必须为正，乘以 VOUT_COMMAND 标称参考值可得到电压（§8.5.2）。'
          : '从 COEFFICIENTS 或器件手册取得 m/b/R 系数，再按器件规定的数据格式换算。',
        'Part II §7.4 / §8.4.3',
      ),
    )
  } else if (req.id === 'half-absolute' || req.id === 'half-relative') {
    // IEEE Half is standard binary16 (Part II §7.6 / §8.4.4): no device
    // numbers are involved in the word ↔ value conversion.
    out.push(
      explanation(
        'half-standard-format',
        'warning',
        'IEEE Half：标准 binary16',
        req.requiresNominalReference
          ? '在 HALF 模式页按标准 IEEE 754 binary16 解码出比值。相对值必须为正，乘以 VOUT_COMMAND 标称参考值可得到电压（§8.5.2）。'
          : '可在 HALF 模式页按标准 IEEE 754 binary16 换算。第 15 位是符号，第 14 至 10 位是指数，第 9 至 0 位是尾数。',
        'Part II §7.6 / §8.4.4',
      ),
    )
  }

  return out
}
