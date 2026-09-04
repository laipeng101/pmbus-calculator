import IntegerInput from '../inputs/IntegerInput'

interface Props {
  id: string
  value: number
  disabled?: boolean
  ariaLabel: string
  onCommit: (text: string) => void
}

/**
 * Compact signed-integer exponent editor. It is intentionally a thin wrapper
 * around IntegerInput: domain parsing, clamping and the draft/error contract
 * live in the reducer and the shared input component, never here.
 */
export default function ExponentEditor({ id, value, disabled, ariaLabel, onCommit }: Props) {
  return (
    <IntegerInput
      id={id}
      value={value}
      disabled={disabled}
      ariaLabel={ariaLabel}
      onCommit={onCommit}
      className="exponent-input input-field color-text-primary w-full rounded-md px-1.5 py-0 text-center text-sm font-bold outline-none disabled:opacity-60"
    />
  )
}
