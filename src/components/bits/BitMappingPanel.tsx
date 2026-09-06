import type { ReactNode } from 'react'
import { ChevronDownIcon, ChevronUpIcon } from '../icons/Icon'

interface Props {
  id: 'raw-word' | 'vout-mode'
  label: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}

/** A visible, keyboard-operable disclosure; preference ownership stays in AppState. */
export default function BitMappingPanel({ id, label, open, onToggle, children }: Props) {
  const toggleId = `bit-mapping-${id}-toggle`
  const contentId = `bit-mapping-${id}-content`
  return (
    <section className="bit-mapping-panel" aria-labelledby={toggleId}>
      <h4>
        <button
          type="button"
          id={toggleId}
          data-testid={toggleId}
          className="bit-mapping-toggle"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={onToggle}
        >
          <span>位映射 · {label}</span>
          <span className="flex items-center gap-1 color-text-muted">
            {open ? '收起' : '展开'}
            {open ? <ChevronUpIcon size={16} /> : <ChevronDownIcon size={16} />}
          </span>
        </button>
      </h4>
      <div id={contentId} hidden={!open} className="bit-mapping-content">
        {children}
      </div>
    </section>
  )
}
