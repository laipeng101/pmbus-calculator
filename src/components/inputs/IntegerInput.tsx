import { useEffect, useState } from 'react'
import { isTransitionalIntegerText, parseIntegerStrict } from '../../app/int-parse'

interface Props {
  id: string
  value: number
  disabled?: boolean
  placeholder?: string
  ariaLabel: string
  /**
   * 'clamp'（默认，用于 L11 N/Y、DIRECT Y）：语法合法即提交，超范围由
   * reducer 按既有合同 clamp。
   * 'reject'（用于 DIRECT m/b/R）：每次击键都提交，reducer 拒绝非法值并
   * 通过 stateError 提供按字段错误。
   */
  rangeBehavior?: 'clamp' | 'reject'
  /** Reducer 拥有的按字段错误（reject 模式），如 DIRECT 系数错误。 */
  stateError?: string | null
  className?: string
  onCommit: (text: string) => void
}

/**
 * Controlled integer input with a unified editing model:
 *
 * - 合法过渡态（空串、单独正负号）暂存，不逐键重置、不逐键报错；
 * - 非法文本（`1e2`、`1.5`、`12abc`、`0x10`、unsafe integer）不修改
 *   committed state / raw / 结果，并在字段下方显示唯一可见错误；
 * - blur 后非法 draft 保留并保持错误，不静默回滚；合法修正后错误、
 *   ARIA 状态与旧 draft 同时清除；
 * - `aria-invalid` 仅在字段确实非法时出现，`aria-describedby` 指向
 *   当前可见、唯一、真实存在的错误节点。
 */
export default function IntegerInput({
  id,
  value,
  disabled = false,
  placeholder,
  ariaLabel,
  rangeBehavior = 'clamp',
  stateError = null,
  className,
  onCommit,
}: Props) {
  const [draft, setDraft] = useState(String(value))
  const [editing, setEditing] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  // 过渡态击键期间不显示 reducer 错误，避免把未完成的输入当最终值逐键报错。
  const suppressStateError = editing && isTransitionalIntegerText(draft)
  const error = localError ?? (suppressStateError ? null : stateError)

  useEffect(() => {
    if (!editing && !error) setDraft(String(value))
  }, [value, editing, error])

  const handleChange = (text: string) => {
    setDraft(text)
    if (rangeBehavior === 'reject') {
      // The reducer owns validation for reject-mode fields; per-field errors
      // flow back through the stateError prop.
      setLocalError(null)
      onCommit(text)
      return
    }
    if (isTransitionalIntegerText(text)) {
      setLocalError(null)
      return
    }
    const parsed = parseIntegerStrict(text)
    if (!parsed.ok) {
      setLocalError(parsed.error)
      return
    }
    setLocalError(null)
    onCommit(text)
  }

  const handleBlur = () => {
    // Normalize unfinished states (empty / lone sign) to 0 — a defined
    // completion, not a silent rollback of an invalid final value.
    const trimmed = draft.trim()
    const text = isTransitionalIntegerText(trimmed) ? '0' : trimmed
    if (rangeBehavior === 'reject') {
      setDraft(text)
      onCommit(text)
      setEditing(false)
      return
    }
    const parsed = parseIntegerStrict(text)
    if (!parsed.ok) {
      // Keep the invalid draft visible together with its error.
      setLocalError(parsed.error)
    } else {
      setLocalError(null)
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
        disabled={disabled}
        value={editing || error ? draft : String(value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={className}
        onFocus={() => setEditing(true)}
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
