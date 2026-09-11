import type { OverlayPhase } from '@shared/voice-input'

/**
 * One capture, as a pure reducer.
 *
 * Audio lives in the overlay renderer and hotkeys live in Electron, so neither
 * is testable here — which is exactly why every decision about a capture is in
 * this file and neither of those places has any.
 */

export type CaptureEvent =
  | { type: 'trigger'; agentId: string; aside?: boolean }
  /**
   * A prompt that arrived whole from the wake listener ("hey Atlas, run the
   * tests"), with no microphone to open. It takes the same dispatched or
   * asking path as a capture so the pill shows it, which it used not to.
   */
  | { type: 'spoken'; agentId: string; text: string; aside: boolean }
  /** The dispatched prompt went into the queue behind a running turn. */
  | { type: 'queued' }
  /** The side question's answer. */
  | { type: 'answered'; text: string }
  | { type: 'blocked'; message: string }
  | { type: 'speechStarted' }
  | { type: 'silence' }
  | { type: 'noSpeech' }
  | { type: 'maxDuration' }
  | { type: 'stopRequested' }
  | { type: 'cancelRequested' }
  | { type: 'audioReady' }
  /** The live transcript settled a little more. */
  | { type: 'partial'; committed: string; tentative: string }
  | { type: 'transcript'; text: string }
  | { type: 'failed'; message: string }
  | { type: 'dismiss' }

export type CaptureState = {
  phase: OverlayPhase
  agentId: string | null
  transcript: string
  message: string
  /** Set at trigger time: the words are a side question, not an instruction. */
  aside: boolean
  queued: boolean
  answer: string
  partial: { committed: string; tentative: string }
}

export type CaptureCommand =
  | 'start-audio'
  | 'stop-audio'
  | 'discard-audio'
  | 'transcribe'
  | 'dispatch'
  /** Answer the transcript as a side question rather than sending it. */
  | 'ask'
  | 'hide'

export const IDLE_CAPTURE: CaptureState = {
  phase: 'hidden',
  agentId: null,
  transcript: '',
  message: '',
  aside: false,
  queued: false,
  answer: '',
  partial: { committed: '', tentative: '' }
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
        state: {
          ...IDLE_CAPTURE,
          phase: 'listening',
          agentId: event.agentId,
          aside: event.aside === true
        },
        commands: ['start-audio']
      }

    case 'spoken':
      // The microphone is taken; the wake listener's segment came from the
      // same microphone and cannot have been a second person.
      if (isActive(state.phase)) return { state, commands: [] }
      return {
        state: {
          ...IDLE_CAPTURE,
          phase: event.aside ? 'asking' : 'dispatched',
          agentId: event.agentId,
          transcript: event.text,
          aside: event.aside
        },
        commands: [event.aside ? 'ask' : 'dispatch']
      }

    case 'queued':
      if (state.phase !== 'dispatched') return { state, commands: [] }
      return { state: { ...state, queued: true }, commands: [] }

    case 'answered':
      if (state.phase !== 'asking') return { state, commands: [] }
      return { state: { ...state, phase: 'answered', answer: event.text }, commands: [] }

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

    case 'partial':
      // Only while the audio is in play: a partial that lands after the
      // final text would put stale words on a dispatched bubble.
      if (!isActive(state.phase)) return { state, commands: [] }
      return {
        state: { ...state, partial: { committed: event.committed, tentative: event.tentative } },
        commands: []
      }

    case 'transcript': {
      if (state.phase !== 'transcribing') return { state, commands: [] }

      const text = event.text.trim()

      // Whisper returns nothing for audio under 200ms and for a room with no
      // speech in it. Dispatching an empty prompt to an agent with shell
      // access would be worse than dispatching nothing.
      if (!text) {
        return { state: { ...state, phase: 'error', message: 'Nothing heard' }, commands: [] }
      }

      if (state.aside) {
        return { state: { ...state, phase: 'asking', transcript: text }, commands: ['ask'] }
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
