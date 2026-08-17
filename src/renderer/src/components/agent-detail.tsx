import { Pencil } from 'lucide-react'
import { MODELS, type Agent } from '@shared/agent'
import { colorHexFor } from '@shared/voice-input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'

type Props = {
  agent: Agent
  onEdit: () => void
}

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="grid grid-cols-[10rem_1fr] items-start gap-4 py-2">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  )
}

export function AgentDetail({ agent, onEdit }: Props): React.JSX.Element {
  const { config } = agent
  const color = colorHexFor(config.color)
  const model = MODELS.find((m) => m.id === config.model)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <span aria-hidden className="size-3 rounded-full" style={{ backgroundColor: color }} />
          <div>
            <h2 className="text-lg font-semibold tracking-tight">{config.name}</h2>
            <p className="text-xs text-muted-foreground">
              Say “Hey {config.name}” once voice input is enabled
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={onEdit}>
          <Pencil /> Edit
        </Button>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 py-4">
          <dl className="divide-y divide-border">
            <Row label="Model">
              {model?.label ?? config.model}
              {config.effort && (
                <span className="text-muted-foreground"> · {config.effort} effort</span>
              )}
            </Row>
            {config.fallbackModel && (
              <Row label="Fallback">
                {MODELS.find((m) => m.id === config.fallbackModel)?.label ?? config.fallbackModel}
              </Row>
            )}
            <Row label="Workspace">
              <span className="break-all font-mono text-xs">{config.workspacePath}</span>
            </Row>
            <Row label="Permission mode">{config.permissionMode}</Row>
            <Row label="Tools">
              <div className="flex flex-wrap gap-1.5">
                {config.allowedTools.length === 0 && config.disallowedTools.length === 0 ? (
                  <span className="text-muted-foreground">Asks before every tool</span>
                ) : (
                  <>
                    {config.allowedTools.map((tool) => (
                      <Badge key={tool} variant="secondary">
                        {tool} · auto
                      </Badge>
                    ))}
                    {config.disallowedTools.map((tool) => (
                      <Badge key={tool} variant="destructive">
                        {tool} · denied
                      </Badge>
                    ))}
                  </>
                )}
              </div>
            </Row>
            <Row label="MCP servers">
              {Object.keys(config.mcpServers).length === 0 ? (
                <span className="text-muted-foreground">None</span>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {Object.keys(config.mcpServers).map((name) => (
                    <Badge key={name} variant="outline">
                      {name}
                    </Badge>
                  ))}
                </div>
              )}
            </Row>
            <Row label="Speech">
              {config.tts.enabled
                ? `${config.tts.voice.id} at ${config.tts.rate.toFixed(2)}×`
                : 'Notifications only'}
            </Row>
            <Row label="Conversations">
              {config.persistSession ? 'Saved and resumable' : 'Not saved to disk'}
            </Row>
          </dl>

          <Separator className="my-6" />

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">AGENT.md</h3>
            <pre className="overflow-x-auto rounded-md border border-border bg-muted/30 p-4 font-mono text-xs whitespace-pre-wrap">
              {agent.context.trim() || 'No context set.'}
            </pre>
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
