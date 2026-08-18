/**
 * Identity colors. Deliberately high-contrast against each other — these
 * distinguish agents at a glance in the sidebar and in the listening overlay,
 * where the name may be too small to read quickly.
 *
 * Kept in its own module, separate from the agent schema, because the overlay
 * needs to resolve a colour and nothing else. Importing these from `agent.ts`
 * pulled Zod and the whole config model into an always-on-top window that has
 * no use for either.
 */
export const AGENT_COLORS = [
  { id: 'amber', hex: '#f59e0b' },
  { id: 'emerald', hex: '#10b981' },
  { id: 'sky', hex: '#0ea5e9' },
  { id: 'violet', hex: '#8b5cf6' },
  { id: 'rose', hex: '#f43f5e' },
  { id: 'lime', hex: '#84cc16' },
  { id: 'cyan', hex: '#06b6d4' },
  { id: 'orange', hex: '#f97316' }
] as const

export const AGENT_COLOR_IDS = AGENT_COLORS.map((c) => c.id) as [string, ...string[]]

/** Identity colour as hex, falling back to a neutral grey. */
export function colorHexFor(colorId: string): string {
  return AGENT_COLORS.find((c) => c.id === colorId)?.hex ?? '#71717a'
}
