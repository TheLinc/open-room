import { describe, expect, it } from 'vitest'
import type { AgentConfig } from './agent'
import {
  effectiveSettings,
  mergeOverrides,
  overriddenFields,
  overrideControlCalls,
  sanitizeOverrides,
  type SessionOverrides
} from './session-overrides'

function config(patch: Partial<AgentConfig> = {}): AgentConfig {
  return {
    model: 'claude-sonnet-5',
    effort: undefined,
    permissionMode: 'default',
    ...patch
  } as AgentConfig
}

describe('effectiveSettings', () => {
  it('falls back to the config when nothing is overridden', () => {
    const settings = effectiveSettings(config({ model: 'claude-opus-5', effort: 'high' }), {})

    expect(settings).toEqual({
      model: 'claude-opus-5',
      effort: 'high',
      permissionMode: 'default'
    })
  })

  it('prefers an override over the config', () => {
    const settings = effectiveSettings(config(), {
      model: 'claude-opus-5',
      permissionMode: 'plan'
    })

    expect(settings.model).toBe('claude-opus-5')
    expect(settings.permissionMode).toBe('plan')
  })

  it('leaves effort undefined when neither names one', () => {
    expect(effectiveSettings(config(), {}).effort).toBeUndefined()
  })
})

describe('overriddenFields', () => {
  it('is empty when nothing is set', () => {
    expect(overriddenFields(config(), {})).toEqual([])
  })

  it('ignores an override that matches the config', () => {
    // Picking the value the agent already has is not an override, and must
    // not light the badge — otherwise the header claims a difference that
    // does not exist.
    expect(overriddenFields(config({ model: 'claude-opus-5' }), { model: 'claude-opus-5' })).toEqual(
      []
    )
  })

  it('names each field that genuinely differs', () => {
    const fields = overriddenFields(config(), {
      model: 'claude-opus-5',
      permissionMode: 'acceptEdits'
    })

    expect(fields).toEqual(['model', 'permissionMode'])
  })

  it('counts an effort set against a config that has none', () => {
    expect(overriddenFields(config(), { effort: 'low' })).toEqual(['effort'])
  })
})

describe('mergeOverrides', () => {
  it('applies a patch over what is already set', () => {
    expect(mergeOverrides({ model: 'claude-opus-5' }, { permissionMode: 'plan' })).toEqual({
      model: 'claude-opus-5',
      permissionMode: 'plan'
    })
  })

  it('clears a field with null rather than undefined', () => {
    // undefined does not survive structured cloning across IPC as a present
    // key, so null is the only reliable way for the renderer to say "back to
    // the config" — the SDK's own applyFlagSettings makes the same choice.
    expect(mergeOverrides({ model: 'claude-opus-5', effort: 'low' }, { model: null })).toEqual({
      effort: 'low'
    })
  })

  it('leaves untouched fields alone', () => {
    expect(mergeOverrides({ effort: 'max' }, {})).toEqual({ effort: 'max' })
  })
})

describe('sanitizeOverrides', () => {
  it('keeps known values', () => {
    const clean = sanitizeOverrides({
      model: 'claude-opus-5',
      effort: 'xhigh',
      permissionMode: 'acceptEdits'
    })

    expect(clean).toEqual({
      model: 'claude-opus-5',
      effort: 'xhigh',
      permissionMode: 'acceptEdits'
    })
  })

  it('drops a model the app does not offer', () => {
    expect(sanitizeOverrides({ model: 'gpt-4' })).toEqual({})
  })

  it('drops an unknown effort level', () => {
    expect(sanitizeOverrides({ effort: 'ludicrous' })).toEqual({})
  })

  it('refuses bypassPermissions, whatever asks for it', () => {
    // The one value in the SDK's PermissionMode that must never be reachable.
    // This runs on the main side of IPC precisely because the renderer is not
    // the only thing that can send on that channel.
    expect(sanitizeOverrides({ permissionMode: 'bypassPermissions' })).toEqual({})
  })

  it('refuses the other modes the app does not model', () => {
    expect(sanitizeOverrides({ permissionMode: 'dontAsk' })).toEqual({})
    expect(sanitizeOverrides({ permissionMode: 'auto' })).toEqual({})
  })

  it('passes null through so a field can be cleared', () => {
    expect(sanitizeOverrides({ model: null, effort: null, permissionMode: null })).toEqual({
      model: null,
      effort: null,
      permissionMode: null
    })
  })

  it('survives a payload that is not an object at all', () => {
    expect(sanitizeOverrides(null)).toEqual({})
    expect(sanitizeOverrides('plan')).toEqual({})
  })
})

describe('the overrides type', () => {
  it('is assignable from an empty object', () => {
    const empty: SessionOverrides = {}
    expect(empty).toEqual({})
  })
})

describe('overrideControlCalls', () => {
  const settings = (
    patch: Partial<ReturnType<typeof effectiveSettings>> = {}
  ): ReturnType<typeof effectiveSettings> => ({
    model: 'claude-sonnet-5',
    effort: undefined,
    permissionMode: 'default',
    ...patch
  })

  it('sends nothing when nothing changed', () => {
    expect(overrideControlCalls(settings(), settings())).toEqual([])
  })

  it('sends only the field that changed', () => {
    // Each of these is a round trip to the CLI. Re-sending all three on every
    // click would put three of them behind a control that reads as instant.
    expect(overrideControlCalls(settings(), settings({ model: 'claude-opus-5' }))).toEqual([
      { kind: 'model', model: 'claude-opus-5' }
    ])
  })

  it('sends each of the three when all change', () => {
    const calls = overrideControlCalls(
      settings(),
      settings({ model: 'claude-opus-5', permissionMode: 'plan', effort: 'high' })
    )

    expect(calls.map((c) => c.kind)).toEqual(['model', 'permissionMode', 'effort'])
  })

  it('clears effort with null rather than undefined', () => {
    // undefined is dropped in serialization, which would leave the old effort
    // in place while the UI showed it cleared.
    expect(overrideControlCalls(settings({ effort: 'max' }), settings())).toEqual([
      { kind: 'effort', effortLevel: null }
    ])
  })
})
