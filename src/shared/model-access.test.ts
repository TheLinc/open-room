import { describe, expect, it } from 'vitest'
import {
  modelAccessFrom,
  modelAllowed,
  modelUnavailableLine,
  type ModelAccess
} from './model-access'

/** The two lists the bundled CLI returned on one Max account, one per run. */
const MAX_RUN_A = [
  { value: 'default', resolvedModel: 'claude-opus-5[1m]' },
  { value: 'opus[1m]', resolvedModel: 'claude-opus-5[1m]' },
  { value: 'claude-fable-5-1[1m]', resolvedModel: 'claude-fable-5-1' },
  { value: 'sonnet', resolvedModel: 'claude-sonnet-5' },
  { value: 'haiku', resolvedModel: 'claude-haiku-4-5-20251001' }
]
const MAX_RUN_B = [
  { value: 'default', resolvedModel: 'claude-opus-5[1m]' },
  { value: 'opus[1m]', resolvedModel: 'claude-opus-5[1m]' },
  { value: 'claude-fable-5[1m]', resolvedModel: 'claude-fable-5' },
  { value: 'sonnet', resolvedModel: 'claude-sonnet-5' },
  { value: 'haiku', resolvedModel: 'claude-haiku-4-5-20251001' }
]
/** No Fable row: the shape a plan without Fable is expected to return. */
const NO_FABLE = MAX_RUN_A.filter((row) => !row.value.includes('fable'))

describe('modelAccessFrom', () => {
  it('reads the Fable tier from either Fable row the CLI has listed', () => {
    expect(modelAccessFrom(MAX_RUN_A)).toMatchObject({ state: 'known', fable: true })
    expect(modelAccessFrom(MAX_RUN_B)).toMatchObject({ state: 'known', fable: true })
  })

  it('reads no Fable tier from a list without a Fable row', () => {
    expect(modelAccessFrom(NO_FABLE)).toMatchObject({ state: 'known', fable: false })
  })

  it('keeps the resolved ids, without the context suffix', () => {
    const access = modelAccessFrom(MAX_RUN_A)
    expect(access.state === 'known' && access.models).toContain('claude-opus-5')
    expect(access.state === 'known' && access.models).toContain('claude-fable-5-1')
  })

  it('falls back to the value when a row has no resolved id', () => {
    const access = modelAccessFrom([{ value: 'claude-fable-5' }])
    expect(access).toMatchObject({ state: 'known', fable: true })
  })
})

describe('modelAllowed', () => {
  const noFable: ModelAccess = { state: 'known', models: ['claude-opus-5'], fable: false }
  const withFable: ModelAccess = { state: 'known', models: ['claude-opus-5'], fable: true }

  it('allows everything while access is unknown', () => {
    expect(modelAllowed({ state: 'unknown' }, 'claude-fable-5-1')).toBe(true)
  })

  it('refuses only Fable ids, and only when the tier is known to be absent', () => {
    expect(modelAllowed(noFable, 'claude-fable-5-1')).toBe(false)
    expect(modelAllowed(noFable, 'claude-fable-5')).toBe(false)
    expect(modelAllowed(withFable, 'claude-fable-5-1')).toBe(true)
  })

  it('allows a model the picker did not list, since the list is a picker', () => {
    // Measured: Fable 5 ran while the picker listed only Fable 5.1.
    expect(modelAllowed(noFable, 'claude-opus-4-8')).toBe(true)
  })
})

describe('modelUnavailableLine', () => {
  it('names the model when the plan lacks it', () => {
    const access: ModelAccess = { state: 'known', models: [], fable: false }
    expect(modelUnavailableLine(access, 'claude-fable-5-1')).toBe(
      'Fable 5.1 is not included in your plan. Pick another model in the agent settings.'
    )
  })

  it('says nothing for an allowed model or an unknown account', () => {
    const access: ModelAccess = { state: 'known', models: [], fable: false }
    expect(modelUnavailableLine(access, 'claude-opus-5')).toBeNull()
    expect(modelUnavailableLine({ state: 'unknown' }, 'claude-fable-5-1')).toBeNull()
  })
})
