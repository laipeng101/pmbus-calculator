import { useEffect, useState } from 'react'
import { isTransitionalIntegerText, parseIntegerStrict } from '../../app/int-parse'

interface Props {
  id: string
  value: number
  placeholder?: string
  ariaLabel: string
  className?: string
  style?: React.CSSProperties
  onCommit: (text: string) => void
}

/**
 * Controlled decimal integer input (L16 V) sharing the unified editing model:
 *
 * - 过渡态（空串、单独正负号）暂存，不逐键报错；
 * - 非法文本（`12abc`、`1e2`、`1.5`、`+`）不修改 committed state，并显示
 *   字段级唯一可见错误；blur 不静默回滚，非法 draft 保留；
 * - 空输入 blur 归一化为 0；超范围由 reducer 按既有 clamp 合同处理。
 */
export default function DecimalInput({
  id,
  value,
  placeholder,
  ariaLabel,
  className,
  style,
  onCommit,
}: Props) {
  const [draft, setDraft] = useState(String(value))
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!editing && !error) setDraft(String(value))
  }, [value, editing, error])

  const handleChange = (text: string) => {
    setDraft(text)
    if (isTransitionalIntegerText(text)) {
      setError(null)
      return
    }
    const parsed = parseIntegerStrict(text)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    setError(null)
    onCommit(text)
  }

  const handleBlur = () => {
    const trimmed = draft.trim()
    // Normalize unfinished states (empty / lone sign) to 0.
    const text = isTransitionalIntegerText(trimmed) ? '0' : trimmed
    const parsed = parseIntegerStrict(text)
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
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        value={editing || error ? draft : String(value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={className}
        style={style}
        onFocus={() => setEditing(true)}
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
