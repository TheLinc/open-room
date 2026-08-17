import { describe, expect, it } from 'vitest'
import { IDLE_CAPTURE, reduce, type CaptureState } from './voice-input'

const listening: CaptureState = {
  phase: 'listening',
  agentId: 'atlas',
  transcript: '',
  message: ''
}

/** Drives the reducer through a sequence, returning the state it lands in. */
const after = (state: CaptureState, ...events: Parameters<typeof reduce>[1][]): CaptureState =>
  events.reduce((current, event) => reduce(current, event).state, state)

describe('reduce', () => {
  it('starts a capture on trigger and asks for audio', () => {
    const { state, commands } = reduce(IDLE_CAPTURE, { type: 'trigger', agentId: 'atlas' })

    expect(state.phase).toBe('listening')
    expect(state.agentId).toBe('atlas')
    expect(commands).toContain('start-audio')
  })

  it('ignores a second trigger while a capture is running', () => {
    // One microphone, one capture. There is no correct arbitration.
    const { state, commands } = reduce(listening, { type: 'trigger', agentId: 'scout' })

    expect(state.agentId).toBe('atlas')
    expect(commands).toEqual([])
  })

  it('stops and sends when the hotkey is pressed again', () => {
    const { state, commands } = reduce(listening, { type: 'stopRequested' })

    expect(state.phase).toBe('transcribing')
    expect(commands).toContain('stop-audio')
  })

  it('cancels and discards on Esc', () => {
    const { state, commands } = reduce(listening, { type: 'cancelRequested' })

    expect(state.phase).toBe('hidden')
    expect(commands).toContain('discard-audio')
    expect(commands).not.toContain('transcribe')
  })

  it('treats stop and cancel as different intentions', () => {
    const stopped = reduce(listening, { type: 'stopRequested' })
    const cancelled = reduce(listening, { type: 'cancelRequested' })

    expect(stopped.state.phase).not.toBe(cancelled.state.phase)
  })

  it('transcribes once audio is ready', () => {
    const { commands } = reduce(after(listening, { type: 'stopRequested' }), {
      type: 'audioReady'
    })

    expect(commands).toContain('transcribe')
  })

  it('dispatches a transcript and shows it', () => {
    const { state, commands } = reduce(after(listening, { type: 'stopRequested' }), {
      type: 'transcript',
      text: 'check the macOS job'
    })

    expect(state.phase).toBe('dispatched')
    expect(state.transcript).toBe('check the macOS job')
    expect(commands).toContain('dispatch')
  })

  it('trims the transcript before dispatching it', () => {
    const { state } = reduce(after(listening, { type: 'stopRequested' }), {
      type: 'transcript',
      text: '  deploy the branch  '
    })

    expect(state.transcript).toBe('deploy the branch')
  })

  it('dispatches nothing when the transcript is empty', () => {
    // Whisper returns nothing for audio under 200ms and for a room with no
    // speech in it. An empty prompt would be worse than no prompt.
    const { state, commands } = reduce(after(listening, { type: 'stopRequested' }), {
      type: 'transcript',
      text: '   '
    })

    expect(commands).not.toContain('dispatch')
    expect(state.phase).toBe('error')
    expect(state.message).toBe('Nothing heard')
  })

  it('silence ends the capture the same way the hotkey does', () => {
    const { state, commands } = reduce(listening, { type: 'silence' })

    expect(state.phase).toBe('transcribing')
    expect(commands).toContain('stop-audio')
  })

  it('the hard cap ends the capture rather than discarding it', () => {
    const { state, commands } = reduce(listening, { type: 'maxDuration' })

    expect(state.phase).toBe('transcribing')
    expect(commands).toContain('stop-audio')
  })

  it('a no-speech timeout cancels rather than transcribing', () => {
    const { state, commands } = reduce(listening, { type: 'noSpeech' })

    expect(state.phase).toBe('hidden')
    expect(commands).toContain('discard-audio')
  })

  it('reports a precondition failure without opening a capture', () => {
    const { state, commands } = reduce(IDLE_CAPTURE, {
      type: 'blocked',
      message: 'No microphone access'
    })

    expect(state.phase).toBe('error')
    expect(state.message).toBe('No microphone access')
    expect(commands).not.toContain('start-audio')
  })

  it('surfaces a transcription failure and lets go of the audio', () => {
    const { state, commands } = reduce(after(listening, { type: 'stopRequested' }), {
      type: 'failed',
      message: 'The voice sidecar is not running'
    })

    expect(state.phase).toBe('error')
    expect(state.message).toBe('The voice sidecar is not running')
    expect(commands).toContain('discard-audio')
  })

  it('returns to hidden when the dispatched bubble expires', () => {
    const dispatched = after(
      listening,
      { type: 'stopRequested' },
      { type: 'transcript', text: 'hello' }
    )

    const { state, commands } = reduce(dispatched, { type: 'dismiss' })

    expect(state.phase).toBe('hidden')
    expect(commands).toContain('hide')
  })

  it('ignores audio that arrives after a cancel', () => {
    // The overlay may already have flushed the worklet when Esc landed.
    const cancelled = after(listening, { type: 'cancelRequested' })

    expect(reduce(cancelled, { type: 'audioReady' }).commands).toEqual([])
  })

  it('ignores a stop when nothing is being captured', () => {
    expect(reduce(IDLE_CAPTURE, { type: 'stopRequested' }).commands).toEqual([])
  })
})
