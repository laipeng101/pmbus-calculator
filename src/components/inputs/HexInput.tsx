import { useEffect, useState } from 'react'
import { parseHexStrict } from '../../app/hex-parse'

interface Props {
  id: string
  value: string
  maxDigits: number
  placeholder?: string
  ariaLabel: string
  className?: string
  onCommit: (text: string) => void
}

/** Transitional hex drafts (empty / bare 0x) that must not commit or error while typing. */
function isTransitionalHex(input: string): boolean {
  const trimmed = input.trim()
  return trimmed === '' || /^0x$/i.test(trimmed)
}

/**
 * Controlled hexadecimal input sharing the unified editing model:
 *
 * - 过渡 draft（空串、裸 0x）在聚焦编辑中暂存，不修改 committed state，也不立刻报错；
 * - 非法文本（GG、12zz、超长）保持字段级唯一错误，不修改 raw/result/formula；
 * - 空串 blur/Enter 规范化为 0；裸 0x blur/Enter 后显示“输入不完整”，非法 draft 保留；
 * - 合法修正后错误、ARIA 与旧 draft 同时清除。reducer 仍通过
 *   raw/set-from-hex / l16/set-vout-mode 拥有全局校验。
 */
export default function HexInput({
  id,
  value,
  maxDigits,
  placeholder,
  ariaLabel,
  className,
  onCommit,
}: Props) {
  const [draft, setDraft] = useState(value)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!editing && !error) setDraft(value)
  }, [value, editing, error])

  const handleChange = (text: string) => {
    setDraft(text)
    if (isTransitionalHex(text)) {
      setError(null)
      return
    }
    const parsed = parseHexStrict(text, maxDigits)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    setError(null)
    onCommit(text)
  }

  const handleBlur = () => {
    const trimmed = draft.trim()
    if (trimmed === '') {
      // Empty input normalizes to 0 (a defined completion, not a silent rollback).
      setError(null)
      setDraft('0')
      onCommit('0')
      setEditing(false)
      return
    }
    const parsed = parseHexStrict(trimmed, maxDigits)
    if (!parsed.ok) {
      // Keep the invalid draft visible together with its error.
      setError(parsed.error)
    } else {
      setError(null)
      setDraft(trimmed)
      onCommit(trimmed)
    }
    setEditing(false)
  }

  return (
    <div className="min-w-0 flex-1">
      <input
        id={id}
        type="text"
        inputMode="text"
        autoComplete="off"
        spellCheck={false}
        value={editing || error ? draft : value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={className}
        onFocus={(e) => {
          setEditing(true)
          e.target.select()
        }}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs color-danger">
          {error}
        </p>
      )}
    </div>
  )
}
