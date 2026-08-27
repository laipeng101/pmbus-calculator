import type { VoutModeAnalysis } from '../legacy/vout-mode'

export interface VoutModeExplanation {
  id: string
  severity: 'info' | 'warning' | 'error'
  /** Chinese-primary title; canonical tokens stay verbatim (Part II §8.3 …). */
  title: string
  /** Chinese-primary detail; no English translation paragraph. */
  detail: string
  specRef: string
}

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
 * Chinese-primary, structured VOUT_MODE explanation source.
 *
 * This is presentation data with a stable machine id, severity and spec
 * reference. Components render the single Chinese title/detail and never
 * decide what a byte means themselves. Canonical English tokens (LINEAR, VID,
 * VOUT_COMMAND …) are kept verbatim and explained by the glossary term layer,
 * never by an inline English translation paragraph.
 */
export function buildVoutModeExplanations(a: VoutModeAnalysis): VoutModeExplanation[] {
  const out: VoutModeExplanation[] = []

  out.push(
    explanation(
      'ar-command-scope',
      'info',
      'bit7：绝对值 / 相对值',
      'bit7 只决定 §8.5 所列 8 个输出电压相关命令（VOUT_MARGIN_HIGH/LOW、VOUT_OV/UV_FAULT/WARN_LIMIT、POWER_GOOD_ON/OFF）的绝对/相对语义；VOUT_COMMAND 本身是标称参考。',
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
        'bits[4:0] 是 5 位二补码指数 N（−16～15），当前 N=' +
          n +
          '，缩放因子 2^N。ULINEAR16 为 X = Y_u × 2^N V；SLINEAR16 offset 为 X_offset = Y_s × 2^N V。',
        'Part II §8.3 / §8.4.1',
      ),
    )
    if (a.isRelative) {
      out.push(
        explanation(
          'relative-linear-ratio',
          'warning',
          '相对 LINEAR：比值为正',
          '此字节结构合法。相对模式下 payload 与 VOUT_COMMAND 同格式，解出无量纲正比例 R = Y_u × 2^N；最终电压 X = V_NOM × R。ratio=0 时规范要求相对值为正，标记为非符合性。',
          'Part II §8.5.2',
        ),
      )
    }
  } else if (a.format === 1) {
    if (a.isRelative) {
      out.push(
        explanation(
          'relative-vid-invalid',
          'error',
          '相对 VID 非法',
          'bit7=1 与 VID 格式不能组合（Part II §8.5.3：相对不适用于 VID）。这是非法组合，不是相对 LINEAR。',
          'Part II §8.5.3',
        ),
      )
    } else if (a.vidCode) {
      const codeHex = a.vidCode.code.toString(16).toUpperCase().padStart(2, '0')
      if (a.vidCode.kind === 'not-used') {
        out.push(
          explanation(
            'vid-not-used',
            'warning',
            'VID code ' + codeHex + 'h：未使用',
            'VID Code Type 00h 表示未使用；不构成有效 VID profile。',
            'Part II §8.4.2 Table 3',
          ),
        )
      } else if (a.vidCode.kind === 'profile-required') {
        out.push(
          explanation(
            'vid-profile-required',
            'warning',
            'VID code ' + codeHex + 'h：制造商自定义',
            '1Eh/1Fh 是 PMBus 器件制造商专用 code，必须有器件资料才能确定电压映射；本计算器不猜测。',
            'Part II §8.4.2 Table 3',
          ),
        )
      } else {
        out.push(
          explanation(
            'vid-reserved',
            'warning',
            'VID code ' + codeHex + 'h：保留',
            '该 VID Code Type 保留（01h..04h 留给未来 Intel、10h..11h 留给未来 AMD、1Ch..1Dh 保留未来使用，其余未列出 code 也保留）；不得当作有通用电压映射的 profile。',
            'Part II §8.4.2 Table 3',
          ),
        )
      }
    }
  } else {
    // DIRECT (2) / IEEE Half (3)
    if (a.status === 'invalid-parameter') {
      out.push(
        explanation(
          'nonlinear-param-invalid',
          'error',
          a.formatName + ' 参数必须为 0',
          'DIRECT / IEEE Half 的 bits[4:0] 必须为 00000b；非零参数是非法结构。',
          'Part II §8.3 Table 2',
        ),
      )
    } else if (a.format === 2) {
      // DIRECT needs device-specific coefficients (Part II §7.4 / §8.4.3).
      out.push(
        explanation(
          'direct-profile-required',
          'warning',
          'DIRECT：结构合法，需要器件 m/b/R 系数',
          a.isRelative
            ? '相对 DIRECT 且参数为 0 的字节结构合法；word ↔ 物理量需要器件 m/b/R 系数（来自 COEFFICIENTS 或器件资料），最终电压还需 VOUT_COMMAND 标称参考值。本计算器不内置任何系数。'
            : 'DIRECT 参数为 0 的字节结构合法；word ↔ 物理量需要器件 m/b/R 系数（来自 COEFFICIENTS 或器件资料）。本计算器不内置任何系数。',
          'Part II §7.4 / §8.4.3',
        ),
      )
    } else {
      // IEEE Half is standard binary16 (Part II §7.6 / §8.4.4): no device
      // numbers are involved in the word ↔ value conversion.
      out.push(
        explanation(
          'half-standard-format',
          'warning',
          'IEEE Half：标准 binary16，本页只配置格式字节',
          a.isRelative
            ? '相对 Half 且参数为 0 的字节结构合法；payload 是标准 IEEE 754 binary16（bit15 符号、bits[14:10] 指数、bits[9:0] 尾数），换算不需要任何器件系数。相对阈值要得到最终电压还需 VOUT_COMMAND 标称参考值（§8.5.2）。'
            : 'Half 参数为 0 的字节结构合法；payload 是标准 IEEE 754 binary16（bit15 符号、bits[14:10] 指数、bits[9:0] 尾数），word ↔ 数值换算不需要任何器件系数。HALF 模式页可完成该换算。',
          'Part II §7.6 / §8.4.4',
        ),
      )
    }
  }

  return out
}
