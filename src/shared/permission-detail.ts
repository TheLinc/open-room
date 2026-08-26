/**
 * What a permission prompt is actually asking about.
 *
 * The SDK's `title` and `description` say *that* an edit is wanted; they do
 * not show the edit. A delegation tool lives or dies on the moment it
 * interrupts you, so the prompt shows the diff, the command or the path,
 * and keeps the raw JSON under a disclosure for everything else.
 */

export type PermissionDetail =
  | { kind: 'edit'; path: string; edits: { before: string; after: string }[] }
  | { kind: 'write'; path: string; content: string }
  | { kind: 'command'; command: string; description?: string }
  | { kind: 'path'; label: string; value: string }
  | { kind: 'none' }

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null)

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export function permissionDetail(
  toolName: string,
  input: Record<string, unknown>
): PermissionDetail {
  switch (toolName) {
    case 'Edit': {
      const path = str(input.file_path)
      const before = str(input.old_string)
      const after = str(input.new_string)
      return path !== null && before !== null && after !== null
        ? { kind: 'edit', path, edits: [{ before, after }] }
        : { kind: 'none' }
    }
    case 'MultiEdit': {
      const path = str(input.file_path)
      const rawEdits = Array.isArray(input.edits) ? input.edits : null
      if (path === null || !rawEdits) return { kind: 'none' }
      const edits = rawEdits
        .filter(isObject)
        .map((e) => ({ before: str(e.old_string), after: str(e.new_string) }))
        .filter(
          (e): e is { before: string; after: string } => e.before !== null && e.after !== null
        )
      return edits.length > 0 ? { kind: 'edit', path, edits } : { kind: 'none' }
    }
    case 'Write': {
      const path = str(input.file_path)
      const content = str(input.content)
      return path !== null && content !== null ? { kind: 'write', path, content } : { kind: 'none' }
    }
    case 'Bash': {
      const command = str(input.command)
      if (command === null) return { kind: 'none' }
      const description = str(input.description)
      return description ? { kind: 'command', command, description } : { kind: 'command', command }
    }
    case 'Read': {
      const path = str(input.file_path)
      return path !== null ? { kind: 'path', label: 'File', value: path } : { kind: 'none' }
    }
    case 'Glob':
    case 'Grep': {
      const pattern = str(input.pattern)
      if (pattern === null) return { kind: 'none' }
      const dir = str(input.path)
      return { kind: 'path', label: 'Pattern', value: dir ? `${pattern} in ${dir}` : pattern }
    }
    default:
      return { kind: 'none' }
  }
}
