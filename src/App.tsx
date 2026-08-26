import { useEffect, useReducer } from 'react'
import { appReducer, INITIAL_STATE } from './app/reducer'
import type { AppState } from './app/state'
import { useCalculatorViewModel } from './app/view-model'
import { isEditableEventTarget } from './app/editable-target'
import {
  loadPersistedState,
  persistByteOrder,
  persistCopy,
  persistMode,
  persistTheme,
} from './app/persistence'
import AppHeader from './components/layout/AppHeader'
import WorkspaceLayout from './components/layout/WorkspaceLayout'
import ModeSwitcher from './components/mode/ModeSwitcher'
import ModeWorkspace from './components/mode/ModeWorkspace'
import CommandReference from './components/command/CommandReference'
import ResultSummary from './components/result/ResultSummary'
import ResultDetails from './components/result/ResultDetails'
import DebugDrawer from './components/debug/DebugDrawer'

function resolveTheme(theme: AppState['ui']['theme']): 'light' | 'dark' {
  if (theme !== 'system') return theme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function App() {
  const [state, dispatch] = useReducer(appReducer, INITIAL_STATE, loadPersistedState)
  const vm = useCalculatorViewModel(state)

  // Theme is owned by AppState; apply it to the document root and keep it in sync.
  useEffect(() => {
    const root = document.documentElement
    const apply = () => root.setAttribute('data-theme', resolveTheme(state.ui.theme))
    apply()
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [state.ui.theme])

  useEffect(() => persistTheme(state.ui.theme), [state.ui.theme])
  useEffect(() => persistMode(state.mode), [state.mode])
  useEffect(() => persistByteOrder(state.byteOrder), [state.byteOrder])
  useEffect(() => persistCopy(state.copy), [state.copy])

  // Keyboard shortcuts for mode switching: Ctrl+1..5 only outside editing
  // contexts (input/textarea/select/contenteditable/role=textbox/combobox)
  // and only as a bare Ctrl combo — Meta/Alt/Shift variants stay with the
  // browser/OS.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
      if (isEditableEventTarget(e.target)) return
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
        case '5':
          dispatch({ type: 'mode/set', mode: 'VOUT_MODE' })
          e.preventDefault()
          break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className="flex min-h-screen flex-col items-center sm:px-4 sm:py-6">
      <div className="app-panel sm:rounded-2xl sm:p-6 md:p-8">
        <AppHeader
          theme={state.ui.theme}
          onThemeChange={(theme) => dispatch({ type: 'ui/set-theme', theme })}
        />

        <ModeSwitcher mode={state.mode} onChange={(mode) => dispatch({ type: 'mode/set', mode })} />

        <ResultSummary vm={vm} />

        <WorkspaceLayout
          primary={<ModeWorkspace mode={state.mode} state={state} vm={vm} dispatch={dispatch} />}
          secondary={
            <ResultDetails
              vm={vm}
              copyPrefs={state.copy}
              onTogglePrefix={() => dispatch({ type: 'copy/toggle-prefix' })}
              onToggleSpace={() => dispatch({ type: 'copy/toggle-space' })}
              onCopyEndianChange={(endian) => dispatch({ type: 'copy/set-endian', endian })}
            />
          }
        />

        {/* Read-only command reference: no selection, no mode/raw side effects. */}
        <CommandReference />

        <DebugDrawer
          open={state.ui.debugOpen}
          state={state}
          onToggle={() => dispatch({ type: 'ui/toggle-debug' })}
        />
      </div>
    </div>
  )
}

export default App
