import { MODEL_ID, MODELS } from './agent'

/**
 * Which models the signed-in account can use, as far as the app can tell.
 *
 * Fable is the first model tier that a Claude subscription may not include,
 * and the SDK does not say so up front: an agent configured for it starts,
 * reports an init, and only then ends its turn with a `model_not_found`
 * error. The bundled CLI does know, though. `supportedModels()` on a live
 * session lists the picker the account gets, and an account with the Fable
 * tier has a Fable row in it.
 *
 * The list is a picker, not a catalogue. Measured on one Max account: the
 * Fable row was `claude-fable-5-1` on one run and `claude-fable-5` on the
 * next, and Fable 5 ran fine while only 5.1 was listed. So the question this
 * answers is "does the account have the Fable tier", never "is this exact id
 * listed" — a model missing from the picker is still allowed.
 */
export type ModelAccess =
  /** The probe has not run, or could not. Everything is allowed. */
  | { state: 'unknown' }
  | {
      state: 'known'
      models: string[]
      fable: boolean
      /** Models the CLI offers that `MODELS` does not name yet. */
      discovered?: PickerModel[]
    }

/** One row in a model picker. */
export type PickerModel = { id: string; label: string; hint: string }

/** A row as `supportedModels()` returns it; only these fields are read. */
export type ModelRow = {
  value: string
  resolvedModel?: string
  displayName?: string
  description?: string
}

const FABLE_PREFIX = 'claude-fable'

/** The wire id without the CLI's context-window suffix (`[1m]`). */
function bareId(id: string): string {
  return id.replace(/\[.*\]$/, '')
}

/** A dated release id names the same model as its undated alias: `claude-haiku-4-5-20251001`. */
function undated(id: string): string {
  return id.replace(/-\d{8}$/, '')
}

export function modelAccessFrom(rows: ModelRow[]): ModelAccess {
  const models = [...new Set(rows.map((row) => bareId(row.resolvedModel ?? row.value)))]
  return {
    state: 'known',
    models,
    fable: models.some((id) => id.startsWith(FABLE_PREFIX)),
    discovered: discoveredModels(rows)
  }
}

/**
 * Models the bundled CLI offers that the app's own list does not name.
 *
 * This is what lets a model Anthropic releases appear without an Open Room
 * release, as long as the bundled CLI already knows it. Rows are aliases
 * (`sonnet`, `opus[1m]`, `default`) resolving to a wire id, and the CLI's
 * display name is generic ("Opus"); its description leads with the real name
 * ("Opus 5 with 1M context · Best for everyday, complex tasks", measured), so
 * the label is the part before the dot and the hint the part after.
 */
export function discoveredModels(rows: ModelRow[]): PickerModel[] {
  const known = new Set(MODELS.map((model) => model.id as string))
  const found = new Map<string, PickerModel>()
  for (const row of rows) {
    const id = undated(bareId(row.resolvedModel ?? row.value))
    if (!MODEL_ID.test(id) || known.has(id) || found.has(id)) continue
    const [name = '', hint = ''] = (row.description ?? '').split(' · ')
    const label = name.replace(/ with \S+ context$/, '').trim() || row.displayName || id
    found.set(id, { id, label, hint: hint.trim() })
  }
  return [...found.values()]
}

/**
 * Every model a picker offers: what the CLI reported that the app does not
 * know yet first, since that is most likely a new release, then the app's
 * own list. `current` is kept in the list if neither names it (a model
 * discovered on an earlier launch while this one's probe failed), or the
 * select would show nothing for it.
 */
export function pickerModels(access: ModelAccess, current?: string): PickerModel[] {
  const list = [...(access.state === 'known' ? (access.discovered ?? []) : []), ...MODELS]
  if (current && !list.some((model) => model.id === current)) {
    list.unshift({ id: current, label: current, hint: 'Set in this agent’s config' })
  }
  return list
}

/** A model's name for display, falling back to its id. */
export function modelLabel(access: ModelAccess, id: string): string {
  return pickerModels(access).find((model) => model.id === id)?.label ?? id
}

export function isFableModel(modelId: string): boolean {
  return modelId.startsWith(FABLE_PREFIX)
}

/** False only when the account is known to lack the tier a model needs. */
export function modelAllowed(access: ModelAccess, modelId: string): boolean {
  if (access.state === 'unknown') return true
  if (!isFableModel(modelId)) return true
  return access.fable
}

/** One line for the pane header when the agent's own model is out of reach. */
export function modelUnavailableLine(access: ModelAccess, modelId: string): string | null {
  if (modelAllowed(access, modelId)) return null
  const label = modelLabel(access, modelId)
  return `${label} is not included in your plan. Pick another model in the agent settings.`
}

/** The label a disabled option carries in the pickers. */
export const NOT_IN_PLAN = 'Not included in your plan'
