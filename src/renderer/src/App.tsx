import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { useAgents } from '@/hooks/use-agents'
import { useSessions } from '@/hooks/use-sessions'
import { useConversations } from '@/hooks/use-conversations'
import { AgentSidebar } from '@/components/agent-sidebar'
import { AgentChat } from '@/components/agent-chat'
import { AgentEditor } from '@/components/agent-editor'
import { SettingsDialog, type SettingsHighlight } from '@/components/settings-dialog'
import { QuotaBanner } from '@/components/quota-banner'
import { FirstRun } from '@/components/first-run'
import type { LoginStatus } from '@shared/login'
import { TitleBar } from '@/components/title-bar'
import { useSettings } from '@/hooks/use-settings'
import { Button } from '@/components/ui/button'
import type { HotkeyFailure } from '@shared/hotkeys'

function App(): React.JSX.Element {
  const { agents, errors, loading, refresh } = useAgents()
  const sessions = useSessions()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingNew, setEditingNew] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Set when a "Turn it on in Settings" link opens the dialog, so it can
  // point at the control the link named. Cleared on close, so opening
  // settings normally never replays the flash.
  const [settingsHighlight, setSettingsHighlight] = useState<SettingsHighlight | null>(null)

  // The account, not any agent: while no login is usable the whole window is
  // the first-run screen. Signed-in and unknown both show the app — unknown
  // means the check could not run, and a working install must not be locked
  // out by its own diagnostic.
  const [login, setLogin] = useState<LoginStatus>({ state: 'signed-in' })
  useEffect(() => {
    void window.openRoom.getLogin().then(setLogin)
    return window.openRoom.onLoginChanged(setLogin)
  }, [])

  // Held here rather than in the dialog: the same failures belong against the
  // per-agent field in the editor, and both need them whether or not the
  // dialog has ever been opened.
  const { settings } = useSettings()
  const [hotkeyFailures, setHotkeyFailures] = useState<HotkeyFailure[]>([])
  useEffect(() => {
    // Asked for as well as subscribed to: bindings are registered at launch,
    // before this window finished loading, so the broadcast that carried them
    // was dropped.
    void window.openRoom.getHotkeyFailures().then(setHotkeyFailures)
  }, [])
  useEffect(() => window.openRoom.onHotkeyFailures(setHotkeyFailures), [])

  // Derived during render rather than synced in an effect. The list changes
  // underneath us whenever the agents directory is edited outside the app, so
  // falling back here keeps the selection valid without a cascading render.
  const selected = agents.find((a) => a.config.id === selectedId) ?? agents[0] ?? null
  const selectedRuntime = sessions.runtimeFor(selected?.config.id ?? '')
  const conversations = useConversations(
    selected?.config.id ?? null,
    selectedRuntime,
    selected?.config.persistSession ?? false
  )

  // The global push-to-talk hotkey addresses "the selected agent", and main
  // has no other way to know which that is. Reports the *effective* selection,
  // including the fallback above, so the overlay names what is on screen.
  const effectiveId = selected?.config.id ?? null
  useEffect(() => {
    window.openRoom.selectAgent(effectiveId)
  }, [effectiveId])

  // A pip in the overlay HUD was clicked. It raises this window, and this
  // puts the agent it named on screen.
  useEffect(() => window.openRoom.onFocusAgent(setSelectedId), [])

  const openNew = (): void => {
    setEditingNew(true)
    setEditorOpen(true)
  }

  const openEdit = (): void => {
    setEditingNew(false)
    setEditorOpen(true)
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <TitleBar />
      <QuotaBanner />

      {/* `min-h-0` so the row can shrink below its content and let the panes
          scroll, rather than pushing the window taller than the screen. */}
      <div className="flex min-h-0 flex-1 border-t border-border">
        {login.state === 'signed-out' ? (
          <FirstRun status={login} onRecheck={() => window.openRoom.recheckLogin()} />
        ) : (
          <>
            <AgentSidebar
              agents={agents}
              errors={errors}
              selectedId={selected?.config.id ?? null}
              runtimeFor={sessions.runtimeFor}
              onSelect={setSelectedId}
              onCreate={openNew}
              onOpenSettings={() => setSettingsOpen(true)}
            />

            <main className="flex min-w-0 flex-1 flex-col">
              {selected ? (
                <AgentChat
                  key={selected.config.id}
                  agent={selected}
                  runtime={selectedRuntime}
                  entries={sessions.entriesFor(selected.config.id)}
                  truncated={sessions.truncatedFor(selected.config.id)}
                  permissions={sessions.permissionsFor(selected.config.id)}
                  conversations={conversations}
                  onEdit={openEdit}
                />
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
                  <div className="flex flex-col gap-1">
                    <h2 className="text-lg font-semibold tracking-tight">
                      {loading ? 'Loading agents…' : 'No agents yet'}
                    </h2>
                    {!loading && (
                      <p className="max-w-sm text-sm text-muted-foreground">
                        An agent is a named Claude Code session with its own model, tools, and role.
                        Create one and give it a folder to work in.
                      </p>
                    )}
                  </div>
                  {!loading && (
                    <Button onClick={openNew}>
                      <Plus /> New agent
                    </Button>
                  )}
                </div>
              )}
            </main>
          </>
        )}
      </div>

      <AgentEditor
        key={editingNew ? 'new' : (selected?.config.id ?? 'none')}
        agent={editingNew ? undefined : (selected ?? undefined)}
        existingNames={agents.map((a) => a.config.name)}
        open={editorOpen}
        onOpenChange={setEditorOpen}
        onSaved={refresh}
        onDeleted={() => {
          setSelectedId(null)
          void refresh()
        }}
        hotkeyFailure={
          hotkeyFailures.find((failure) => failure.agentId === selected?.config.id) ?? null
        }
        voiceInputEnabled={settings?.voiceInputEnabled ?? true}
        onOpenVoiceSettings={() => {
          setSettingsHighlight('voice-input')
          setSettingsOpen(true)
        }}
      />

      {/* Rendered after the editor so its portal stacks above it — the
          editor's link opens this on top without closing the half-edited
          form underneath. */}
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={(next) => {
          setSettingsOpen(next)
          if (!next) setSettingsHighlight(null)
        }}
        hotkeyFailures={hotkeyFailures}
        highlight={settingsHighlight}
      />
    </div>
  )
}

export default App
