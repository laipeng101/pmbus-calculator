import type { ReactNode } from 'react'

interface Props {
  primary: ReactNode
  secondary: ReactNode
}

export default function WorkspaceLayout({ primary, secondary }: Props) {
  const hasSecondary = secondary != null
  return (
    <div className={hasSecondary ? 'workspace-layout workspace-layout-split' : 'workspace-layout'}>
      <div className="primary-panel">{primary}</div>
      {hasSecondary && <div className="secondary-panel">{secondary}</div>}
    </div>
  )
}
