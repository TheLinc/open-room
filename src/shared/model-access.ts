import { MODELS } from './agent'

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
  { state: 'unknown' } | { state: 'known'; models: string[]; fable: boolean }

const FABLE_PREFIX = 'claude-fable'

/** The wire id without the CLI's context-window suffix (`[1m]`). */
function bareId(id: string): string {
  return id.replace(/\[.*\]$/, '')
}

export function modelAccessFrom(rows: { value: string; resolvedModel?: string }[]): ModelAccess {
  const models = [...new Set(rows.map((row) => bareId(row.resolvedModel ?? row.value)))]
  return { state: 'known', models, fable: models.some((id) => id.startsWith(FABLE_PREFIX)) }
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
  const label = MODELS.find((model) => model.id === modelId)?.label ?? modelId
  return `${label} is not included in your plan. Pick another model in the agent settings.`
}

/** The label a disabled option carries in the pickers. */
export const NOT_IN_PLAN = 'Not included in your plan'
