import type { AgentState } from './agent-runtime'
import type { ImageAttachment } from './attachments'

/**
 * Prompts typed while a turn is running.
 *
 * Held in main and pushed to the SDK only when the turn ends. The CLI would
 * queue a message pushed mid-turn itself, but `query.interrupt()` takes no
 * arguments and cannot cancel what the CLI already holds — so Stop could not
 * mean stop. Owning the queue makes it visible, removable, and discarded on
 * Stop, which is what a queue people can see has to be.
 */

export type QueuedPrompt = { id: string; text: string; images: ImageAttachment[] }

/** What the renderer sees: image bytes stay in main. */
export type QueuedPromptSummary = { id: string; text: string; imageCount: number }

/** Whether a prompt submitted now waits for the current turn. */
export function shouldQueue(state: AgentState): boolean {
  return state === 'working' || state === 'starting'
}

/** The next prompt to send when a turn ends, and what remains. */
export function drain(queue: QueuedPrompt[]): { next: QueuedPrompt | null; rest: QueuedPrompt[] } {
  if (queue.length === 0) return { next: null, rest: [] }
  const [next, ...rest] = queue
  return { next, rest }
}

export function without(queue: QueuedPrompt[], id: string): QueuedPrompt[] {
  return queue.filter((prompt) => prompt.id !== id)
}

export function summarise(queue: QueuedPrompt[]): QueuedPromptSummary[] {
  return queue.map(({ id, text, images }) => ({ id, text, imageCount: images.length }))
}
