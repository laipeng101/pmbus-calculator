import type { ReactNode } from 'react'

interface Props {
  primary: ReactNode
  secondary: ReactNode
}

export default function WorkspaceLayout({ primary, secondary }: Props) {
  return (
    <div className="workspace-layout">
      <div className="primary-panel">{primary}</div>
      <div className="secondary-panel">{secondary}</div>
    </div>
  )
}
