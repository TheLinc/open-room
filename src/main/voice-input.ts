import type { OverlayPhase } from '@shared/voice-input'

/**
 * One capture, as a pure reducer.
 *
 * Audio lives in the overlay renderer and hotkeys live in Electron, so neither
 * is testable here — which is exactly why every decision about a capture is in
 * this file and neither of those places has any.
 */

export type CaptureEvent =
  | { type: 'trigger'; agentId: string }
  | { type: 'blocked'; message: string }
  | { type: 'speechStarted' }
  | { type: 'silence' }
  | { type: 'noSpeech' }
  | { type: 'maxDuration' }
  | { type: 'stopRequested' }
  | { type: 'cancelRequested' }
  | { type: 'audioReady' }
  | { type: 'transcript'; text: string }
  | { type: 'failed'; message: string }
  | { type: 'dismiss' }

export type CaptureState = {
  phase: OverlayPhase
  agentId: string | null
  transcript: string
  message: string
}

export type CaptureCommand =
  'start-audio' | 'stop-audio' | 'discard-audio' | 'transcribe' | 'dispatch' | 'hide'

export const IDLE_CAPTURE: CaptureState = {
  phase: 'hidden',
  agentId: null,
  transcript: '',
  message: ''
}

type Result = { state: CaptureState; commands: CaptureCommand[] }

/** Phases during which the microphone is open or its audio is still in play. */
const isActive = (phase: OverlayPhase): boolean => phase === 'listening' || phase === 'transcribing'

export function reduce(state: CaptureState, event: CaptureEvent): Result {
  switch (event.type) {
    case 'trigger':
      // One microphone, one capture. A second trigger during one is ignored
      // rather than arbitrated — there is no correct arbitration.
      if (isActive(state.phase)) return { state, commands: [] }

      return {
        state: { phase: 'listening', agentId: event.agentId, transcript: '', message: '' },
        commands: ['start-audio']
      }

    case 'blocked':
      // A precondition failed before anything opened, so there is no audio to
      // discard and no capture to stop.
      return { state: { ...IDLE_CAPTURE, phase: 'error', message: event.message }, commands: [] }

    case 'speechStarted':
      // Observed by the endpointer and worth knowing, but it changes nothing
      // here: the waveform is already moving.
      return { state, commands: [] }

    case 'silence':
    case 'stopRequested':
      if (state.phase !== 'listening') return { state, commands: [] }
      return { state: { ...state, phase: 'transcribing' }, commands: ['stop-audio'] }

    case 'maxDuration':
      // The failsafe tripped mid-capture. Minutes of dictation are worth too
      // much to discard, but dispatching silently truncated text to an agent
      // with tool access would be worse than the truncation — so it is sent
      // with the cut made visible on the pill.
      if (state.phase !== 'listening') return { state, commands: [] }
      return {
        state: {
          ...state,
          phase: 'transcribing',
          message: 'Hit the capture time limit — sending what was heard'
        },
        commands: ['stop-audio']
      }

    case 'noSpeech':
    case 'cancelRequested':
      if (!isActive(state.phase)) return { state, commands: [] }
      return { state: IDLE_CAPTURE, commands: ['discard-audio', 'hide'] }

    case 'audioReady':
      if (state.phase !== 'transcribing') return { state, commands: [] }
      return { state, commands: ['transcribe'] }

    case 'transcript': {
      if (state.phase !== 'transcribing') return { state, commands: [] }

      const text = event.text.trim()

      // Whisper returns nothing for audio under 200ms and for a room with no
      // speech in it. Dispatching an empty prompt to an agent with shell
      // access would be worse than dispatching nothing.
      if (!text) {
        return { state: { ...state, phase: 'error', message: 'Nothing heard' }, commands: [] }
      }

      return {
        state: { ...state, phase: 'dispatched', transcript: text },
        commands: ['dispatch']
      }
    }

    case 'failed':
      return {
        state: { ...IDLE_CAPTURE, phase: 'error', message: event.message },
        commands: ['discard-audio']
      }

    case 'dismiss':
      return { state: IDLE_CAPTURE, commands: ['hide'] }
  }
}
