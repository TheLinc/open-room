import type { AgentRuntime } from '@shared/agent-runtime'

/**
 * Whether leaving the active conversation needs a word first.
 *
 * An agent has one live session and which conversation it resumes is fixed
 * at spawn, so selecting another conversation, starting a new one, or
 * archiving or deleting the active one all end the session, and a running
 * turn with it. That used to happen silently on a click in a dropdown. A
 * pending permission prompt counts as working: switching away from a
 * question the agent asked is the case most likely to be a misclick.
 */
export function switchNeedsConfirm(
  state: AgentRuntime['state'],
  pendingPermissions: number
): boolean {
  return state === 'working' || state === 'starting' || pendingPermissions > 0
}

export type GuardedAction = 'select' | 'new' | 'archive' | 'delete'

/** The line the confirm shows, and the label on its button. */
export function switchConfirmCopy(
  agentName: string,
  action: GuardedAction,
  pendingPermissions: number
): { line: string; confirm: string } {
  const waiting = pendingPermissions > 0
  const doing = waiting ? 'is waiting for you to answer a permission prompt' : 'is still working'
  const verb =
    action === 'select'
      ? 'switch'
      : action === 'new'
        ? 'start a new conversation'
        : action === 'archive'
          ? 'archive this one'
          : 'delete this one'
  return {
    line: `${agentName} ${doing}. Stop it and ${verb}?`,
    confirm: action === 'select' ? 'Stop and switch' : `Stop and ${verb.split(' ')[0]}`
  }
}
