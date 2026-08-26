import type { VoutModeAnalysis } from '../legacy/vout-mode'

export interface BilingualText {
  zh: string
  en: string
}

export interface VoutModeExplanation {
  id: string
  severity: 'info' | 'warning' | 'error'
  title: BilingualText
  detail: BilingualText
  specRef: string
}

function bt(zh: string, en: string): BilingualText {
  return { zh, en }
}

function explanation(
  id: string,
  severity: VoutModeExplanation['severity'],
  title: BilingualText,
  detail: BilingualText,
  specRef: string,
): VoutModeExplanation {
  return { id, severity, title, detail, specRef }
}

/**
 * Bilingual, structured VOUT_MODE explanation source.
 *
 * This is presentation data with a stable machine id, severity and spec
 * reference. Components render zh and en side by side; they never decide what
 * a byte means themselves.
 */
export function buildVoutModeExplanations(a: VoutModeAnalysis): VoutModeExplanation[] {
  const out: VoutModeExplanation[] = []

  out.push(
    explanation(
      'ar-command-scope',
      'info',
      bt('bit7：Absolute / Relative', 'bit7: Absolute / Relative'),
      bt(
        'bit7 只决定 §8.5 所列 8 个输出电压相关命令（VOUT_MARGIN_HIGH/LOW、VOUT_OV/UV_FAULT/WARN_LIMIT、POWER_GOOD_ON/OFF）的绝对/相对语义；VOUT_COMMAND 本身是标称参考。',
        'bit7 selects absolute/relative behavior only for the eight output-voltage commands in §8.5 (VOUT_MARGIN_HIGH/LOW, VOUT_OV/UV_FAULT/WARN_LIMIT, POWER_GOOD_ON/OFF); VOUT_COMMAND itself is the nominal reference.',
      ),
      'Part II §8.5',
    ),
  )

  if (a.format === 0) {
    const n = a.linearExponent ?? 0
    out.push(
      explanation(
        'linear-exponent',
        'info',
        bt(`LINEAR：N = ${n}`, `LINEAR: N = ${n}`),
        bt(
          `bits[4:0] 是 5-bit 二补码指数 N（-16..15），当前 N=${n}，缩放因子 2^N。ULINEAR16 为 X = Y_u × 2^N V；SLINEAR16 offset 为 X_offset = Y_s × 2^N V。`,
          `bits[4:0] is the 5-bit two's-complement exponent N (-16..15); here N=${n} with scale 2^N. ULINEAR16 is X = Y_u × 2^N V; SLINEAR16 offset is X_offset = Y_s × 2^N V.`,
        ),
        'Part II §8.3 / §8.4.1',
      ),
    )
    if (a.isRelative) {
      out.push(
        explanation(
          'relative-linear-ratio',
          'warning',
          bt('相对 LINEAR：比值为正', 'Relative LINEAR: positive ratio'),
          bt(
            '此字节结构合法。相对模式下 payload 与 VOUT_COMMAND 同格式，解出无量纲正比例 R = Y_u × 2^N；最终电压 X = V_NOM × R。ratio=0 时规范要求 Relative value 为正，标记为非符合性。',
            'This byte is structurally legal. In relative mode the payload uses the same format as VOUT_COMMAND and decodes to a dimensionless positive ratio R = Y_u × 2^N; final voltage X = V_NOM × R. ratio=0 is non-compliant because the specification requires relative values to be positive.',
          ),
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
          bt('相对 VID 非法', 'Relative VID is invalid'),
          bt(
            'bit7=1 与 VID 格式不能组合（Part II §8.5.3：Relative 不适用于 VID）。这是非法组合，不是相对 LINEAR。',
            'bit7=1 cannot be combined with the VID format (Part II §8.5.3: Relative is not available for VID). This is an invalid combination, not relative LINEAR.',
          ),
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
            bt(`VID code ${codeHex}h：Not Used`, `VID code ${codeHex}h: Not Used`),
            bt(
              'VID Code Type 00h 表示未使用；不构成有效 VID profile。',
              'VID Code Type 00h means Not Used; it does not form a usable VID profile.',
            ),
            'Part II §8.4.2 Table 3',
          ),
        )
      } else if (a.vidCode.kind === 'profile-required') {
        out.push(
          explanation(
            'vid-profile-required',
            'warning',
            bt(`VID code ${codeHex}h：制造商自定义`, `VID code ${codeHex}h: manufacturer specific`),
            bt(
              '1Eh/1Fh 是 PMBus 器件制造商专用 code，必须有器件资料才能确定电压映射；本计算器不猜测。',
              '1Eh/1Fh are PMBus device manufacturer specific codes; device data is required to determine a voltage mapping. This calculator does not guess.',
            ),
            'Part II §8.4.2 Table 3',
          ),
        )
      } else {
        out.push(
          explanation(
            'vid-reserved',
            'warning',
            bt(`VID code ${codeHex}h：Reserved`, `VID code ${codeHex}h: Reserved`),
            bt(
              '该 VID Code Type 保留（01h..04h 留给未来 Intel、10h..11h 留给未来 AMD、1Ch..1Dh 保留未来使用，其余未列出 code 也保留）；不得当作有通用电压映射的 profile。',
              'This VID Code Type is reserved (01h..04h for future Intel, 10h..11h for future AMD, 1Ch..1Dh for future use; unlisted codes are also reserved). It must not be treated as a profile with a universal voltage mapping.',
            ),
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
          bt(`${a.formatName} 参数必须为 0`, `${a.formatName} parameter must be 0`),
          bt(
            'DIRECT / IEEE Half 的 bits[4:0] 必须为 00000b；非零参数是非法结构。',
            'DIRECT / IEEE Half require bits[4:0] = 00000b; a non-zero parameter is structurally invalid.',
          ),
          'Part II §8.3 Table 2',
        ),
      )
    } else {
      out.push(
        explanation(
          'nonlinear-profile-required',
          'warning',
          bt(
            `${a.formatName}：结构合法但本页不可计算`,
            `${a.formatName}: structurally legal, not calculable here`,
          ),
          bt(
            a.isRelative
              ? '相对 DIRECT/Half 且参数为 0 的字节结构可以成立，但需要器件系数/格式与 nominal reference；当前计算器不提供这些系数。'
              : 'DIRECT/Half 参数为 0 的字节结构合法，但需要器件系数（DIRECT m/b/R）或设备数据；当前计算器不提供。',
            a.isRelative
              ? 'A relative DIRECT/Half byte with parameter 0 is structurally legal, but device coefficients/format and a nominal reference are required; this calculator does not supply them.'
              : 'A DIRECT/Half byte with parameter 0 is structurally legal, but device coefficients (DIRECT m/b/R) or device data are required; this calculator does not supply them.',
          ),
          'Part II §8.3 Table 2 / §8.4.3 / §8.4.4',
        ),
      )
    }
  }

  return out
}
