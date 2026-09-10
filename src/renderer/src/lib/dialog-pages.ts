/**
 * Which page of each dialog holds what.
 *
 * The settings dialog and the agent editor both grew past what one scroll
 * could carry, so each is a rail of pages. The page lists live here rather
 * than in the components so the routing decisions (which page a link opens
 * on, which pages a failed save has to flag) are testable without rendering.
 */

export type SettingsPage = 'general' | 'voice' | 'conversations' | 'appearance' | 'updates'

/** A control a link elsewhere can open the settings dialog pointed at. */
export type SettingsHighlight = 'voice-input'

export const SETTINGS_PAGES: { id: SettingsPage; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'voice', label: 'Voice' },
  { id: 'conversations', label: 'Conversations' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'updates', label: 'Updates' }
]

/** The page a highlighted control lives on; General when nothing is pointed at. */
export function pageForHighlight(highlight: SettingsHighlight | null): SettingsPage {
  switch (highlight) {
    case 'voice-input':
      return 'voice'
    case null:
      return 'general'
  }
}

export type EditorPage = 'identity' | 'workspace' | 'model' | 'permissions' | 'voice'

export const EDITOR_PAGES: { id: EditorPage; label: string }[] = [
  { id: 'identity', label: 'Identity' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'model', label: 'Model' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'voice', label: 'Voice' }
]

/**
 * Every form field, by the page that renders it. Grouped by the question
 * the user is answering ("who is this agent", "where does it work") rather
 * than by how the field is stored, which is what the old Advanced tab was.
 */
export const EDITOR_PAGE_FIELDS: Record<EditorPage, string[]> = {
  identity: ['name', 'color', 'context'],
  workspace: ['workspacePath', 'wslDistro', 'worktrees', 'persistSession'],
  model: ['model', 'effort', 'fallbackModel'],
  permissions: ['permissionMode', 'toolPermissions', 'mcpServersJson'],
  voice: ['hotkey', 'notificationsEnabled', 'ttsEnabled', 'voiceProvider', 'voiceId', 'rate']
}

/**
 * The pages that hold a field with a validation error, in rail order.
 *
 * A save that fails on a page the user is not looking at would otherwise
 * fail silently; the rail marks these and the editor jumps to the first.
 */
export function flaggedPages(errorFields: string[]): EditorPage[] {
  const errors = new Set(errorFields)
  return EDITOR_PAGES.map((page) => page.id).filter((id) =>
    EDITOR_PAGE_FIELDS[id].some((field) => errors.has(field))
  )
}
