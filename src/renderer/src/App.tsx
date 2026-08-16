import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useAgents } from '@/hooks/use-agents'
import { AgentSidebar } from '@/components/agent-sidebar'
import { AgentDetail } from '@/components/agent-detail'
import { AgentEditor } from '@/components/agent-editor'
import { Button } from '@/components/ui/button'

function App(): React.JSX.Element {
  const { agents, errors, loading, refresh } = useAgents()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingNew, setEditingNew] = useState(false)

  // Derived during render rather than synced in an effect. The list changes
  // underneath us whenever the agents directory is edited outside the app, so
  // falling back here keeps the selection valid without a cascading render.
  const selected = agents.find((a) => a.config.id === selectedId) ?? agents[0] ?? null

  const openNew = (): void => {
    setEditingNew(true)
    setEditorOpen(true)
  }

  const openEdit = (): void => {
    setEditingNew(false)
    setEditorOpen(true)
  }

  return (
    <div className="flex h-screen bg-background text-foreground">
      <AgentSidebar
        agents={agents}
        errors={errors}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onCreate={openNew}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        {selected ? (
          <AgentDetail agent={selected} onEdit={openEdit} />
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
      />
    </div>
  )
}

export default App
