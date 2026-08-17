/**
 * Base64 transport for raw audio.
 *
 * Samples cross the overlay → main → sidecar boundary as base64 of the
 * underlying buffer. A JSON array of floats would be several times the size of
 * the audio it describes: 30 seconds at 16 kHz is 480,000 samples, which
 * serialises to megabytes of decimal text.
 */

/**
 * Chunked rather than one call per byte or one call for everything.
 *
 * `String.fromCharCode(...bytes)` overflows the argument limit on anything
 * longer than a short clip, and appending a character at a time to a string is
 * slow enough to be visible on a 30-second capture. 8 KB chunks avoid both.
 */
const CHUNK = 8192

export function encodePcm(samples: Float32Array): string {
  // Bounded to the view rather than its backing buffer: worklet output is
  // often a subarray, and encoding the whole buffer would prepend audio that
  // was never captured.
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)

  const parts: string[] = []
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)))
  }

  return btoa(parts.join(''))
}

export function decodePcm(base64: string): Float32Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Float32Array(bytes.buffer)
}
