import { useReducer, useEffect } from 'react'
import { appReducer, INITIAL_STATE } from './app/reducer'
import { useCalculatorViewModel } from './app/view-model'
import AppHeader from './components/layout/AppHeader'
import WorkspaceLayout from './components/layout/WorkspaceLayout'
import ModeSwitcher from './components/mode/ModeSwitcher'
import ModeWorkspace from './components/mode/ModeWorkspace'
import CommandPicker from './components/command/CommandPicker'
import ResultInspector from './components/result/ResultInspector'
import InfoPanel from './components/result/InfoPanel'

function App() {
  const [state, dispatch] = useReducer(appReducer, INITIAL_STATE)
  const vm = useCalculatorViewModel(state)

  // Keyboard shortcuts for mode switching
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return
      switch (e.key) {
        case '1':
          dispatch({ type: 'mode/set', mode: 'L11' })
          e.preventDefault()
          break
        case '2':
          dispatch({ type: 'mode/set', mode: 'L16' })
          e.preventDefault()
          break
        case '3':
          dispatch({ type: 'mode/set', mode: 'DIRECT' })
          e.preventDefault()
          break
        case '4':
          dispatch({ type: 'mode/set', mode: 'HALF' })
          e.preventDefault()
          break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ background: 'var(--color-bg)' }}
    >
      <AppHeader />

      <ModeSwitcher
        mode={state.mode}
        onChange={(mode) => dispatch({ type: 'mode/set', mode })}
      />

      <CommandPicker
        commandKey={state.commandKey}
        onChange={(key) => dispatch({ type: 'command/set', commandKey: key })}
      />

      <WorkspaceLayout
        primary={
          <ModeWorkspace
            mode={state.mode}
            state={state}
            vm={vm}
            dispatch={dispatch}
          />
        }
        secondary={
          <div className="space-y-4">
            <ResultInspector vm={vm} />
            <InfoPanel warnings={vm.warnings} />
          </div>
        }
      />
    </div>
  )
}

export default App
