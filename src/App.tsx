import { useEffect, useReducer } from 'react'
import { appReducer, INITIAL_STATE } from './app/reducer'
import type { AppState } from './app/state'
import { useCalculatorViewModel } from './app/view-model'
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
import CommandPicker from './components/command/CommandPicker'
import ResultInspector from './components/result/ResultInspector'
import InfoPanel from './components/result/InfoPanel'
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
      className="flex min-h-screen flex-col items-center py-6 px-4"
      style={{ background: 'var(--color-bg)' }}
    >
      <div
        className="w-full max-w-[1000px] rounded-2xl p-6 md:p-8"
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          boxShadow: 'var(--shadow-panel)',
        }}
      >
        <AppHeader
          theme={state.ui.theme}
          onThemeChange={(theme) => dispatch({ type: 'ui/set-theme', theme })}
        />

        <ModeSwitcher mode={state.mode} onChange={(mode) => dispatch({ type: 'mode/set', mode })} />

        <CommandPicker
          commandKey={state.commandKey}
          onChange={(key) => dispatch({ type: 'command/set', commandKey: key })}
          onApplyPreset={(key) => dispatch({ type: 'command/apply-preset', commandKey: key })}
        />

        <WorkspaceLayout
          primary={<ModeWorkspace mode={state.mode} state={state} vm={vm} dispatch={dispatch} />}
          secondary={
            <div className="space-y-4">
              <ResultInspector
                vm={vm}
                copyPrefs={state.copy}
                onTogglePrefix={() => dispatch({ type: 'copy/toggle-prefix' })}
                onToggleSpace={() => dispatch({ type: 'copy/toggle-space' })}
                onCopyEndianChange={(endian) => dispatch({ type: 'copy/set-endian', endian })}
              />
              <InfoPanel warnings={vm.warnings} />
            </div>
          }
        />

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
