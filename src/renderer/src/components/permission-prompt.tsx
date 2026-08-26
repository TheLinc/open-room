import { ShieldQuestionMark } from 'lucide-react'
import type { PermissionDecision, PermissionRequest } from '@shared/agent-runtime'
import { permissionDetail } from '@shared/permission-detail'
import { Button } from '@/components/ui/button'

type Props = {
  request: PermissionRequest
  agentName: string
}

/**
 * Asks about a tool the agent wants to use.
 *
 * Rendered inline at the foot of the transcript rather than as a modal: the
 * turn is paused, not the app, and the user needs the surrounding transcript
 * visible to judge the request. A modal would also stack badly once several
 * agents ask at once.
 *
 * The SDK's bridge renders `title` and `description` itself, and its docs say
 * to prefer them over reconstructing a sentence from the tool name and input.
 */
export function PermissionPrompt({ request, agentName }: Props): React.JSX.Element {
  const respond = (decision: PermissionDecision): void => {
    void window.openRoom.respondPermission(request.id, decision)
  }

  const detail = permissionDetail(request.toolName, request.input)

  return (
    <div
      role="alertdialog"
      aria-label="Permission request"
      className="flex flex-col gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4"
    >
      <div className="flex items-start gap-2.5">
        <ShieldQuestionMark className="mt-0.5 size-4 shrink-0 text-amber-500" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-medium">
            {request.title ?? `${agentName} wants to use ${request.toolName}`}
          </p>
          {request.description && (
            <p className="text-sm text-muted-foreground">{request.description}</p>
          )}
          {request.decisionReason && (
            <p className="text-xs text-muted-foreground">{request.decisionReason}</p>
          )}
          {request.blockedPath && (
            <p className="font-mono text-xs break-all text-muted-foreground">
              {request.blockedPath}
            </p>
          )}
        </div>
      </div>

      {detail.kind === 'edit' && (
        <div className="flex flex-col gap-1">
          <p className="font-mono text-xs text-muted-foreground">{detail.path}</p>
          {detail.edits.map((pair, i) => (
            <div key={i} className={i > 0 ? 'mt-2 flex flex-col gap-1' : 'flex flex-col gap-1'}>
              {detail.edits.length > 1 && (
                <p className="text-[11px] text-muted-foreground">
                  Edit {i + 1} of {detail.edits.length}
                </p>
              )}
              <pre className="max-h-64 overflow-auto rounded border-l-2 border-red-500/60 bg-red-500/5 p-2 font-mono text-[11px] whitespace-pre-wrap">
                {pair.before}
              </pre>
              <pre className="max-h-64 overflow-auto rounded border-l-2 border-emerald-500/60 bg-emerald-500/5 p-2 font-mono text-[11px] whitespace-pre-wrap">
                {pair.after}
              </pre>
            </div>
          ))}
        </div>
      )}
      {detail.kind === 'write' && (
        <div className="flex flex-col gap-1">
          <p className="font-mono text-xs text-muted-foreground">{detail.path}</p>
          <pre className="max-h-64 overflow-auto rounded bg-muted/40 p-2 font-mono text-[11px] whitespace-pre-wrap">
            {detail.content}
          </pre>
        </div>
      )}
      {detail.kind === 'command' && (
        <div className="flex flex-col gap-1">
          <pre className="max-h-64 overflow-auto rounded bg-muted/40 p-2 font-mono text-xs whitespace-pre-wrap">
            {detail.command}
          </pre>
          {detail.description && (
            <p className="text-xs text-muted-foreground">{detail.description}</p>
          )}
        </div>
      )}
      {detail.kind === 'path' && (
        <p className="font-mono text-xs">
          <span className="text-muted-foreground">{detail.label}: </span>
          {detail.value}
        </p>
      )}

      <details className="rounded border border-border/60 bg-background/40 px-2 py-1.5">
        <summary className="cursor-pointer text-xs text-muted-foreground select-none">
          Show the exact request
        </summary>
        <pre className="mt-2 overflow-x-auto font-mono text-[11px] whitespace-pre-wrap">
          {request.toolName}
          {'\n'}
          {JSON.stringify(request.input, null, 2)}
        </pre>
      </details>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => respond('allow')}>
          Allow once
        </Button>
        {request.canRemember && (
          <Button size="sm" variant="outline" onClick={() => respond('allow-always')}>
            Allow for this session
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => respond('deny')}>
          Decline
        </Button>
      </div>
    </div>
  )
}
