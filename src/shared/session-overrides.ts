import { EFFORT_LEVELS, MODEL_IDS, type AgentConfig } from './agent'

/**
 * Per-session overrides for the settings an agent's config fixes.
 *
 * These exist because model, effort and permission mode are the three
 * decisions that change mid-conversation — "just plan this one out first"
 * should not cost a trip to the editor and a session restart.
 *
 * They are **session-scoped and sticky**, not per-turn, because that is what
 * the SDK actually does: `setModel` changes the model "for subsequent
 * responses" and stays until something changes it back. Simulating a one-turn
 * override on top would mean reverting behind the user's back, and an
 * interrupt or a crash mid-turn leaves that revert ambiguous. Ending the
 * session drops them and the config takes over again.
 */
export type SessionOverrides = {
  model?: string
  effort?: (typeof EFFORT_LEVELS)[number]
  permissionMode?: SessionPermissionMode
}

/**
 * Permission modes reachable from inside a conversation.
 *
 * `acceptEdits` is here but deliberately *not* in `AgentConfig`: it is useful
 * for a refactor where approving every write is the friction, and much less
 * so as a standing default that outlives the session it was turned on for.
 *
 * The SDK's `PermissionMode` also carries `bypassPermissions`, `dontAsk` and
 * `auto`. None are offered, and `sanitizeOverrides` rejects them rather than
 * relying on the UI never sending one.
 */
export const SESSION_PERMISSION_MODES = [
  {
    id: 'default',
    label: 'Ask every time',
    hint: 'Tools that are not on the allow list prompt you first.'
  },
  {
    id: 'acceptEdits',
    label: 'Accept edits',
    hint: 'File writes go through without asking. Everything else still prompts.'
  },
  {
    id: 'plan',
    label: 'Plan first',
    hint: 'Research and propose an approach without changing anything.'
  }
] as const

export type SessionPermissionMode = (typeof SESSION_PERMISSION_MODES)[number]['id']

const PERMISSION_MODE_IDS: readonly string[] = SESSION_PERMISSION_MODES.map((m) => m.id)

/** The fields an override can name, in the order the header shows them. */
export const OVERRIDE_FIELDS = ['model', 'effort', 'permissionMode'] as const

export type OverrideField = (typeof OVERRIDE_FIELDS)[number]

/**
 * A patch from the renderer. `null` clears a field back to the config;
 * an absent key leaves it alone.
 */
export type SessionOverridePatch = {
  [K in OverrideField]?: SessionOverrides[K] | null
}

/** What the agent is actually running with, config underneath overrides. */
export function effectiveSettings(
  config: Pick<AgentConfig, 'model' | 'effort' | 'permissionMode'>,
  overrides: SessionOverrides
): {
  model: string
  effort: SessionOverrides['effort']
  permissionMode: SessionPermissionMode
} {
  return {
    model: overrides.model ?? config.model,
    effort: overrides.effort ?? config.effort,
    permissionMode: overrides.permissionMode ?? config.permissionMode
  }
}

/**
 * Which fields genuinely differ from the config.
 *
 * An override equal to the config's own value does not count: the header
 * badge means "this session is not what the agent is configured to be", and
 * lighting it for a value the user re-picked would make it meaningless.
 */
export function overriddenFields(
  config: Pick<AgentConfig, 'model' | 'effort' | 'permissionMode'>,
  overrides: SessionOverrides
): OverrideField[] {
  return OVERRIDE_FIELDS.filter((field) => {
    const value = overrides[field]
    return value !== undefined && value !== config[field]
  })
}

/** Applies a patch, treating `null` as "clear this field". */
export function mergeOverrides(
  current: SessionOverrides,
  patch: SessionOverridePatch
): SessionOverrides {
  const next: SessionOverrides = { ...current }

  for (const field of OVERRIDE_FIELDS) {
    if (!(field in patch)) continue
    const value = patch[field]
    if (value === null || value === undefined) delete next[field]
    // Each field is narrowed by its own key, which a loop cannot express.
    else Object.assign(next, { [field]: value })
  }

  return next
}

/**
 * Validates a patch arriving over IPC.
 *
 * Run in main, not the renderer. Permission mode is a privilege boundary and
 * the app must not depend on the only sender being a UI that offers three
 * safe values — `bypassPermissions` reaching `setPermissionMode` would hand a
 * voice-addressable agent unattended shell access.
 */
export function sanitizeOverrides(patch: unknown): SessionOverridePatch {
  if (typeof patch !== 'object' || patch === null) return {}

  const raw = patch as Record<string, unknown>
  const clean: SessionOverridePatch = {}

  if (raw.model === null) clean.model = null
  else if (typeof raw.model === 'string' && MODEL_IDS.includes(raw.model)) clean.model = raw.model

  if (raw.effort === null) clean.effort = null
  else if (typeof raw.effort === 'string' && (EFFORT_LEVELS as readonly string[]).includes(raw.effort))
    clean.effort = raw.effort as SessionOverrides['effort']

  if (raw.permissionMode === null) clean.permissionMode = null
  else if (typeof raw.permissionMode === 'string' && PERMISSION_MODE_IDS.includes(raw.permissionMode))
    clean.permissionMode = raw.permissionMode as SessionPermissionMode

  return clean
}

/**
 * One control request to send to a live session.
 *
 * The SDK exposes three separate methods and each is a round trip to the CLI,
 * so the supervisor sends only what actually changed. Returned as data rather
 * than performed here to keep the decision testable — the executor is four
 * lines with an SDK in front of it and nothing that can be asserted on.
 */
export type OverrideControlCall =
  | { kind: 'model'; model: string }
  | { kind: 'permissionMode'; mode: SessionPermissionMode }
  | { kind: 'effort'; effortLevel: SessionOverrides['effort'] | null }

/**
 * What to send after an override change, comparing effective values.
 *
 * Effective rather than raw overrides, so clearing a field back to a config
 * that already said the same thing sends nothing at all.
 */
export function overrideControlCalls(
  before: ReturnType<typeof effectiveSettings>,
  after: ReturnType<typeof effectiveSettings>
): OverrideControlCall[] {
  const calls: OverrideControlCall[] = []

  if (after.model !== before.model) calls.push({ kind: 'model', model: after.model })
  if (after.permissionMode !== before.permissionMode)
    calls.push({ kind: 'permissionMode', mode: after.permissionMode })
  // null clears the flag layer, letting the config's own effort — or the
  // model's default, when it has none — apply again. undefined would be
  // dropped in serialization and silently leave the old value in place.
  if (after.effort !== before.effort)
    calls.push({ kind: 'effort', effortLevel: after.effort ?? null })

  return calls
}
