import { useEffect, useState } from 'react'
import { parseHexStrict } from '../../app/hex-parse'

interface Props {
  id: string
  value: string
  maxDigits: number
  placeholder?: string
  ariaLabel: string
  className?: string
  style?: React.CSSProperties
  onCommit: (text: string) => void
}

/**
 * Controlled hexadecimal input sharing the unified editing model:
 *
 * - 过渡 draft（`0x`、部分输入）暂存，不被 committed 值强行重置；
 * - 非法文本（`1G`、超长、裸 `0x`）不修改 committed state，并显示字段级
 *   唯一可见错误；blur 不静默回滚，非法 draft 保留；
 * - 空输入 blur 归一化为 0。reducer 仍通过 `raw/set-from-hex` /
 *   `l16/set-vout-mode` 拥有全局校验。
 */
export default function HexInput({
  id,
  value,
  maxDigits,
  placeholder,
  ariaLabel,
  className,
  style,
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
    const text = trimmed === '' ? '0' : trimmed
    const parsed = parseHexStrict(text, maxDigits)
    if (!parsed.ok) {
      // Keep the invalid draft visible together with its error.
      setError(parsed.error)
    } else {
      setError(null)
      setDraft(text)
      onCommit(text)
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
        style={style}
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
        <p
          id={`${id}-error`}
          role="alert"
          className="mt-1 text-xs"
          style={{ color: 'var(--color-danger)' }}
        >
          {error}
        </p>
      )}
    </div>
  )
}
